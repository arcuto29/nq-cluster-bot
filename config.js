require('dotenv').config();

module.exports = {
    token: process.env.DISCORD_TOKEN,
    channelId: process.env.CHANNEL_ID,
    symbol: process.env.SYMBOL || 'NQ',
    updateInterval: parseInt(process.env.UPDATE_INTERVAL || '30') * 1000,
    timezone: process.env.TIMEZONE || 'America/New_York',

    // Session times (ET)
    session: {
        ethStart: '18:00',   // ETH opens 6pm prior day
        rthStart: '09:30',   // RTH opens 9:30am
        rthEnd: '16:00',     // RTH closes 4pm
        ethEnd: '17:00',     // ETH closes 5pm
    },

    // Bias engine weights (total should = 1.0)
    bias: {
        overnightWeight: 0.15,
        openingDriveWeight: 0.20,
        deltaWeight: 0.20,
        clusterBalanceWeight: 0.15,
        printBalanceWeight: 0.10,
        priorDayWeight: 0.10,
        smtWeight: 0.10,
    },

    webhook: {
        port: parseInt(process.env.WEBHOOK_PORT || '3000'),
        secret: process.env.WEBHOOK_SECRET || '',
    }
};
