/**
 * SessionTimer — Schedules alerts for market session opens/closes
 * 
 * Sessions tracked (all times in ET / America/New_York):
 * - Asia (Tokyo):  7:00 PM – 4:00 AM ET
 * - London:        3:00 AM – 12:00 PM ET
 * - New York RTH:  9:30 AM – 4:00 PM ET
 * - New York ETH:  6:00 PM – 5:00 PM ET (next day, nearly 23h)
 * 
 * Also tracks:
 * - CME Futures open/close (6:00 PM – 5:00 PM ET with 1hr break)
 * - Equity pre-market (4:00 AM – 9:30 AM ET)
 * - Equity after-hours (4:00 PM – 8:00 PM ET)
 */

const { EventEmitter } = require('events');

class SessionTimer extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.timezone = config.timezone || 'America/New_York';
        this.timers = [];
        this.running = false;

        // Define all sessions with their times (ET)
        this.sessions = config.sessions?.custom || [
            {
                name: 'Asia (Tokyo)',
                emoji: '🇯🇵',
                openHour: 19, openMin: 0,    // 7:00 PM ET
                closeHour: 4, closeMin: 0,   // 4:00 AM ET (next day)
                crossesMidnight: true,
                color: 0xFFA726,             // Orange
            },
            {
                name: 'London',
                emoji: '🇬🇧',
                openHour: 3, openMin: 0,     // 3:00 AM ET
                closeHour: 12, closeMin: 0,  // 12:00 PM ET
                crossesMidnight: false,
                color: 0x42A5F5,             // Blue
            },
            {
                name: 'New York (RTH)',
                emoji: '🇺🇸',
                openHour: 9, openMin: 30,    // 9:30 AM ET
                closeHour: 16, closeMin: 0,  // 4:00 PM ET
                crossesMidnight: false,
                color: 0x66BB6A,             // Green
            },
            {
                name: 'CME Futures Open',
                emoji: '📈',
                openHour: 18, openMin: 0,    // 6:00 PM ET
                closeHour: 17, closeMin: 0,  // 5:00 PM ET (next day)
                crossesMidnight: true,
                color: 0xAB47BC,             // Purple
                alertOpenOnly: false,
            },
            {
                name: 'Pre-Market (Equities)',
                emoji: '🌅',
                openHour: 4, openMin: 0,     // 4:00 AM ET
                closeHour: 9, closeMin: 30,  // 9:30 AM ET
                crossesMidnight: false,
                color: 0xFFEE58,             // Yellow
                alertCloseOnly: false,       // Don't alert close (RTH open covers it)
            },
        ];

        // Upcoming alerts queue
        this.scheduledAlerts = [];
    }

    /**
     * Start the session timer — schedules all alerts for today and tomorrow
     */
    start() {
        this.running = true;
        this._scheduleAllAlerts();

        // Re-schedule every hour to handle day transitions
        this._rescheduleInterval = setInterval(() => {
            this._scheduleAllAlerts();
        }, 60 * 60 * 1000); // Every hour

        console.log('[SessionTimer] Started — monitoring market sessions');
        this._logUpcoming();
    }

    /**
     * Stop all timers
     */
    stop() {
        this.running = false;
        for (const timer of this.timers) {
            clearTimeout(timer);
        }
        this.timers = [];
        if (this._rescheduleInterval) {
            clearInterval(this._rescheduleInterval);
        }
        console.log('[SessionTimer] Stopped');
    }

    /**
     * Schedule alerts for all sessions (today + tomorrow)
     */
    _scheduleAllAlerts() {
        // Clear existing timers
        for (const timer of this.timers) {
            clearTimeout(timer);
        }
        this.timers = [];
        this.scheduledAlerts = [];

        const now = this._getNowET();

        for (const session of this.sessions) {
            // Schedule for today and tomorrow
            for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
                // Schedule open alert
                if (!session.alertCloseOnly) {
                    const openTime = this._getSessionTime(session.openHour, session.openMin, dayOffset);
                    const msUntilOpen = openTime.getTime() - now.getTime();

                    if (msUntilOpen > 0 && msUntilOpen < 25 * 60 * 60 * 1000) { // Within 25 hours
                        const timer = setTimeout(() => {
                            this._fireAlert(session, 'open');
                        }, msUntilOpen);
                        this.timers.push(timer);
                        this.scheduledAlerts.push({
                            session: session.name,
                            type: 'open',
                            time: openTime,
                            msUntil: msUntilOpen,
                        });

                        // Also fire a 5-min warning
                        const warningMs = msUntilOpen - (5 * 60 * 1000);
                        if (warningMs > 0) {
                            const warnTimer = setTimeout(() => {
                                this._fireAlert(session, 'warning', 5);
                            }, warningMs);
                            this.timers.push(warnTimer);
                        }
                    }
                }

                // Schedule close alert
                if (!session.alertOpenOnly) {
                    let closeOffset = dayOffset;
                    if (session.crossesMidnight) {
                        closeOffset = dayOffset + 1; // Close is next day
                    }

                    const closeTime = this._getSessionTime(session.closeHour, session.closeMin, closeOffset);
                    const msUntilClose = closeTime.getTime() - now.getTime();

                    if (msUntilClose > 0 && msUntilClose < 25 * 60 * 60 * 1000) {
                        const timer = setTimeout(() => {
                            this._fireAlert(session, 'close');
                        }, msUntilClose);
                        this.timers.push(timer);
                        this.scheduledAlerts.push({
                            session: session.name,
                            type: 'close',
                            time: closeTime,
                            msUntil: msUntilClose,
                        });

                        // 5-min warning before close
                        const warningMs = msUntilClose - (5 * 60 * 1000);
                        if (warningMs > 0) {
                            const warnTimer = setTimeout(() => {
                                this._fireAlert(session, 'closing', 5);
                            }, warningMs);
                            this.timers.push(warnTimer);
                        }
                    }
                }
            }
        }

        // Sort scheduled alerts by time
        this.scheduledAlerts.sort((a, b) => a.msUntil - b.msUntil);
    }

    /**
     * Fire a session alert event
     */
    _fireAlert(session, type, minutesWarning = 0) {
        if (!this.running) return;

        const event = {
            session: session.name,
            emoji: session.emoji,
            type,  // 'open', 'close', 'warning', 'closing'
            color: session.color,
            minutesWarning,
            timestamp: new Date(),
        };

        console.log(`[SessionTimer] ${session.emoji} ${session.name} ${type}${minutesWarning ? ` (${minutesWarning}min warning)` : ''}`);
        this.emit('session', event);
    }

    /**
     * Get current time in ET
     */
    _getNowET() {
        return new Date(new Date().toLocaleString('en-US', { timeZone: this.timezone }));
    }

    /**
     * Get a specific time today (or +dayOffset days) in ET, returned as system Date
     */
    _getSessionTime(hour, minute, dayOffset = 0) {
        const now = new Date();
        // Get today's date in ET
        const etNow = new Date(now.toLocaleString('en-US', { timeZone: this.timezone }));
        
        // Set the target time in ET
        const target = new Date(etNow);
        target.setDate(target.getDate() + dayOffset);
        target.setHours(hour, minute, 0, 0);

        // Calculate the offset between ET target and system time
        const etOffset = target.getTime() - etNow.getTime();
        return new Date(now.getTime() + etOffset);
    }

    /**
     * Get current active sessions
     */
    getActiveSessions() {
        const now = this._getNowET();
        const currentHour = now.getHours();
        const currentMin = now.getMinutes();
        const currentTimeMin = currentHour * 60 + currentMin;

        const active = [];

        for (const session of this.sessions) {
            const openMin = session.openHour * 60 + session.openMin;
            const closeMin = session.closeHour * 60 + session.closeMin;

            let isActive = false;
            if (session.crossesMidnight) {
                // Active if after open OR before close
                isActive = currentTimeMin >= openMin || currentTimeMin < closeMin;
            } else {
                isActive = currentTimeMin >= openMin && currentTimeMin < closeMin;
            }

            if (isActive) {
                active.push({
                    name: session.name,
                    emoji: session.emoji,
                    color: session.color,
                    closesIn: this._getMinutesUntilClose(session, currentTimeMin),
                });
            }
        }

        return active;
    }

    /**
     * Get upcoming session events (next N)
     */
    getUpcoming(limit = 5) {
        return this.scheduledAlerts.slice(0, limit).map(a => ({
            session: a.session,
            type: a.type,
            time: a.time,
            minutesUntil: Math.round(a.msUntil / 60000),
            formattedTime: this._formatTimeET(a.time),
        }));
    }

    /**
     * Get minutes until a session closes
     */
    _getMinutesUntilClose(session, currentTimeMin) {
        const closeMin = session.closeHour * 60 + session.closeMin;

        if (session.crossesMidnight) {
            if (currentTimeMin >= session.openHour * 60 + session.openMin) {
                // After open, before midnight
                return (24 * 60 - currentTimeMin) + closeMin;
            } else {
                // After midnight, before close
                return closeMin - currentTimeMin;
            }
        }
        return closeMin - currentTimeMin;
    }

    /**
     * Format time for display
     */
    _formatTimeET(date) {
        return new Intl.DateTimeFormat('en-US', {
            timeZone: this.timezone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
        }).format(date);
    }

    /**
     * Check if today is a trading day (Mon-Fri)
     */
    isTradingDay() {
        const now = this._getNowET();
        const day = now.getDay();
        return day >= 1 && day <= 5; // Monday=1 through Friday=5
    }

    /**
     * Log upcoming alerts to console
     */
    _logUpcoming() {
        const upcoming = this.getUpcoming(6);
        if (upcoming.length === 0) {
            console.log('[SessionTimer] No upcoming sessions scheduled');
            return;
        }
        console.log('[SessionTimer] Upcoming:');
        for (const u of upcoming) {
            console.log(`  ${u.session} ${u.type} — ${u.formattedTime} (in ${u.minutesUntil} min)`);
        }
    }

    /**
     * Get full session schedule for display
     */
    getScheduleDisplay() {
        const lines = [];
        for (const s of this.sessions) {
            const openStr = this._formatHourMin(s.openHour, s.openMin);
            const closeStr = this._formatHourMin(s.closeHour, s.closeMin);
            lines.push(`${s.emoji} ${s.name}: ${openStr} – ${closeStr} ET`);
        }
        return lines.join('\n');
    }

    _formatHourMin(hour, min) {
        const period = hour >= 12 ? 'PM' : 'AM';
        const h = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
        return `${h}:${min.toString().padStart(2, '0')} ${period}`;
    }
}

module.exports = SessionTimer;
