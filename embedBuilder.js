const { EmbedBuilder } = require('discord.js');

// ==================== CLUSTER EMBED ====================
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
        .setFooter({ text: `Last update: ${now}` });
}

// ==================== BIAS EMBED ====================
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

// ==================== TPO PROFILE EMBED ====================
function buildTPOEmbed(tpoEngine, currentPrice, symbol) {
    const summary = tpoEngine.getSummary(currentPrice);
    const shape = summary.shape;
    const tpoBias = tpoEngine.getTPOBias(currentPrice);

    // Determine embed color from TPO bias
    let color = 0x9E9E9E; // neutral gray
    if (tpoBias.score > 0.3) color = 0x4CAF50;      // green
    else if (tpoBias.score > 0.1) color = 0x81C784;  // light green
    else if (tpoBias.score < -0.3) color = 0xFF5252;  // red
    else if (tpoBias.score < -0.1) color = 0xEF9A9A; // light red

    // Build mini TPO profile display (compact for Discord)
    let profileText = tpoEngine.getProfileDisplay(currentPrice, 20);
    if (profileText.length > 1000) {
        profileText = profileText.substring(0, 997) + '...';
    }

    // Single prints list
    let spText = '';
    const activeSP = summary.singlePrints;
    if (activeSP.length > 0) {
        for (const sp of activeSP.slice(0, 8)) {
            const dir = sp.mid > currentPrice ? '↑' : '↓';
            const dist = Math.abs(sp.mid - currentPrice).toFixed(2);
            spText += `${dir} ${sp.low.toFixed(2)} - ${sp.high.toFixed(2)} (${sp.tickCount} ticks, ${dist} away)\n`;
        }
    } else {
        spText = 'No active single prints';
    }

    // Key levels
    let levelsText = '';
    if (summary.poc) levelsText += `POC: ${summary.poc.toFixed(2)}\n`;
    if (summary.vah) levelsText += `VAH: ${summary.vah.toFixed(2)}\n`;
    if (summary.val) levelsText += `VAL: ${summary.val.toFixed(2)}\n`;
    if (summary.ibHigh) levelsText += `IB High: ${summary.ibHigh.toFixed(2)}\n`;
    if (summary.ibLow) levelsText += `IB Low: ${summary.ibLow.toFixed(2)}`;
    if (!levelsText) levelsText = 'Building...';

    // Shape & bias info
    const shapeEmoji = shape.bias > 0.1 ? '🟢' : shape.bias < -0.1 ? '🔴' : '⚪';
    const biasLabel = tpoBias.score > 0.3 ? 'BULLISH' : tpoBias.score > 0.1 ? 'Lean Bull' :
                      tpoBias.score < -0.3 ? 'BEARISH' : tpoBias.score < -0.1 ? 'Lean Bear' : 'NEUTRAL';

    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`📊 ${symbol} TPO Profile — Period ${summary.currentLetter} (${summary.periodsCompleted} completed)`)
        .setDescription(`\`\`\`\n${profileText}\`\`\``)
        .addFields(
            { name: '📍 Single Prints', value: `\`\`\`\n${spText}\`\`\``, inline: false },
            { name: '📐 Key Levels', value: levelsText, inline: true },
            { name: '🔷 Profile Shape', value: `${shapeEmoji} ${shape.description || shape.shape}\nTPO Bias: **${biasLabel}** (${tpoBias.score > 0 ? '+' : ''}${tpoBias.score.toFixed(2)})`, inline: true },
            { name: '📏 Session Range', value: `High: ${(summary.sessionHigh || 0).toFixed(2)}\nLow: ${(summary.sessionLow || 0).toFixed(2)}\nRange: ${((summary.sessionHigh || 0) - (summary.sessionLow || 0)).toFixed(2)} pts`, inline: true }
        )
        .setFooter({ text: `SP Above: ${summary.printsAbove} | SP Below: ${summary.printsBelow} | IB: ${tpoBias.ibBias.position}` })
        .setTimestamp();

    return embed;
}

