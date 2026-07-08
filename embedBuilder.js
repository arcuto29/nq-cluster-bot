const { EmbedBuilder } = require('discord.js');

function buildClusterEmbed(store, currentPrice, symbol, timezone) {
    const { above, below } = store.getClosestClusters(currentPrice, 5);
    let list = '';
    const aboveReversed = [...above].reverse();
    for (const c of aboveReversed) {
        const emoji = c.type === 'bearish' ? '🟥' : '🟩';
        const time = store.formatTime(c.timestamp);
        list += `${time} | ${emoji} | ${store.formatPrice(c.priceLow)} - ${store.formatPrice(c.priceHigh)} | ${c.timeframe}\n`;
    }
    list += `  ~~~~~~~~~~~~~ current price ~~~~~~~~~~~~~\n`;
    for (const c of below) {
        const emoji = c.type === 'bearish' ? '🟥' : '🟩';
        const time = store.formatTime(c.timestamp);
        list += `${time} | ${emoji} | ${store.formatPrice(c.priceLow)} - ${store.formatPrice(c.priceHigh)} | ${c.timeframe}\n`;
    }
    if (!above.length && !below.length) list = 'No active clusters yet.\n';

    const now = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone, month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: true
    }).format(new Date());

    return new EmbedBuilder()
        .setColor(0x2f3136)
        .setDescription(`**Closest clusters:**\n\`\`\`\n${list}\`\`\``)
        .setFooter({ text: `Last update: • ${now}` });
}


function buildBiasEmbed(biasEngine, store, currentPrice, symbol) {
    const bias = biasEngine.getBiasLabel();
    const score = biasEngine.calculateBias();
    const breakdown = biasEngine.getBreakdown();
    const stats = store.getStats();

    let breakdownText = '';
    for (const f of breakdown) {
        const icon = f.score === '+' ? '🟢' : f.score === '-' ? '🔴' : '⚪';
        breakdownText += `${icon} ${f.name}: ${f.value}\n`;
    }
    if (!breakdownText) breakdownText = 'Waiting for session data...\n';

    const scoreBar = buildScoreBar(score);

    const embed = new EmbedBuilder()
        .setColor(bias.color)
        .setTitle(`${bias.emoji} ${symbol} Daily Bias: ${bias.label}`)
        .setDescription(`\`\`\`\n${scoreBar}\n\`\`\``)
        .addFields(
            { name: 'Bias Factors', value: breakdownText, inline: false },
            { name: 'Session Stats', value: `Clusters: ${stats.active} active (${stats.bull}B/${stats.bear}S)\nPrints: ${stats.activePrints} unfilled\nSMT: ${stats.smtToday} signals\nHold Rate: ${stats.holdRate}%`, inline: true },
            { name: 'Price', value: `Current: ${currentPrice.toFixed(2)}`, inline: true }
        )
        .setTimestamp();

    return embed;
}

function buildScoreBar(score) {
    // Visual bar: -1 ████████|████████ +1
    const total = 20;
    const mid = total / 2;
    const pos = Math.round((score + 1) / 2 * total);
    let bar = 'BEAR ';
    for (let i = 0; i < total; i++) {
        if (i === mid) bar += '|';
        else if (i === pos) bar += '◆';
        else bar += '─';
    }
    bar += ' BULL';
    return bar;
}

function buildAlertMessage(cluster, store) {
    const time = store.formatTime(cluster.timestamp);
    const range = `${store.formatPrice(cluster.priceLow)} - ${store.formatPrice(cluster.priceHigh)}`;
    return `New ${cluster.type} ${cluster.timeframe} cluster | ${time} | ${range}`;
}

function buildSMTAlert(smt, store) {
    const time = store.formatTime(smt.timestamp);
    const emoji = smt.type === 'bullish' ? '🟢' : '🔴';
    return `${emoji} SMT ${smt.type} divergence | ${time} | Price: ${store.formatPrice(smt.price)}`;
}

function buildPrintAlert(print, isFilled, store) {
    const time = store.formatTime(print.timestamp);
    if (isFilled) {
        return `📍 Single print **filled** at ${store.formatPrice(print.price)}`;
    }
    return `📊 New single print level: ${store.formatPrice(print.price)}`;
}

module.exports = { buildClusterEmbed, buildBiasEmbed, buildAlertMessage, buildSMTAlert, buildPrintAlert };
