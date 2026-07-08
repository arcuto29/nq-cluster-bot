/**
 * BiasEngine — Determines daily NQ bias using multiple factors
 * 
 * Scores from -1 (strong bearish) to +1 (strong bullish)
 * Updated in real-time as new data comes in
 */
class BiasEngine {
    constructor(config) {
        this.config = config;
        this.weights = config.bias;

        // Daily tracking data
        this.reset();
    }

    reset() {
        // Overnight data
        this.overnightHigh = null;
        this.overnightLow = null;
        this.overnightMid = null;
        this.rthOpenPrice = null;

        // Prior day levels
        this.priorDayPOC = null;
        this.priorDayVAH = null;
        this.priorDayVAL = null;
        this.priorDayClose = null;

        // Opening drive
        this.openingDriveComplete = false;
        this.openingDriveDirection = 0; // -1, 0, +1
        this.first15minHigh = null;
        this.first15minLow = null;
        this.first15minClose = null;

        // Running delta
        this.totalBuyVol = 0;
        this.totalSellVol = 0;

        // Cluster balance
        this.bullClustersBelow = 0;
        this.bearClustersAbove = 0;

        // Print balance
        this.printsAbove = 0;
        this.printsBelow = 0;

        // SMT
        this.smtBullSignals = 0;
        this.smtBearSignals = 0;

        // Current price
        this.currentPrice = 0;

        // Timestamps
        this.sessionDate = new Date().toDateString();
    }

    /**
     * Set prior day reference levels (from TradingView webhook)
     */
    setPriorDayLevels(data) {
        if (data.poc) this.priorDayPOC = data.poc;
        if (data.vah) this.priorDayVAH = data.vah;
        if (data.val) this.priorDayVAL = data.val;
        if (data.close) this.priorDayClose = data.close;
    }

    /**
     * Set overnight range
     */
    setOvernightRange(high, low) {
        this.overnightHigh = high;
        this.overnightLow = low;
        this.overnightMid = (high + low) / 2;
    }

    /**
     * Called at RTH open
     */
    setRTHOpen(price) {
        this.rthOpenPrice = price;
    }

    /**
     * Update with opening drive data (first 15 min)
     */
    setOpeningDrive(high, low, closePrice) {
        this.first15minHigh = high;
        this.first15minLow = low;
        this.first15minClose = closePrice;
        this.openingDriveComplete = true;

        if (this.priorDayPOC) {
            this.openingDriveDirection = closePrice > this.priorDayPOC ? 1 : closePrice < this.priorDayPOC ? -1 : 0;
        } else {
            this.openingDriveDirection = closePrice > this.rthOpenPrice ? 1 : -1;
        }
    }

    /**
     * Update volume delta
     */
    updateDelta(buyVol, sellVol) {
        this.totalBuyVol += buyVol;
        this.totalSellVol += sellVol;
    }

    /**
     * Update cluster balance
     */
    updateClusters(bullBelow, bearAbove) {
        this.bullClustersBelow = bullBelow;
        this.bearClustersAbove = bearAbove;
    }

    /**
     * Update print balance
     */
    updatePrints(above, below) {
        this.printsAbove = above;
        this.printsBelow = below;
    }

    /**
     * Register SMT signal
     */
    addSMTSignal(type) {
        if (type === 'bullish') this.smtBullSignals++;
        if (type === 'bearish') this.smtBearSignals++;
    }

    /**
     * Update current price
     */
    updatePrice(price) {
        this.currentPrice = price;
    }

