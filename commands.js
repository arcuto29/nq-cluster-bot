const { SlashCommandBuilder } = require('discord.js');
const { buildClusterEmbed, buildBiasEmbed } = require('./embedBuilder');

function registerCommands(client, store, biasEngine, config) {
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
                    const { above, below } = store.getClosestPrints(currentPrice, 5);
                    let msg = '**Active Single Prints:**\n```\n';
                    for (const p of [...above].reverse()) {
                        msg += `${store.formatPrice(p.price)} ↑\n`;
                    }
                    msg += `--- current: ${currentPrice.toFixed(2)} ---\n`;
                    for (const p of below) {
                        msg += `${store.formatPrice(p.price)} ↓\n`;
                    }
                    if (!above.length && !below.length) msg += 'No active prints.\n';
                    msg += '```';
                    await interaction.reply(msg);
                    break;
                }
                case 'stats': {
                    const s = store.getStats();
                    const bias = biasEngine.getBiasLabel();
                    let msg = `**${config.symbol} Session Stats:**\n`;
                    msg += `> Bias: ${bias.emoji} ${bias.label}\n`;
                    msg += `> Clusters: ${s.active} active / ${s.total} total\n`;
                    msg += `> Bull: ${s.bull} | Bear: ${s.bear}\n`;
                    msg += `> Mitigated: ${s.mitigated} (Hold rate: ${s.holdRate}%)\n`;
                    msg += `> Single Prints: ${s.activePrints} unfilled\n`;
                    msg += `> SMT Signals: ${s.smtToday} today`;
                    await interaction.reply(msg);
                    break;
                }
                case 'clear': {
                    store.clearAll();
                    biasEngine.reset();
                    await interaction.reply('✅ All clusters, prints, and signals cleared. Session reset.');
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