// ==================== TPO SINGLE PRINT ALERT ====================
function buildTPOSinglePrintAlert(singlePrint, isFilled, symbol) {
    if (isFilled) {
        return {
            embeds: [new EmbedBuilder()
                .setColor(0xFFA726) // orange
                .setTitle(`📍 Single Print FILLED`)
                .setDescription(`**${symbol}** price traded through single print zone\n\`${singlePrint.low.toFixed(2)} - ${singlePrint.high.toFixed(2)}\``)
                .setFooter({ text: `Letter: ${singlePrint.letter || '?'} | ${singlePrint.tickCount || '?'} ticks` })
                .setTimestamp()
            ]
        };
    }

    // New single print detected
    const dirEmoji = singlePrint.direction === 'above' ? '⬆️' : singlePrint.direction === 'below' ? '⬇️' : '📊';
    const dirLabel = singlePrint.direction === 'above' ? 'ABOVE (resistance)' :
                     singlePrint.direction === 'below' ? 'BELOW (support)' : 'detected';

    return {
        embeds: [new EmbedBuilder()
            .setColor(singlePrint.direction === 'above' ? 0xFF5252 : singlePrint.direction === 'below' ? 0x4CAF50 : 0x2196F3)
            .setTitle(`${dirEmoji} New Single Print ${dirLabel}`)
            .setDescription(
                `**${symbol}** single print zone:\n` +
                `\`\`\`\n` +
                `High:  ${singlePrint.high.toFixed(2)}\n` +
                `Mid:   ${singlePrint.mid.toFixed(2)}\n` +
                `Low:   ${singlePrint.low.toFixed(2)}\n` +
                `Ticks: ${singlePrint.tickCount || '?'}\n` +
                `\`\`\`\n` +
                `> Single prints mark areas of rapid price movement.\n` +
                `> Price tends to revisit and fill these zones.`
            )
            .setFooter({ text: `TPO Letter: ${singlePrint.letter || '?'} | These levels act as magnets` })
            .setTimestamp()
        ]
    };
}

// ==================== SESSION OPEN/CLOSE ALERTS ====================
function buildSessionAlert(event) {
    const { session, emoji, type, color, minutesWarning } = event;

    // Warning alerts (5 min before)
    if (type === 'warning') {
        return {
            embeds: [new EmbedBuilder()
                .setColor(0xFFEB3B) // yellow
                .setTitle(`⏰ ${emoji} ${session} opens in ${minutesWarning} minutes`)
                .setDescription(`Prepare for session open volatility.`)
                .setTimestamp()
            ]
        };
    }

    if (type === 'closing') {
        return {
            embeds: [new EmbedBuilder()
                .setColor(0xFFEB3B)
                .setTitle(`⏰ ${emoji} ${session} closes in ${minutesWarning} minutes`)
                .setDescription(`End-of-session positioning may begin.`)
                .setTimestamp()
            ]
        };
    }

    // Open alert
    if (type === 'open') {
        return {
            embeds: [new EmbedBuilder()
                .setColor(color || 0x4CAF50)
                .setTitle(`${emoji} ${session} — NOW OPEN`)
                .setDescription(
                    `The **${session}** session is now active.\n\n` +
                    getSessionTip(session, 'open')
                )
                .setTimestamp()
            ]
        };
    }

    // Close alert
    if (type === 'close') {
        return {
            embeds: [new EmbedBuilder()
                .setColor(color || 0xFF5252)
                .setTitle(`${emoji} ${session} — NOW CLOSED`)
                .setDescription(
                    `The **${session}** session has ended.\n\n` +
                    getSessionTip(session, 'close')
                )
                .setTimestamp()
            ]
        };
    }

    // Fallback
    return `${emoji} ${session} — ${type}`;
}

/**
 * Get contextual trading tips for session transitions
 */
function getSessionTip(session, type) {
    const tips = {
        'Asia (Tokyo)': {
            open: '> Asian session tends to set the overnight range.\n> Watch for initial direction as a clue for London.',
            close: '> Asian range established. London may break it.\n> Note the high/low for potential targets.',
        },
        'London': {
            open: '> London often sets the daily high or low.\n> Watch for a sweep of Asian range extremes.',
            close: '> London session ended. NY will take over.\n> Check if London high/low holds as S/R.',
        },
        'New York (RTH)': {
            open: '> RTH open — highest volume period begins.\n> Watch IB (first hour) for range context.\n> Opening drive direction often sets the tone.',
            close: '> RTH closed. Regular session complete.\n> Review TPO profile shape for tomorrow\'s bias.\n> Note: ETH continues after hours.',
        },
        'CME Futures Open': {
            open: '> Futures market reopened.\n> Watch for gap fills from prior close.',
            close: '> CME daily maintenance break (5:00-6:00 PM ET).\n> Positions carry into next session.',
        },
        'Pre-Market (Equities)': {
            open: '> Pre-market open. Thin liquidity.\n> Watch for news-driven moves.',
            close: '> Pre-market ending. RTH opens shortly.',
        },
    };

    return tips[session]?.[type] || '> Monitor price action around this transition.';
}

// ==================== ORIGINAL ALERTS ====================
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

// ==================== EXPORTS ====================
module.exports = {
    buildClusterEmbed,
    buildBiasEmbed,
    buildAlertMessage,
    buildSMTAlert,
    buildPrintAlert,
    buildTPOEmbed,
    buildTPOSinglePrintAlert,
    buildSessionAlert,
};
