# NQ TPO Bot

Discord bot for NQ futures trading — TPO profiles, single print detection,
bias determination, and market session open/close alerts.

## Features

### TPO Profile & Single Prints
- Builds a live TPO (Time Price Opportunity) profile from 30-min bars
- **Single print detection** — identifies price levels with only 1 TPO letter
  (rapid price movement = potential S/R)
- Alerts when new single prints form and when they get filled
- Profile shape analysis (b-shape, p-shape, D-shape, B-shape)
- Value Area (POC, VAH, VAL) and Initial Balance tracking
- Visual TPO profile display in Discord

### Bias Engine (7 Factors)
Calculates a -1 to +1 directional bias score:

| # | Factor | Weight | Description |
|---|--------|--------|-------------|
| 1 | Overnight positioning | 20% | Price vs overnight midpoint |
| 2 | Opening drive | 18% | First 15-min direction |
| 3 | Volume delta | 15% | Buy vs sell aggression |
| 4 | TPO shape | 18% | b/p/D/B profile shape |
| 5 | Single print positioning | 14% | Prints above vs below |
| 6 | IB extension | 10% | Price vs Initial Balance |
| 7 | Prior day close | 5% | Close vs Value Area |

### Market Session Alerts
Automatic Discord alerts with 5-minute warnings:

| Session | Open (PST) | Close (PST) |
|---------|-----------|------------|
| Asia (Tokyo) | 4:00 PM | 1:00 AM |
| London | 12:00 AM | 9:00 AM |
| New York RTH | 6:30 AM | 1:00 PM |
| CME Futures | 3:00 PM | 2:00 PM |


## Slash Commands

| Command | Description |
|---------|-------------|
| `/bias` | Show daily bias with full factor breakdown |
| `/prints` | Show all active single prints with distances & bias |
| `/tpo` | Show current TPO profile, shape, and key levels |
| `/sessions` | Show active sessions, upcoming events, full schedule |
| `/stats` | Show TPO session statistics |
| `/clear` | Reset all data for a fresh session |

## Setup

### 1. Create a Discord Bot
1. Go to https://discord.com/developers/applications
2. Create a new application -> Bot tab -> copy token
3. Enable **Message Content Intent**
4. OAuth2 -> Scopes: `bot` -> Permissions: Send Messages, Embed Links
5. Invite bot to your server

### 2. Configure
```bash
cp .env.example .env
# Edit .env with your token and channel ID
```

### 3. Install & Run
```bash
npm install
node bot.js
```

### 4. TradingView Setup
Apply `tpo-feeder.pine` to a **30-minute chart** of NQ:
- Set alert -> "Any alert() function call"
- Webhook URL: `http://YOUR_SERVER_IP:3000/webhook`

The Pine Script sends:
- TPO period OHLC data (every 30 min bar)
- Single print gap detection (immediate alerts)
- Session reset at RTH open
- Session close summary at RTH close

### 5. Deploy (PM2)
```bash
npm install -g pm2
pm2 start bot.js --name nq-tpo-bot
pm2 startup && pm2 save
```

## How Single Prints Work

Single prints are price levels where only **1 TPO letter** printed during
the session. This means price moved through quickly without spending time
there — indicating thin volume areas.

**Why they matter:**
- They act as **magnets** — price tends to revisit and fill them
- Single prints below = support = bullish
- Single prints above = resistance = bearish
- The bot tracks where they are relative to price for bias

**Detection happens two ways:**
1. **Pine-side (immediate):** Detects gaps between consecutive 30-min bars
2. **Bot-side (cumulative):** Builds full profile, finds levels with only 1 letter

## How TPO Shape Analysis Works

The profile is divided into thirds (lower/middle/upper):
- **b-shape:** Fat bottom = accumulation = bullish (+0.6)
- **p-shape:** Fat top = distribution = bearish (-0.6)
- **D-shape:** Fat middle = balanced/rotational = neutral (0)
- **B-shape:** Both extremes fat = double distribution = transitional (0)

## Architecture

```
TradingView (30-min chart)
    │
    └── tpo-feeder.pine → POST /webhook
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
              TPOEngine            BiasEngine
            (profile,           (7 factors,
             singles,            score -1→+1)
             VA, IB, shape)         │
                    │               │
                    └───────┬───────┘
                            ▼
                    Discord Channel
                  (embeds + alerts)
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        TPO Embed      Bias Embed    Session Alerts
       (profile +     (score bar +   (open/close +
        singles)       breakdown)     warnings)
```

## Files

| File | Purpose |
|------|---------|
| `bot.js` | Main entry, Discord client, event wiring |
| `tpoEngine.js` | TPO profile builder, single print detection |
| `sessionTimer.js` | Market session scheduler |
| `biasEngine.js` | 7-factor bias calculation |
| `embedBuilder.js` | Discord embed formatting |
| `webhookServer.js` | HTTP server for TradingView webhooks |
| `commands.js` | Slash command handler |
| `config.js` | Configuration |
| `tpo-feeder.pine` | Pine Script for TradingView |
