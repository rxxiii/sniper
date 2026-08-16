# Discord Vanity URL Sniper (Bot Account Version)

Polls target vanity URL codes and claims the first available one for
your server. Built on Discord's official REST API with a real bot
account — **not** a self-bot, and fully within Discord's Terms of
Service.

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
TARGET_CODES=first-choice,second-choice,third-choice
POLL_INTERVAL_MS=5000
NOTIFY_USER_ID=your_discord_user_id_here
HEALTH_LOG_INTERVAL_MIN=30
```

- `GUILD_ID`: right-click your server icon in Discord (Developer Mode
  enabled) → Copy Server ID.
- `TARGET_CODES`: a comma-separated list of codes, in priority order.
  On each poll, the bot checks them left to right and claims the
  first one it finds free and verified — e.g.
  `myserver,myserver2,myservr` tries `myserver` first, falling back
  to the others only if it's taken. A single code still works fine:
  `TARGET_CODES=myserver`. Codes are validated at startup (2-32
  chars, lowercase letters/numbers/hyphens) — the bot refuses to
  start on an invalid or duplicate code instead of silently ignoring
  it.
- `POLL_INTERVAL_MS`: how often to check, in milliseconds. `5000`
  (5 seconds) is a reasonable default. Going much lower increases
  rate-limit risk; the bot now backs off automatically on 429s
  instead of misreporting a code as taken.
- `NOTIFY_USER_ID` (optional): your Discord user ID. If set, the bot
  DMs you when it successfully claims and verifies a vanity code.
  Leave blank to skip DMs — claims are always logged to the console.
- `HEALTH_LOG_INTERVAL_MIN` (optional, default `30`): how often the
  bot logs a "still running" heartbeat, useful for confirming on
  Railway/Render that it hasn't silently died. Set to `0` to disable.

## Run

```bash
npm start
```

On startup the bot:
1. Logs in and confirms it can see your guild.
2. Reports whether `VANITY_URL` is actually enabled on your server —
   this is the #1 cause of "it said claimed but nothing changed," so
   check this line first if something seems off.
3. Reports the server's current vanity code, if any.
4. Starts polling immediately, then on the configured interval.

When a target code is available, it attempts the claim, then
**re-fetches the guild to verify** the code actually stuck before
declaring success, sending your DM, or stopping. A PATCH response of
"OK" from Discord is not enough on its own — verification closes
that gap.

## Reliability improvements

- **Rate-limit aware**: 429s trigger an automatic backoff instead of
  being misread as "code taken."
- **Verified claims**: no false "success" — the guild is re-checked
  after every claim attempt.
- **Config validation**: bad tokens, malformed codes, or duplicate
  codes are caught at startup with a clear error instead of failing
  silently later.
- **Crash resistance**: unhandled errors and rejections are caught
  and logged instead of silently killing the process; the bot stops
  polling gracefully after too many consecutive failures rather than
  hammering the API forever.
- **Graceful shutdown**: responds properly to Railway/Render stop
  signals (SIGINT/SIGTERM).
- **Reconnect visibility**: logs gateway disconnects/reconnects so
  you can tell from the logs if a network blip caused a gap in
  polling.
- **Heartbeat logging**: periodic "still alive" log line so a silent
  hang is visible in your host's log viewer.

## Notes / limitations

- Checking availability relies on `GET /invites/{code}` returning
  404 for unused codes. This is a reasonable proxy but not a
  Discord-guaranteed "vanity availability" endpoint (Discord doesn't
  publish one).
- Being fast still isn't a guarantee — if many parties want the same
  popular code, someone with a lower-latency setup or better luck on
  timing may still win it.
