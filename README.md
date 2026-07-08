# Cluster Bot

Discord bot that posts NQ volume cluster alerts — similar to Sim's Cluster Bot.

## What It Does

- Receives cluster alerts from your TradingView indicator via webhook
- Posts real-time alerts to Discord: `New bearish 1m cluster | 2026-02-13 10:49 | 24,723.50 - 24,724.00`
- Maintains a live-updating embed showing **closest clusters** above and below current price
- Auto-removes mitigated clusters (when price breaks through)
- Daily session reset

## Setup

### 1. Create a Discord Bot

1. Go to https://discord.com/developers/applications
2. Click "New Application" → name it "Cluster Bot"
3. Go to "Bot" tab → click "Reset Token" → copy the token
4. Enable these Privileged Gateway Intents:
   - Message Content Intent
5. Go to OAuth2 → URL Generator:
   - Scopes: `bot`
   - Permissions: `Send Messages`, `Embed Links`, `Read Message History`
6. Copy the URL and invite the bot to your server

### 2. Get Your Channel ID

1. In Discord, enable Developer Mode (Settings → Advanced → Developer Mode)
2. Right-click the channel you want alerts in → "Copy Channel ID"

### 3. Configure

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:
```
DISCORD_TOKEN=your_bot_token_here
CHANNEL_ID=your_channel_id_here
SYMBOL=NQ
UPDATE_INTERVAL=60
TIMEZONE=America/New_York
WEBHOOK_PORT=3000
WEBHOOK_SECRET=your_secret_here
```

### 4. Install & Run

```bash
npm install
node bot.js
```

### 5. Connect TradingView

In your **Clusters [Custom]** indicator, add this code at the very bottom (before the closing alerts):

```pine
// Send webhook alert on new cluster
if showClusters and array.size(clusterIsBull) > 0
    bool lastIsBull = array.last(clusterIsBull)
    float lastTop = array.last(clusterTops)
    float lastBot = array.last(clusterBots)
    alert(str.format('{"type":"{0}","timeframe":"{1}","priceHigh":{2},"priceLow":{3},"price":{4},"symbol":"{5}","secret":"{6}"}',
        lastIsBull ? "bullish" : "bearish",
        timeframe.period,
        str.tostring(lastTop),
        str.tostring(lastBot),
        str.tostring(close),
        syminfo.ticker,
        "your_secret_here"), alert.freq_once_per_bar)
```

Then set up a TradingView alert:
1. Right-click the indicator → "Add Alert"
2. Condition: "Any alert() function call"
3. Check "Webhook URL" → enter: `http://YOUR_SERVER_IP:3000/webhook`
4. Set alert to "Once Per Bar"

### 6. Deploy (Optional)

For 24/7 operation, deploy on a VPS (DigitalOcean, Railway, Render, etc.):

```bash
# With PM2
npm install -g pm2
pm2 start bot.js --name cluster-bot
pm2 startup
pm2 save
```

## Architecture

```
TradingView Alert → Webhook (POST /webhook) → Bot → Discord Channel
                                                 ↓
                                         ClusterStore (in-memory)
                                                 ↓
                                         Live Embed (edits message)
```

## Files

| File | Purpose |
|------|---------|
| `bot.js` | Main entry point, Discord client, update loop |
| `clusterStore.js` | Stores clusters, handles mitigation, sorting |
| `embedBuilder.js` | Builds Discord embeds matching Sim's style |
| `webhookServer.js` | HTTP server receiving TradingView alerts |
| `config.js` | Configuration from environment variables |
| `tradingview-alert.pine` | Pine Script code to add to your indicator |
