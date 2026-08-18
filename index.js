/**
 * Discord Vanity URL Sniper — legitimate bot-account version
 * -----------------------------------------------------------
 * Uses a REAL bot account + the official Discord REST API.
 * This is NOT a self-bot and does not violate Discord ToS.
 *
 * Requirements:
 *  - A registered Discord application/bot (https://discord.com/developers/applications)
 *  - The bot invited to your server with MANAGE_GUILD permission
 *  - Your server must have the vanity URL feature unlocked
 *    (Community server at Boost Level 3, or a Partnered server)
 *
 * Install:
 *   npm init -y
 *   npm install discord.js dotenv
 *
 * .env file:
 *   BOT_TOKEN=your_bot_token_here
 *   GUILD_ID=your_server_id_here
 *   TARGET_CODES=first-choice,second-choice,third-choice
 *   POLL_INTERVAL_MS=5000
 *   NOTIFY_USER_ID=your_discord_user_id_here   (optional — DMs you on success)
 *   HEALTH_LOG_INTERVAL_MIN=30                  (optional — periodic "still alive" log)
 */

require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');

// ---------- Config ----------

const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '5000', 10);
const NOTIFY_USER_ID = process.env.NOTIFY_USER_ID || null;
const HEALTH_LOG_INTERVAL_MIN = parseInt(process.env.HEALTH_LOG_INTERVAL_MIN || '30', 10);

// Supports either TARGET_CODES=a,b,c (preferred) or legacy single TARGET_CODE
const rawCodes = process.env.TARGET_CODES || process.env.TARGET_CODE || '';
const TARGET_CODES = rawCodes
  .split(',')
  .map((c) => c.trim().toLowerCase())
  .filter(Boolean);

// ---------- Startup validation ----------

const VALID_CODE_RE = /^[a-z0-9-]{2,32}$/;

function validateConfig() {
  const errors = [];

  if (!BOT_TOKEN) errors.push('BOT_TOKEN is missing.');
  if (!GUILD_ID) errors.push('GUILD_ID is missing.');
  if (TARGET_CODES.length === 0) errors.push('TARGET_CODES (or TARGET_CODE) is missing/empty.');
  if (Number.isNaN(POLL_INTERVAL_MS) || POLL_INTERVAL_MS < 500) {
    errors.push('POLL_INTERVAL_MS must be a number >= 500.');
  }

  for (const code of TARGET_CODES) {
    if (!VALID_CODE_RE.test(code)) {
      errors.push(`"${code}" doesn't look like a valid Discord vanity code (2-32 chars, lowercase letters/numbers/hyphens only).`);
    }
  }

  const deduped = new Set(TARGET_CODES);
  if (deduped.size !== TARGET_CODES.length) {
    errors.push('TARGET_CODES contains duplicate entries — remove the repeats.');
  }

  if (errors.length > 0) {
    console.error('Config errors:\n' + errors.map((e) => `  - ${e}`).join('\n'));
    process.exit(1);
  }
}

validateConfig();

// ---------- Setup ----------

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

let claimed = false;
let pollTimer = null;
let healthTimer = null;
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 8;

// ---------- Helpers ----------

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function warn(msg) {
  console.warn(`[${new Date().toISOString()}] ⚠️  ${msg}`);
}

/**
 * Small delay helper, used for backoff.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Checks whether an invite code (used as a vanity code) currently resolves.
 * A 404 from GET /invites/{code} means the code is free.
 * Handles rate limits (429) with a short backoff instead of treating them
 * as "taken."
 */
async function isCodeAvailable(code) {
  try {
    await rest.get(Routes.invite(code));
    return false; // resolved successfully => in use
  } catch (err) {
    if (err.status === 404) return true;

    if (err.status === 429) {
      const retryAfterMs = (err.retryAfter ?? 1) * 1000;
      warn(`Rate limited checking "${code}", backing off ${retryAfterMs}ms.`);
      await sleep(retryAfterMs);
      return false; // treat as "unknown/taken" for this cycle, retry next poll
    }

    warn(`Unexpected error checking "${code}": ${err.status ?? ''} ${err.message}`);
    return false;
  }
}

/**
 * Attempts to set the guild's vanity URL to the target code.
 * Requires MANAGE_GUILD and the guild must have the VANITY_URL feature.
 */
async function claimVanity(code) {
  try {
    const response = await rest.patch(Routes.guild(GUILD_ID), {
      body: { vanity_url_code: code },
    });
    // Log exactly what Discord handed back for this field so we can see
    // whether it was actually accepted, or silently ignored.
    log(`Raw PATCH response vanity_url_code: "${response.vanity_url_code}"`);
    return { ok: true };
  } catch (err) {
    return { ok: false, status: err.status, message: err.message };
  }
}

