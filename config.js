require('dotenv').config();

module.exports = {
    token: process.env.DISCORD_TOKEN,
    channelId: process.env.CHANNEL_ID,
    symbol: process.env.SYMBOL || 'NQ',
    updateInterval: parseInt(process.env.UPDATE_INTERVAL || '30') * 1000,
    timezone: process.env.TIMEZONE || 'America/New_York',

    // Session times (ET) — used by bot for RTH detection
    session: {
        ethStart: '18:00',   // ETH opens 6pm prior day
        rthStart: '09:30',   // RTH opens 9:30am
        rthEnd: '16:00',     // RTH closes 4pm
        ethEnd: '17:00',     // ETH closes 5pm
    },

    // Market sessions for SessionTimer alerts
    // Each session: { name, emoji, openHour, openMin, closeHour, closeMin, crossesMidnight, color }
    // Override with custom sessions if needed (otherwise defaults in sessionTimer.js are used)
    sessions: {
        // Set to null to use built-in defaults, or provide custom array:
        // custom: [ { name: 'Asia', emoji: '🇯🇵', openHour: 19, ... } ]
        custom: null,
    },

    // TPO (Time Price Opportunity) settings
    tpo: {
        tickSize: parseFloat(process.env.TPO_TICK_SIZE || '0.25'),   // NQ tick = 0.25
        periodMinutes: parseInt(process.env.TPO_PERIOD || '30'),      // 30-min TPO periods (standard)
        minSinglePrintTicks: 2,   // Minimum consecutive single-TPO levels to count as a single print
    },

    // Bias engine weights (total should approximate 1.0)
    // Original factors
    bias: {
        overnightWeight: 0.12,
        openingDriveWeight: 0.15,
        deltaWeight: 0.15,
        clusterBalanceWeight: 0.12,
        printBalanceWeight: 0.08,
        priorDayWeight: 0.08,
        smtWeight: 0.08,
        // TPO-derived factors (new)
        tpoShapeWeight: 0.10,          // b-shape/p-shape contribution
        tpoSinglePrintWeight: 0.07,    // single print positioning above/below
        tpoIBWeight: 0.05,             // Initial Balance extension
    },

    webhook: {
        port: parseInt(process.env.WEBHOOK_PORT || '3000'),
        secret: process.env.WEBHOOK_SECRET || '',
    }
};
