const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config');
const BiasEngine = require('./biasEngine');
const TPOEngine = require('./tpoEngine');
const SessionTimer = require('./sessionTimer');
const WebhookServer = require('./webhookServer');
const { registerCommands } = require('./commands');
const { buildBiasEmbed, buildTPOSinglePrintAlert,
        buildSessionAlert, buildTPOEmbed } = require('./embedBuilder');

// ==================== INIT ====================
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

const bias = new BiasEngine(config);
const tpo = new TPOEngine(config);
const sessionTimer = new SessionTimer(config);

// Connect TPO engine to bias engine
bias.setTPOEngine(tpo);

let biasMessage = null;
let tpoMessage = null;
let alertChannel = null;

// ==================== BOT READY ====================
client.once('ready', async () => {
    console.log(`[Bot] Logged in as ${client.user.tag}`);
    console.log(`[Bot] Symbol: ${config.symbol}`);

    alertChannel = await client.channels.fetch(config.channelId);
    if (!alertChannel) {
        console.error('[Bot] Channel not found:', config.channelId);
        process.exit(1);
    }

    await sendOrUpdateBias();

    // Start session timer (market open/close alerts)
    sessionTimer.start();

    // Update loop
    setInterval(async () => {
        await sendOrUpdateBias();
        await sendOrUpdateTPO();
    }, config.updateInterval);

    console.log(`[Bot] Running. Update every ${config.updateInterval / 1000}s`);
});

// Register slash commands
registerCommands(client, bias, tpo, sessionTimer, config);

// ==================== SESSION TIMER EVENTS ====================
sessionTimer.on('session', async (event) => {
    if (!alertChannel) return;

    try {
        const message = buildSessionAlert(event);
        await alertChannel.send(message);
        console.log(`[Session] Alert sent: ${event.session} ${event.type}`);
    } catch (err) {
        console.error('[Session] Alert error:', err.message);
    }
});

// ==================== EMBED UPDATES ====================
async function sendOrUpdateBias() {
    try {
        const embed = buildBiasEmbed(bias, bias.currentPrice, config.symbol);
        if (biasMessage) {
            await biasMessage.edit({ embeds: [embed] });
        } else {
            biasMessage = await alertChannel.send({ embeds: [embed] });
        }
    } catch (err) {
        console.error('[Bias] Error:', err.message);
        biasMessage = null;
    }
}

async function sendOrUpdateTPO() {
    if (tpo.profile.size === 0) return; // No TPO data yet

    try {
        const embed = buildTPOEmbed(tpo, bias.currentPrice, config.symbol);
        if (tpoMessage) {
            await tpoMessage.edit({ embeds: [embed] });
        } else {
            tpoMessage = await alertChannel.send({ embeds: [embed] });
        }
    } catch (err) {
        console.error('[TPO] Embed error:', err.message);
        tpoMessage = null;
    }
}

// ==================== WEBHOOK HANDLERS ====================
function handlePriceUpdate(price) {
    bias.updatePrice(price);
    tpo.updatePrice(price);

    // Check TPO single print fills
    const tpoFilled = tpo.checkSinglePrintFills(price);
    if (tpoFilled.length > 0 && alertChannel) {
        for (const sp of tpoFilled) {
            alertChannel.send(buildTPOSinglePrintAlert(sp, true, config.symbol));
        }
        console.log(`[-] ${tpoFilled.length} TPO single print(s) filled at ${price}`);
    }
}

function handleBiasData(data) {
    // Prior day levels
    if (data.poc || data.vah || data.val) {
        bias.setPriorDayLevels(data);
    }
    // Overnight range
    if (data.overnightHigh && data.overnightLow) {
        bias.setOvernightRange(data.overnightHigh, data.overnightLow);
    }
    // RTH open
    if (data.rthOpen) {
        bias.setRTHOpen(data.rthOpen);
    }
    // Opening drive
    if (data.openDriveHigh && data.openDriveLow && data.openDriveClose) {
        bias.setOpeningDrive(data.openDriveHigh, data.openDriveLow, data.openDriveClose);
    }
    // Delta
    if (data.buyVol && data.sellVol) {
        bias.updateDelta(data.buyVol, data.sellVol);
    }
}