    /**
     * Calculate overall bias score (-1 to +1)
     */
    calculateBias() {
        let score = 0;

        // 1. Overnight positioning
        if (this.overnightMid && this.currentPrice) {
            const overnightScore = this.currentPrice > this.overnightMid ? 1 : -1;
            score += overnightScore * this.weights.overnightWeight;
        }

        // 2. Opening drive
        if (this.openingDriveComplete) {
            score += this.openingDriveDirection * this.weights.openingDriveWeight;
        }

        // 3. Delta (buy vs sell aggression)
        const totalVol = this.totalBuyVol + this.totalSellVol;
        if (totalVol > 0) {
            const buyPct = this.totalBuyVol / totalVol;
            const deltaScore = (buyPct - 0.5) * 2; // Normalize to -1 to +1
            score += Math.max(-1, Math.min(1, deltaScore)) * this.weights.deltaWeight;
        }

        // 4. Cluster balance
        const totalClusters = this.bullClustersBelow + this.bearClustersAbove;
        if (totalClusters > 0) {
            const clusterScore = (this.bullClustersBelow - this.bearClustersAbove) / totalClusters;
            score += clusterScore * this.weights.clusterBalanceWeight;
        }

        // 5. Print balance (more prints below = support = bullish)
        const totalPrints = this.printsAbove + this.printsBelow;
        if (totalPrints > 0) {
            const printScore = (this.printsBelow - this.printsAbove) / totalPrints;
            score += printScore * this.weights.printBalanceWeight;
        }

        // 6. Prior day close relative to VA
        if (this.priorDayClose && this.priorDayVAH && this.priorDayVAL) {
            let priorScore = 0;
            if (this.priorDayClose > this.priorDayVAH) priorScore = 1;
            else if (this.priorDayClose < this.priorDayVAL) priorScore = -1;
            else priorScore = 0;
            score += priorScore * this.weights.priorDayWeight;
        }

        // 7. SMT signals
        const totalSMT = this.smtBullSignals + this.smtBearSignals;
        if (totalSMT > 0) {
            const smtScore = (this.smtBullSignals - this.smtBearSignals) / totalSMT;
            score += smtScore * this.weights.smtWeight;
        }

        return Math.max(-1, Math.min(1, score));
    }

    /**
     * Get bias label from score
     */
    getBiasLabel() {
        const score = this.calculateBias();
        if (score >= 0.5) return { label: 'STRONG BULLISH', emoji: '🟢🟢', color: 0x00E676 };
        if (score >= 0.2) return { label: 'BULLISH', emoji: '🟢', color: 0x4CAF50 };
        if (score > -0.2) return { label: 'NEUTRAL', emoji: '⚪', color: 0x9E9E9E };
        if (score > -0.5) return { label: 'BEARISH', emoji: '🔴', color: 0xFF5252 };
        return { label: 'STRONG BEARISH', emoji: '🔴🔴', color: 0xB71C1C };
    }

    /**
     * Get detailed breakdown for display
     */
    getBreakdown() {
        const factors = [];

        // Overnight
        if (this.overnightMid && this.currentPrice) {
            const dir = this.currentPrice > this.overnightMid ? '↑ Above' : '↓ Below';
            factors.push({ name: 'Overnight Mid', value: dir, score: this.currentPrice > this.overnightMid ? '+' : '-' });
        }

        // Opening drive
        if (this.openingDriveComplete) {
            const dir = this.openingDriveDirection > 0 ? '↑ Bullish' : this.openingDriveDirection < 0 ? '↓ Bearish' : '→ Neutral';
            factors.push({ name: 'Opening Drive', value: dir, score: this.openingDriveDirection > 0 ? '+' : this.openingDriveDirection < 0 ? '-' : '=' });
        }

        // Delta
        const totalVol = this.totalBuyVol + this.totalSellVol;
        if (totalVol > 0) {
            const buyPct = Math.round((this.totalBuyVol / totalVol) * 100);
            factors.push({ name: 'Session Delta', value: `Buy ${buyPct}% / Sell ${100 - buyPct}%`, score: buyPct > 55 ? '+' : buyPct < 45 ? '-' : '=' });
        }

        // Clusters
        factors.push({ name: 'Cluster Balance', value: `${this.bullClustersBelow} bull / ${this.bearClustersAbove} bear`, score: this.bullClustersBelow > this.bearClustersAbove ? '+' : this.bullClustersBelow < this.bearClustersAbove ? '-' : '=' });

        // Prints
        factors.push({ name: 'Print Balance', value: `${this.printsAbove} above / ${this.printsBelow} below`, score: this.printsBelow > this.printsAbove ? '+' : this.printsBelow < this.printsAbove ? '-' : '=' });

        // Prior day
        if (this.priorDayClose && this.priorDayVAH) {
            const pos = this.priorDayClose > this.priorDayVAH ? 'Above VAH' : this.priorDayClose < this.priorDayVAL ? 'Below VAL' : 'Inside VA';
            factors.push({ name: 'Prior Close', value: pos, score: this.priorDayClose > this.priorDayVAH ? '+' : this.priorDayClose < this.priorDayVAL ? '-' : '=' });
        }

        // SMT
        if (this.smtBullSignals + this.smtBearSignals > 0) {
            factors.push({ name: 'SMT Signals', value: `${this.smtBullSignals} bull / ${this.smtBearSignals} bear`, score: this.smtBullSignals > this.smtBearSignals ? '+' : '-' });
        }

        return factors;
    }
}

module.exports = BiasEngine;
