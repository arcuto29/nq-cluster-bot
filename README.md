# NQ Cluster Bot

Discord bot for NQ futures trading — volume clusters, TPO profiles, single print detection, bias engine, and market session alerts.

## Features

### Volume Clusters
- Real-time cluster alerts from TradingView (bullish/bearish)
- Live-updating embed showing closest clusters above/below price
- Auto-removes mitigated clusters when price breaks through
- Hold rate tracking

### TPO Profile & Single Prints
- Builds a live TPO (Time Price Opportunity) profile from 30-min bars
- **Single print detection** — identifies price levels with only 1 TPO letter (rapid price movement)
- Alerts when new single prints form and when they get filled
- Profile shape analysis (b-shape, p-shape, D-shape, B-shape)
- Value Area (POC, VAH, VAL) and Initial Balance tracking
- Visual TPO profile display in Discord

### Bias Engine (10 Factors)
Calculates a -1 to +1 directional bias score using:

| # | Factor | Weight | Source |
|---|--------|--------|--------|
| 1 | Overnight positioning | 12% | Price vs overnight midpoint |
| 2 | Opening drive | 15% | First 15-min direction |
| 3 | Volume delta | 15% | Buy vs sell aggression |
| 4 | Cluster balance | 12% | Bull clusters below / bear above |
| 5 | Print balance | 8% | Single prints above/below |
| 6 | Prior day close | 8% | Close vs Value Area |
| 7 | SMT signals | 8% | Divergence signals |
| 8 | TPO shape | 10% | b/p/D/B profile shape |
| 9 | TPO single prints | 7% | Single print positioning |
| 10 | IB extension | 5% | Price vs Initial Balance |

### Market Session Alerts
Automatic Discord alerts for session opens/closes with 5-minute warnings:

| Session | Open (ET) | Close (ET) |
|---------|-----------|------------|
| Asia (Tokyo) | 7:00 PM | 4:00 AM |
| London | 3:00 AM | 12:00 PM |
| New York RTH | 9:30 AM | 4:00 PM |
| CME Futures | 6:00 PM | 5:00 PM |
| Pre-Market | 4:00 AM | 9:30 AM |

### SMT Divergence
- Tracks bullish/bearish SMT signals
- Contributes to bias calculation

## Slash Commands

| Command | Description |
|---------|-------------|
| `/clusters` | Show closest clusters above/below price |
| `/bias` | Show daily bias with full factor breakdown |
| `/prints` | Show all active single prints (cluster + TPO) |
| `/tpo` | Show current TPO profile, shape, and key levels |
| `/sessions` | Show active sessions, upcoming events, full schedule |
| `/stats` | Show session statistics (clusters, prints, TPO, SMT) |
| `/clear` | Reset all data for a fresh session |

## Setup

### 1. Create a Discord Bot

1. Go to https://discord.com/developers/applications
2. Click "New Application" → name it
3. Go to "Bot" tab → "Reset Token" → copy the token
4. Enable **Message Content Intent** under Privileged Gateway Intents
5. OAuth2 → URL Generator → Scopes: `bot` → Permissions: `Send Messages`, `Embed Links`, `Read Message History`
6. Copy the URL and invite to your server

### 2. Get Your Channel ID

1. Enable Developer Mode in Discord (Settings → Advanced)
2. Right-click the target channel → "Copy Channel ID"

### 3. Configure

```bash
cp .env.example .env
```

Edit `.env`:
```env
DISCORD_TOKEN=your_bot_token_here
CHANNEL_ID=your_channel_id_here
SYMBOL=NQ
UPDATE_INTERVAL=30
TIMEZONE=America/New_York
WEBHOOK_PORT=3000
WEBHOOK_SECRET=your_secret_here
TPO_TICK_SIZE=0.25
TPO_PERIOD=30
```

### 4. Install & Run

```bash
npm install
node bot.js
```

### 5. TradingView Setup

You need to set up **3 indicators** in TradingView with webhook alerts:

