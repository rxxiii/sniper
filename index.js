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
 *   TARGET_CODE=the-vanity-code-you-want
 *   POLL_INTERVAL_MS=5000
 */

require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const TARGET_CODE = process.env.TARGET_CODE;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '5000', 10);

if (!BOT_TOKEN || !GUILD_ID || !TARGET_CODE) {
  console.error('Missing required .env values: BOT_TOKEN, GUILD_ID, TARGET_CODE');
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

async function pollOnce() {
  if (claimed) return;

  const available = await isCodeAvailable(TARGET_CODE);
  if (!available) {
    console.log(`[${new Date().toISOString()}] "${TARGET_CODE}" still taken.`);
    return;
  }

  console.log(`[${new Date().toISOString()}] "${TARGET_CODE}" looks free — attempting claim...`);
  const success = await claimVanity(TARGET_CODE);

  if (success) {
    claimed = true;
    console.log(`✅ Claimed vanity URL: discord.gg/${TARGET_CODE}`);
    clearInterval(pollTimer);
  } else {
    console.log('Claim attempt failed, will keep polling.');
  }
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Polling for vanity code "${TARGET_CODE}" every ${POLL_INTERVAL_MS}ms...`);

  pollOnce(); // check immediately on startup
  pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
});

client.login(BOT_TOKEN);
