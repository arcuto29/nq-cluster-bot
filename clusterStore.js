/**
 * ClusterStore — Manages clusters, single prints, and SMT signals
 */
class ClusterStore {
    constructor(config) {
        this.clusters = [];
        this.prints = [];       // Active single print levels
        this.smtSignals = [];   // Recent SMT divergence signals
        this.maxClusters = 100;
        this.maxPrints = 50;
        this.maxSMT = 20;
        this.timezone = config.timezone || 'America/New_York';

        // Stats
        this.stats = {
            totalClusters: 0,
            mitigatedClusters: 0,
            heldClusters: 0,
            bullClusters: 0,
            bearClusters: 0,
        };
    }

    // ==================== CLUSTERS ====================
    addCluster(data) {
        const entry = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
            type: data.type,
            timeframe: data.timeframe || '1m',
            priceHigh: parseFloat(data.priceHigh),
            priceLow: parseFloat(data.priceLow),
            timestamp: data.timestamp || new Date(),
            strength: data.strength || 1,
            mitigated: false,
        };
        this.clusters.push(entry);
        this.stats.totalClusters++;
        if (entry.type === 'bullish') this.stats.bullClusters++;
        else this.stats.bearClusters++;

        if (this.clusters.length > this.maxClusters) {
            this.clusters = this.clusters.slice(-this.maxClusters);
        }
        return entry;
    }

    checkMitigation(price) {
        const mitigated = [];
        this.clusters = this.clusters.filter(c => {
            if (c.mitigated) return false;
            let broken = false;
            if (c.type === 'bullish' && price < c.priceLow) broken = true;
            if (c.type === 'bearish' && price > c.priceHigh) broken = true;
            if (broken) {
                c.mitigated = true;
                this.stats.mitigatedClusters++;
                mitigated.push(c);
                return false;
            }
            return true;
        });
        return mitigated;
    }

    getClosestClusters(price, limit = 5) {
        const active = this.clusters.filter(c => !c.mitigated);
        const above = active
            .filter(c => c.priceLow >= price)
            .sort((a, b) => a.priceLow - b.priceLow)
            .slice(0, limit);
        const below = active
            .filter(c => c.priceHigh < price)
            .sort((a, b) => b.priceHigh - a.priceHigh)
            .slice(0, limit);
        return { above, below };
    }

    getClusterBalance(price) {
        const active = this.clusters.filter(c => !c.mitigated);
        const bullBelow = active.filter(c => c.type === 'bullish' && c.priceHigh < price).length;
        const bearAbove = active.filter(c => c.type === 'bearish' && c.priceLow > price).length;
        return { bullBelow, bearAbove };
    }

    // ==================== SINGLE PRINTS ====================
    addPrint(data) {
        const entry = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
            price: parseFloat(data.price),
            timestamp: data.timestamp || new Date(),
            timeframe: data.timeframe || '1D',
            filled: false,
        };
        this.prints.push(entry);
        if (this.prints.length > this.maxPrints) {
            this.prints = this.prints.slice(-this.maxPrints);
        }
        return entry;
    }

    checkPrintFills(price) {
        const filled = [];
        this.prints = this.prints.filter(p => {
            if (Math.abs(price - p.price) < 0.5) { // Within 0.50 of print = filled
                p.filled = true;
                filled.push(p);
                return false;
            }
            return true;
        });
        return filled;
    }

    getClosestPrints(price, limit = 5) {
        const active = this.prints.filter(p => !p.filled);
        const above = active.filter(p => p.price > price).sort((a, b) => a.price - b.price).slice(0, limit);
        const below = active.filter(p => p.price <= price).sort((a, b) => b.price - a.price).slice(0, limit);
        return { above, below };
    }

    getPrintBalance(price) {
        const active = this.prints.filter(p => !p.filled);
        const above = active.filter(p => p.price > price).length;
        const below = active.filter(p => p.price <= price).length;
        return { above, below };
    }

    // ==================== SMT ====================
    addSMT(data) {
        const entry = {
            id: Date.now().toString(36),
            type: data.type, // 'bullish' or 'bearish'
            price: parseFloat(data.price),
            timestamp: data.timestamp || new Date(),
        };
        this.smtSignals.push(entry);
        if (this.smtSignals.length > this.maxSMT) {
            this.smtSignals = this.smtSignals.slice(-this.maxSMT);
        }
        return entry;
    }

    getRecentSMT(minutes = 60) {
        const cutoff = Date.now() - (minutes * 60 * 1000);
        return this.smtSignals.filter(s => new Date(s.timestamp).getTime() > cutoff);
    }

    // ==================== STATS ====================
    getStats() {
        const active = this.clusters.filter(c => !c.mitigated).length;
        const holdRate = this.stats.totalClusters > 0
            ? Math.round(((this.stats.totalClusters - this.stats.mitigatedClusters) / this.stats.totalClusters) * 100)
            : 0;
        return {
            total: this.stats.totalClusters,
            active,
            mitigated: this.stats.mitigatedClusters,
            holdRate,
            bull: this.stats.bullClusters,
            bear: this.stats.bearClusters,
            activePrints: this.prints.filter(p => !p.filled).length,
            smtToday: this.smtSignals.length,
        };
    }

    // ==================== UTILS ====================
    formatTime(date) {
        const d = new Date(date);
        const opts = { timeZone: this.timezone, year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false };
        const parts = new Intl.DateTimeFormat('en-US', opts).formatToParts(d);
        const get = (type) => parts.find(p => p.type === type)?.value || '';
        return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
    }

    formatPrice(price) {
        return parseFloat(price).toFixed(2);
    }

    pruneOld(hours = 24) {
        const cutoff = Date.now() - (hours * 60 * 60 * 1000);
        this.clusters = this.clusters.filter(c => new Date(c.timestamp).getTime() > cutoff);
        this.prints = this.prints.filter(p => new Date(p.timestamp).getTime() > cutoff);
        this.smtSignals = this.smtSignals.filter(s => new Date(s.timestamp).getTime() > cutoff);
    }

    clearAll() {
        this.clusters = [];
        this.prints = [];
        this.smtSignals = [];
        this.stats = { totalClusters: 0, mitigatedClusters: 0, heldClusters: 0, bullClusters: 0, bearClusters: 0 };
    }
}

module.exports = ClusterStore;
