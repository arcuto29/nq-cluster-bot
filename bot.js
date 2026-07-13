const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config');
const ClusterStore = require('./clusterStore');
const BiasEngine = require('./biasEngine');
const TPOEngine = require('./tpoEngine');
const SessionTimer = require('./sessionTimer');
const WebhookServer = require('./webhookServer');
const { registerCommands } = require('./commands');
const { buildClusterEmbed, buildBiasEmbed, buildAlertMessage,
        buildSMTAlert, buildPrintAlert, buildTPOSinglePrintAlert,
        buildSessionAlert, buildTPOEmbed } = require('./embedBuilder');

// ==================== INIT ====================
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

const store = new ClusterStore(config);
const bias = new BiasEngine(config);
const tpo = new TPOEngine(config);
const sessionTimer = new SessionTimer(config);

// Connect TPO engine to bias engine
bias.setTPOEngine(tpo);

let embedMessage = null;
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

    await sendOrUpdateEmbed();
    await sendOrUpdateBias();

    // Start session timer (market open/close alerts)
    sessionTimer.start();

    // Update loop
    setInterval(async () => {
        store.pruneOld(24);
        await sendOrUpdateEmbed();
        await sendOrUpdateBias();
        await sendOrUpdateTPO();
    }, config.updateInterval);

    console.log(`[Bot] Running. Update every ${config.updateInterval / 1000}s`);
});

// Register slash commands
registerCommands(client, store, bias, tpo, sessionTimer, config);

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
async function sendOrUpdateEmbed() {
    try {
        const embed = buildClusterEmbed(store, bias.currentPrice, config.symbol, config.timezone);
        if (embedMessage) {
            await embedMessage.edit({ embeds: [embed] });
        } else {
            embedMessage = await alertChannel.send({ embeds: [embed] });
        }
    } catch (err) {
        console.error('[Embed] Error:', err.message);
        embedMessage = null;
    }
}

async function sendOrUpdateBias() {
    try {
        const embed = buildBiasEmbed(bias, store, bias.currentPrice, config.symbol);
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
async function handleNewCluster(data) {
    const cluster = store.addCluster(data);
    console.log(`[+] ${cluster.type} ${cluster.timeframe} cluster | ${cluster.priceLow}-${cluster.priceHigh}`);

    // Update bias engine
    const balance = store.getClusterBalance(bias.currentPrice);
    bias.updateClusters(balance.bullBelow, balance.bearAbove);

    // Alert to Discord
    if (alertChannel) {
        await alertChannel.send(buildAlertMessage(cluster, store));
    }
    await sendOrUpdateEmbed();
    await sendOrUpdateBias();
}

async function handleNewPrint(data) {
    const print = store.addPrint(data);
    console.log(`[+] Print at ${print.price}`);

    const printBalance = store.getPrintBalance(bias.currentPrice);
    bias.updatePrints(printBalance.above, printBalance.below);

    if (alertChannel) {
        await alertChannel.send(buildPrintAlert(print, false, store));
    }
}

async function handleSMT(data) {
    const smt = store.addSMT(data);
    console.log(`[+] SMT ${smt.type} at ${smt.price}`);

    bias.addSMTSignal(smt.type);

    if (alertChannel) {
        await alertChannel.send(buildSMTAlert(smt, store));
    }
    await sendOrUpdateBias();
}

function handlePriceUpdate(price) {
    bias.updatePrice(price);
    tpo.updatePrice(price);

    // Check mitigations
    const mitigated = store.checkMitigation(price);
    if (mitigated.length > 0) {
        console.log(`[-] ${mitigated.length} cluster(s) mitigated at ${price}`);
    }

    // Check print fills
    const filled = store.checkPrintFills(price);
    if (filled.length > 0 && alertChannel) {
        for (const p of filled) {
            alertChannel.send(buildPrintAlert(p, true, store));
        }
    }

    // Check TPO single print fills
    const tpoFilled = tpo.checkSinglePrintFills(price);
    if (tpoFilled.length > 0 && alertChannel) {
        for (const sp of tpoFilled) {
            alertChannel.send(buildTPOSinglePrintAlert(sp, true, config.symbol));
        }
        console.log(`[-] ${tpoFilled.length} TPO single print(s) filled at ${price}`);
    }

    // Update balances for bias
    const balance = store.getClusterBalance(price);
    bias.updateClusters(balance.bullBelow, balance.bearAbove);
    const printBal = store.getPrintBalance(price);
    bias.updatePrints(printBal.above, printBal.below);
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
    console.log(`[TPO] Period ${data.letter} | High: ${data.high} Low: ${data.low}`);

    // Check for newly detected single prints and alert
    if (result && result.singlePrints && result.singlePrints.length > 0) {
        const newPrints = result.singlePrints.filter(sp => !sp.alerted);
        for (const sp of newPrints) {
            if (alertChannel) {
                await alertChannel.send(buildTPOSinglePrintAlert(sp, false, config.symbol));
            }
            sp.alerted = true;
        }
    }

    // Update TPO embed
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

    if (data.rthOpen) {
        tpo.sessionOpen = parseFloat(data.rthOpen);
    }

    // Reset the TPO embed
    tpoMessage = null;
}

function handleTPOSessionClose(data) {
    console.log(`[TPO] Session closed. Periods: ${data.periodsCompleted}, Range: ${data.sessionLow}-${data.sessionHigh}`);
    // Could archive the day's profile here if needed
}

// ==================== WEBHOOK SERVER ====================
const webhook = new WebhookServer(config.webhook.port, config.webhook.secret, {
    onCluster: handleNewCluster,
    onPrint: handleNewPrint,
    onSMT: handleSMT,
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
        store.pruneOld(24);
        bias.reset();
        tpo.reset();
        embedMessage = null;
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
