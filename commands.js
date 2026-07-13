const { SlashCommandBuilder } = require('discord.js');
const { buildClusterEmbed, buildBiasEmbed, buildTPOEmbed } = require('./embedBuilder');

function registerCommands(client, store, biasEngine, tpoEngine, sessionTimer, config) {
    const commands = [
        new SlashCommandBuilder()
            .setName('clusters')
            .setDescription('Show closest NQ clusters above/below price'),
        new SlashCommandBuilder()
            .setName('bias')
            .setDescription('Show daily NQ bias with factor breakdown'),
        new SlashCommandBuilder()
            .setName('prints')
            .setDescription('Show active single print levels'),
        new SlashCommandBuilder()
            .setName('tpo')
            .setDescription('Show current TPO profile, single prints, and shape analysis'),
        new SlashCommandBuilder()
            .setName('sessions')
            .setDescription('Show market session schedule and active sessions'),
        new SlashCommandBuilder()
            .setName('stats')
            .setDescription('Show session cluster statistics'),
        new SlashCommandBuilder()
            .setName('clear')
            .setDescription('Clear all clusters and reset session'),
    ];

    // Register slash commands
    client.once('ready', async () => {
        try {
            await client.application.commands.set(commands);
            console.log('[Commands] Slash commands registered');
        } catch (err) {
            console.error('[Commands] Failed to register:', err.message);
        }
    });

    // Handle interactions
    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isChatInputCommand()) return;

        const { commandName } = interaction;
        let currentPrice = biasEngine.currentPrice || 0;

        try {
            switch (commandName) {
                case 'clusters': {
                    const embed = buildClusterEmbed(store, currentPrice, config.symbol, config.timezone);
                    await interaction.reply({ embeds: [embed] });
                    break;
                }

                case 'bias': {
                    const embed = buildBiasEmbed(biasEngine, store, currentPrice, config.symbol);
                    await interaction.reply({ embeds: [embed] });
                    break;
                }

                case 'prints': {
                    // Show both webhook-based prints AND TPO single prints
                    let msg = `**${config.symbol} Active Single Prints:**\n\n`;

                    // Webhook-sourced prints (from cluster indicator)
                    const { above, below } = store.getClosestPrints(currentPrice, 5);
                    if (above.length || below.length) {
                        msg += '**Cluster Prints:**\n```\n';
                        for (const p of [...above].reverse()) {
                            msg += `${store.formatPrice(p.price)} ↑\n`;
                        }
                        msg += `--- current: ${currentPrice.toFixed(2)} ---\n`;
                        for (const p of below) {
                            msg += `${store.formatPrice(p.price)} ↓\n`;
                        }
                        msg += '```\n';
                    }

                    // TPO single prints
                    const tpoSummary = tpoEngine.getSummary(currentPrice);
                    const tpoPrints = tpoSummary.singlePrints;
                    if (tpoPrints.length > 0) {
                        msg += '**TPO Single Prints (gaps in profile):**\n```\n';
                        const spAbove = tpoPrints.filter(sp => sp.mid > currentPrice).sort((a, b) => a.mid - b.mid);
                        const spBelow = tpoPrints.filter(sp => sp.mid <= currentPrice).sort((a, b) => b.mid - a.mid);

                        for (const sp of [...spAbove].reverse()) {
                            const dist = (sp.mid - currentPrice).toFixed(2);
                            msg += `↑ ${sp.low.toFixed(2)} - ${sp.high.toFixed(2)} (${sp.tickCount} ticks, +${dist})\n`;
                        }
                        msg += `--- current: ${currentPrice.toFixed(2)} ---\n`;
                        for (const sp of spBelow) {
                            const dist = (currentPrice - sp.mid).toFixed(2);
                            msg += `↓ ${sp.low.toFixed(2)} - ${sp.high.toFixed(2)} (${sp.tickCount} ticks, -${dist})\n`;
                        }
                        msg += '```\n';

                        // Bias interpretation
                        const spBias = tpoEngine.getSinglePrintBias(currentPrice);
                        if (spBias.below > spBias.above) {
                            msg += `> 🟢 More prints **below** = support cushion = bullish lean`;
                        } else if (spBias.above > spBias.below) {
                            msg += `> 🔴 More prints **above** = resistance above = bearish lean`;
                        } else {
                            msg += `> ⚪ Prints balanced above/below = neutral`;
                        }
                    }

                    if (!above.length && !below.length && tpoPrints.length === 0) {
                        msg += 'No active prints detected yet.';
                    }

                    await interaction.reply(msg);
                    break;
                }

                case 'tpo': {
                    if (tpoEngine.profile.size === 0) {
                        await interaction.reply('📊 No TPO data yet. Waiting for session data from TradingView...');
                        break;
                    }
                    const embed = buildTPOEmbed(tpoEngine, currentPrice, config.symbol);
                    await interaction.reply({ embeds: [embed] });
                    break;
                }

                case 'sessions': {
                    const active = sessionTimer.getActiveSessions();
                    const upcoming = sessionTimer.getUpcoming(6);
                    const schedule = sessionTimer.getScheduleDisplay();

                    let msg = `**Market Sessions (ET)**\n\n`;

                    // Active sessions
                    if (active.length > 0) {
                        msg += '**Currently Active:**\n';
                        for (const s of active) {
                            msg += `> ${s.emoji} ${s.name} — closes in ~${s.closesIn} min\n`;
                        }
                        msg += '\n';
                    } else {
                        msg += '> No sessions currently active\n\n';
                    }

                    // Upcoming events
                    if (upcoming.length > 0) {
                        msg += '**Upcoming:**\n';
                        for (const u of upcoming) {
                            const typeEmoji = u.type === 'open' ? '🟢' : '🔴';
                            msg += `> ${typeEmoji} ${u.session} ${u.type} — ${u.formattedTime} (in ${u.minutesUntil} min)\n`;
                        }
                        msg += '\n';
                    }

                    // Full schedule
                    msg += '**Full Schedule:**\n```\n' + schedule + '\n```';

                    await interaction.reply(msg);
                    break;
                }

                case 'stats': {
                    const s = store.getStats();
                    const bias = biasEngine.getBiasLabel();
                    const tpoSummary = tpoEngine.getSummary(currentPrice);

                    let msg = `**${config.symbol} Session Stats:**\n`;
                    msg += `> Bias: ${bias.emoji} ${bias.label}\n`;
                    msg += `> Clusters: ${s.active} active / ${s.total} total\n`;
                    msg += `> Bull: ${s.bull} | Bear: ${s.bear}\n`;
                    msg += `> Mitigated: ${s.mitigated} (Hold rate: ${s.holdRate}%)\n`;
                    msg += `> Single Prints: ${s.activePrints} unfilled\n`;
                    msg += `> SMT Signals: ${s.smtToday} today\n`;
                    msg += `\n**TPO Stats:**\n`;
                    msg += `> Periods: ${tpoSummary.periodsCompleted} (Letter: ${tpoSummary.currentLetter})\n`;
                    msg += `> Shape: ${tpoSummary.shape.description || tpoSummary.shape.shape}\n`;
                    msg += `> TPO Single Prints: ${tpoSummary.singlePrintCount} (${tpoSummary.printsAbove} above / ${tpoSummary.printsBelow} below)\n`;
                    if (tpoSummary.poc) msg += `> POC: ${tpoSummary.poc.toFixed(2)}\n`;
                    if (tpoSummary.ibHigh && tpoSummary.ibLow) {
                        msg += `> IB: ${tpoSummary.ibLow.toFixed(2)} - ${tpoSummary.ibHigh.toFixed(2)}`;
                    }

                    await interaction.reply(msg);
                    break;
                }

                case 'clear': {
                    store.clearAll();
                    biasEngine.reset();
                    tpoEngine.reset();
                    await interaction.reply('All clusters, prints, TPO profile, and signals cleared. Session reset.');
                    break;
                }
            }
        } catch (err) {
            console.error(`[Command] Error in /${commandName}:`, err.message);
            await interaction.reply({ content: 'Error processing command.', ephemeral: true });
        }
    });
}

module.exports = { registerCommands };
