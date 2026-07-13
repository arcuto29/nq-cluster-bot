require('dotenv').config();

module.exports = {
    token: process.env.DISCORD_TOKEN,
    channelId: process.env.CHANNEL_ID,
    symbol: process.env.SYMBOL || 'NQ',
    updateInterval: parseInt(process.env.UPDATE_INTERVAL || '30') * 1000,
    timezone: process.env.TIMEZONE || 'America/Los_Angeles',

    // Session times (PST)
    session: {
        ethStart: '15:00',   // ETH opens 3pm PST (6pm ET)
        rthStart: '06:30',   // RTH opens 6:30am PST (9:30am ET)
        rthEnd: '13:00',     // RTH closes 1pm PST (4pm ET)
        ethEnd: '14:00',     // ETH closes 2pm PST (5pm ET)
    },

    // Market session alerts (null = use built-in defaults)
    sessions: { custom: null },

    // TPO (Time Price Opportunity) settings
    tpo: {
        tickSize: parseFloat(process.env.TPO_TICK_SIZE || '0.25'),
        periodMinutes: parseInt(process.env.TPO_PERIOD || '30'),
        minSinglePrintTicks: 2,
    },

    // Bias engine weights (total ~1.0)
    bias: {
        overnightWeight: 0.20,
        openingDriveWeight: 0.18,
        deltaWeight: 0.15,
        tpoShapeWeight: 0.18,
        tpoSinglePrintWeight: 0.14,
        tpoIBWeight: 0.10,
        priorDayWeight: 0.05,
    },

    webhook: {
        port: parseInt(process.env.WEBHOOK_PORT || '3000'),
        secret: process.env.WEBHOOK_SECRET || '',
    }
};
