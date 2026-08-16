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
 */

require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '5000', 10);
const NOTIFY_USER_ID = process.env.NOTIFY_USER_ID || null;

// Supports either TARGET_CODES=a,b,c (preferred) or legacy single TARGET_CODE
const rawCodes = process.env.TARGET_CODES || process.env.TARGET_CODE || '';
const TARGET_CODES = rawCodes
  .split(',')
  .map((c) => c.trim())
  .filter(Boolean);

if (!BOT_TOKEN || !GUILD_ID || TARGET_CODES.length === 0) {
  console.error('Missing required .env values: BOT_TOKEN, GUILD_ID, TARGET_CODES');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

let claimed = false;
let pollTimer = null;

/**
 * Checks whether an invite code (used as a vanity code) currently resolves.
 * A 404 from GET /invites/{code} means the code is free.
 * Any other status means it's taken or errored.
 */
async function isCodeAvailable(code) {
  try {
    await rest.get(Routes.invite(code));
    // If this resolves without throwing, the code is in use.
    return false;
  } catch (err) {
    if (err.status === 404) return true;
    console.warn(`Unexpected error checking code "${code}":`, err.message);
    return false;
  }
}

/**
 * Attempts to set the guild's vanity URL to the target code.
 * Requires MANAGE_GUILD and the guild must have the VANITY_URL feature.
 */
async function claimVanity(code) {
  try {
    await rest.patch(Routes.guild(GUILD_ID), {
      body: { vanity_url_code: code },
    });
    return true;
  } catch (err) {
    console.error(`Failed to claim vanity "${code}":`, err.status, err.message);
    return false;
  }
}

/**
 * DMs the configured user when a vanity claim succeeds.
 * Requires the bot to share a server with that user (it does, via GUILD_ID).
 * Fails silently into a console warning if DMs are closed or the ID is wrong.
 */
async function notifyClaim(code) {
  if (!NOTIFY_USER_ID) return;

  try {
    const user = await client.users.fetch(NOTIFY_USER_ID);
    await user.send(`✅ Claimed vanity URL: discord.gg/${code}`);
  } catch (err) {
    console.warn(`Could not DM user ${NOTIFY_USER_ID}:`, err.message);
  }
}

/**
 * Walks the target list in priority order. Stops and claims the first
 * one found available. Earlier entries in TARGET_CODES are preferred.
 */
async function pollOnce() {
  if (claimed) return;

  for (const code of TARGET_CODES) {
    const available = await isCodeAvailable(code);

    if (!available) {
      console.log(`[${new Date().toISOString()}] "${code}" still taken.`);
      continue;
    }

    console.log(`[${new Date().toISOString()}] "${code}" looks free — attempting claim...`);
    const success = await claimVanity(code);

    if (success) {
      claimed = true;
      console.log(`✅ Claimed vanity URL: discord.gg/${code}`);
      await notifyClaim(code);
      clearInterval(pollTimer);
      return; // stop checking further codes once claimed
    } else {
      console.log(`Claim attempt for "${code}" failed, will keep polling.`);
    }
  }
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Polling for vanity codes [${TARGET_CODES.join(', ')}] every ${POLL_INTERVAL_MS}ms...`);

  pollOnce(); // check immediately on startup
  pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
});

client.login(BOT_TOKEN);