/**
 * Re-fetches the guild directly from Discord and checks whether
 * vanity_url_code actually equals what we tried to set. A 200 response
 * from the PATCH call only means Discord accepted the request — it does
 * NOT guarantee the code stuck (feature not unlocked, race lost to
 * someone else between check and claim, etc). This closes that gap.
 */
async function verifyClaim(code) {
  try {
    const guild = await rest.get(Routes.guild(GUILD_ID));
    return guild.vanity_url_code === code;
  } catch (err) {
    warn(`Failed to verify claim for "${code}": ${err.status ?? ''} ${err.message}`);
    return false;
  }
}

/**
 * DMs the configured user when a vanity claim succeeds.
 * Fails silently into a console warning if DMs are closed or the ID is wrong.
 */
async function notifyClaim(code) {
  if (!NOTIFY_USER_ID) return;

  try {
    const user = await client.users.fetch(NOTIFY_USER_ID);
    await user.send(`✅ Claimed vanity URL: discord.gg/${code}`);
  } catch (err) {
    warn(`Could not DM user ${NOTIFY_USER_ID}: ${err.message}`);
  }
}

/**
 * Walks the target list in priority order. Stops and claims the first
 * one found available and verified. Earlier entries in TARGET_CODES
 * are preferred.
 */
async function pollOnce() {
  if (claimed) return;

  try {
    for (const code of TARGET_CODES) {
      const available = await isCodeAvailable(code);

      if (!available) {
        continue;
      }

      log(`"${code}" looks free — attempting claim...`);
      const result = await claimVanity(code);

      if (!result.ok) {
        if (result.status === 429) {
          warn(`Rate limited while claiming "${code}", will retry next poll.`);
        } else {
          warn(`Claim attempt for "${code}" failed (${result.status ?? 'unknown'}): ${result.message}`);
        }
        continue;
      }

      const verified = await verifyClaim(code);

      if (verified) {
        claimed = true;
        log(`✅ Claimed and verified vanity URL: discord.gg/${code}`);
        await notifyClaim(code);
        stopPolling();
        return;
      } else {
        warn(`PATCH for "${code}" returned OK, but verification shows it did NOT stick. Still polling.`);
      }
    }

    consecutiveErrors = 0; // successful cycle, reset error counter
  } catch (err) {
    consecutiveErrors += 1;
    warn(`Unhandled error during poll cycle (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${err.message}`);

    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      console.error('Too many consecutive errors — stopping polling to avoid hammering the API. Restart the service to retry.');
      stopPolling();
    }
  }
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  if (healthTimer) clearInterval(healthTimer);
}

/**
 * Runs the startup diagnostic: confirms the guild is reachable and
 * reports whether it actually has the VANITY_URL feature, plus its
 * current vanity code if any. This surfaces the single most common
 * cause of "it said claimed but nothing changed" up front.
 */
async function runStartupDiagnostic() {
  try {
    const guild = await rest.get(Routes.guild(GUILD_ID));
    const hasFeature = Array.isArray(guild.features) && guild.features.includes('VANITY_URL');

    log(`Connected to guild "${guild.name}" (${GUILD_ID}).`);
    log(`VANITY_URL feature: ${hasFeature ? 'ENABLED ✅' : 'NOT ENABLED ❌'}`);

    if (!hasFeature) {
      warn('This server does not currently have the vanity URL feature unlocked (needs Boost Level 3, or Partnered). Claims WILL fail until this changes, no matter how fast the bot is.');
    }

    if (guild.vanity_url_code) {
      log(`Current vanity code on this server: "${guild.vanity_url_code}"`);
    }
  } catch (err) {
    console.error(`Could not fetch guild info at startup: ${err.status ?? ''} ${err.message}`);
    console.error('Double-check GUILD_ID is correct and the bot is actually a member of that server.');
  }
}

// ---------- Lifecycle ----------

client.once('clientReady', async () => {
  log(`Logged in as ${client.user.tag}`);

  await runStartupDiagnostic();

  log(`Polling for vanity codes [${TARGET_CODES.join(', ')}] every ${POLL_INTERVAL_MS}ms...`);

  pollOnce(); // check immediately on startup
  pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);

  if (HEALTH_LOG_INTERVAL_MIN > 0) {
    healthTimer = setInterval(() => {
      log(`Still running. Watching: [${TARGET_CODES.join(', ')}]. Claimed: ${claimed}.`);
    }, HEALTH_LOG_INTERVAL_MIN * 60 * 1000);
  }
});

client.on('error', (err) => {
  console.error('Discord client error:', err.message);
});

client.on('shardDisconnect', () => {
  warn('Gateway disconnected — discord.js will attempt to reconnect automatically.');
});

client.on('shardReconnecting', () => {
  log('Reconnecting to Discord gateway...');
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

function shutdown(signal) {
  log(`Received ${signal}, shutting down gracefully...`);
  stopPolling();
  client.destroy();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

client.login(BOT_TOKEN);
