# Discord Vanity URL Sniper (Bot Account Version)

Polls a target vanity URL code and claims it for your server the moment
it frees up. Built on Discord's official REST API with a real bot
account — **not** a self-bot, and fully within Discord's Terms of Service.

## Prerequisites

1. Your server must be eligible for a vanity URL:
   - Community server at **Boost Level 3**, or
   - A **Partnered** server
2. A bot application registered at
   https://discord.com/developers/applications
3. The bot invited to your server with the **Manage Server**
   (`MANAGE_GUILD`) permission.

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env`:

```
BOT_TOKEN=your_bot_token_here
GUILD_ID=your_server_id_here
TARGET_CODE=the-vanity-code-you-want
POLL_INTERVAL_MS=5000
```

- `GUILD_ID`: right-click your server icon in Discord (Developer Mode
  enabled) → Copy Server ID.
- `TARGET_CODE`: the exact code you want, e.g. `myserver` for
  `discord.gg/myserver`.
- `POLL_INTERVAL_MS`: how often to check, in milliseconds. Don't set
  this too aggressively — Discord rate-limits the API, and the bot
  will back off automatically on 429s via discord.js's built-in
  rate-limit handling.

## Run

```bash
npm start
```

The bot logs in, checks the code immediately, then polls on the
interval you set. When the code becomes available it attempts to
claim it right away and stops polling once successful.

## Notes / limitations

- Checking availability relies on `GET /invites/{code}` returning
  404 for unused codes. This is a reasonable proxy but not a
  Discord-guaranteed "vanity availability" endpoint (Discord doesn't
  publish one).
- Claiming still requires your server to actually have the vanity
  URL feature unlocked — the API call will fail otherwise regardless
  of whether the code is free.
- Being fast still isn't a guarantee — if many parties want the same
  popular code, someone with a lower-latency setup or better luck on
  timing may still win it.