// ==================== TPO WEBHOOK HANDLERS ====================
async function handleTPOBar(data) {
    // Received a completed 30-min TPO bar from TradingView
    const result = tpo.addPeriodBar(data);
    console.log(`[TPO] Period ${data.letter || tpo.currentLetter} | High: ${data.high} Low: ${data.low}`);

    // Check for newly detected single prints and alert
    if (result && result.singlePrints && result.singlePrints.length > 0) {
        const newPrints = result.singlePrints.filter(sp => !sp.alerted);
        for (const sp of newPrints) {
            if (alertChannel) {
                // Add direction relative to current price
                sp.direction = sp.mid > bias.currentPrice ? 'above' : 'below';
                await alertChannel.send(buildTPOSinglePrintAlert(sp, false, config.symbol));
            }
            sp.alerted = true;
        }
    }

    // Update embeds
    await sendOrUpdateTPO();
    await sendOrUpdateBias();
}

async function handleTPOSinglePrint(data) {
    // Direct single print detection from Pine Script (gap between periods)
    const sp = {
        high: parseFloat(data.high),
        low: parseFloat(data.low),
        mid: parseFloat(data.mid),
        letter: data.letter,
        direction: data.direction, // 'above' or 'below'
        timestamp: new Date(),
        filled: false,
        tickCount: Math.round((parseFloat(data.high) - parseFloat(data.low)) / (config.tpo?.tickSize || 0.25)),
    };

    // Add to TPO engine's single prints
    tpo.singlePrints.push(sp);
    console.log(`[TPO] Single print detected ${sp.direction}: ${sp.low.toFixed(2)} - ${sp.high.toFixed(2)}`);

    if (alertChannel) {
        await alertChannel.send(buildTPOSinglePrintAlert(sp, false, config.symbol));
    }

    await sendOrUpdateBias();
}

function handleTPOReset(data) {
    // Session open — reset TPO profile
    console.log('[TPO] Session reset — new profile starting');
    tpo.reset();
    bias.resetTPOData();

    if (data.rthOpen) {
        tpo.sessionOpen = parseFloat(data.rthOpen);
        bias.setRTHOpen(parseFloat(data.rthOpen));
    }

    // Reset the TPO embed
    tpoMessage = null;
}

function handleTPOSessionClose(data) {
    console.log(`[TPO] Session closed. Periods: ${data.periodsCompleted}, Range: ${data.sessionLow}-${data.sessionHigh}`);
}

// ==================== WEBHOOK SERVER ====================
const webhook = new WebhookServer(config.webhook.port, config.webhook.secret, {
    onPrice: handlePriceUpdate,
    onBias: handleBiasData,
    onTPO: handleTPOBar,
    onTPOSinglePrint: handleTPOSinglePrint,
    onTPOReset: handleTPOReset,
    onTPOSessionClose: handleTPOSessionClose,
});
webhook.start();

// ==================== DAILY RESET ====================
function scheduleDailyReset() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(6, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const ms = next.getTime() - now.getTime();

    setTimeout(() => {
        console.log('[Bot] Daily reset');
        bias.reset();
        tpo.reset();
        biasMessage = null;
        tpoMessage = null;
        scheduleDailyReset();
    }, ms);

    console.log(`[Bot] Next reset in ${Math.round(ms / 1000 / 60)} min`);
}
scheduleDailyReset();

// ==================== LOGIN ====================
client.login(config.token).catch(err => {
    console.error('[Bot] Login failed:', err.message);
    process.exit(1);
});

process.on('SIGINT', () => {
    console.log('[Bot] Shutting down...');
    sessionTimer.stop();
    webhook.stop();
    client.destroy();
    process.exit(0);
});