#### A. Cluster Alerts (your existing clusters indicator)
Add to your indicator code:
```pine
alert(str.format('{"action":"cluster","type":"{0}","timeframe":"{1}","priceHigh":{2},"priceLow":{3},"secret":"{4}"}',
    lastIsBull ? "bullish" : "bearish",
    timeframe.period,
    str.tostring(lastTop),
    str.tostring(lastBot),
    "your_secret_here"), alert.freq_once_per_bar)
```

#### B. Bias Data Feeder (`bias-feeder.pine`)
- Apply to a **1-minute chart**
- Sends: overnight range, prior day levels, opening drive, volume delta, price updates
- Set alert → "Any alert() function call" → Webhook URL: `http://YOUR_IP:3000/webhook`

#### C. TPO Feeder (`tpo-feeder.pine`)
- Apply to a **30-minute chart**
- Sends: TPO period OHLC, single print detection, session reset/close
- Set alert → "Any alert() function call" → Webhook URL: `http://YOUR_IP:3000/webhook`

### 6. Deploy

```bash
# With PM2 for 24/7 operation
npm install -g pm2
pm2 start bot.js --name nq-cluster-bot
pm2 startup
pm2 save
```

## Architecture

```
TradingView Alerts (3 indicators)
    │
    ├── Clusters indicator → POST /webhook { action: "cluster" }
    ├── Bias Feeder (1m)   → POST /webhook { action: "bias" | "price" }
    └── TPO Feeder (30m)   → POST /webhook { action: "tpo" | "tpo_single_print" | "tpo_reset" }
                                    │
                                    ▼
                            WebhookServer (port 3000)
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
             ClusterStore      TPOEngine       BiasEngine
             (clusters,        (profile,       (10 factors,
              prints, SMT)      singles,        score -1→+1)
                                VA, IB)
                    │               │               │
                    └───────────────┼───────────────┘
                                    ▼
                            Discord Channel
                         (embeds + alerts)
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
             Cluster Embed     TPO Embed      Bias Embed
             (live updating)   (profile +     (score bar +
                                singles)       breakdown)
                                    │
                                    ▼
                            SessionTimer
                         (open/close alerts)
```

## Files

| File | Purpose |
|------|---------|
| `bot.js` | Main entry point, Discord client, event wiring |
| `tpoEngine.js` | TPO profile builder, single print detection, shape analysis |
| `sessionTimer.js` | Market session scheduler, open/close alerts |
| `biasEngine.js` | 10-factor bias calculation engine |
| `clusterStore.js` | Cluster/print/SMT storage and mitigation |
| `embedBuilder.js` | Discord embed formatting (clusters, bias, TPO, sessions) |
| `webhookServer.js` | HTTP server for TradingView webhook alerts |
| `commands.js` | Slash command handler |
| `config.js` | Configuration from environment variables |
| `tpo-feeder.pine` | Pine Script: sends TPO bars + single prints |
| `bias-feeder.pine` | Pine Script: sends bias data (overnight, delta, etc.) |
| `tradingview-alert.pine` | Pine Script: cluster alert template |

## How Single Print Detection Works

1. **TradingView (Pine-side):** Detects gaps between consecutive 30-min bars where no overlap exists (immediate alert)
2. **Bot (Node.js-side):** Builds the full TPO profile and finds price levels where only 1 letter printed out of all periods

Both methods contribute to the single print list. The bot tracks them and alerts when:
- A new single print zone forms
- Price revisits and "fills" a single print zone

### Single Print Bias Logic
- More single prints **below** current price = support cushion = **bullish**
- More single prints **above** current price = resistance above = **bearish**
- This feeds into the bias engine as one of 10 weighted factors

## How TPO Shape Analysis Works

The profile is divided into thirds (lower/middle/upper):
- **b-shape:** Fat bottom → accumulation → bullish (+0.6)
- **p-shape:** Fat top → distribution → bearish (-0.6)
- **D-shape:** Fat middle → balanced/rotational → neutral (0)
- **B-shape:** Both extremes fat → double distribution → transitional (0)
