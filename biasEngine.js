/**
 * BiasEngine — Determines daily NQ bias using TPO + market structure factors
 * 
 * Scores from -1 (strong bearish) to +1 (strong bullish)
 * Updated in real-time as new data comes in
 * 
 * Factors:
 * 1. Overnight positioning (price vs overnight midpoint)
 * 2. Opening drive direction (first 15 min)
 * 3. Volume delta (buy vs sell aggression)
 * 4. TPO profile shape (b/p/D/B)
 * 5. TPO single print positioning (above/below price)
 * 6. Initial Balance extension
 * 7. Prior day close vs Value Area
 */
class BiasEngine {
    constructor(config) {
        this.config = config;
        this.weights = config.bias;

        // Reference to TPO engine (set externally)
        this.tpoEngine = null;

        // Daily tracking data
        this.reset();
    }

    /**
     * Set reference to TPO engine for real-time TPO bias data
     */
    setTPOEngine(tpoEngine) {
        this.tpoEngine = tpoEngine;
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

        // TPO-derived bias data (cached from tpoEngine)
        this.tpoShapeBias = 0;
        this.tpoPrintBias = 0;
        this.tpoIBBias = 0;
        this.tpoShape = null;
        this.tpoSinglePrintsAbove = 0;
        this.tpoSinglePrintsBelow = 0;
        this.ibPosition = 'forming';

        // Current price
        this.currentPrice = 0;

        // Timestamps
        this.sessionDate = new Date().toDateString();
    }

    /**
     * Reset only TPO-related cached data (on session reset)
     */
    resetTPOData() {
        this.tpoShapeBias = 0;
        this.tpoPrintBias = 0;
        this.tpoIBBias = 0;
        this.tpoShape = null;
        this.tpoSinglePrintsAbove = 0;
        this.tpoSinglePrintsBelow = 0;
        this.ibPosition = 'forming';
    }

    /**
     * Set prior day reference levels (from TradingView webhook)
     */
    setPriorDayLevels(data) {
        if (data.poc) this.priorDayPOC = parseFloat(data.poc);
        if (data.vah) this.priorDayVAH = parseFloat(data.vah);
        if (data.val) this.priorDayVAL = parseFloat(data.val);
        if (data.close) this.priorDayClose = parseFloat(data.close);
    }

    /**
     * Set overnight range
     */
    setOvernightRange(high, low) {
        this.overnightHigh = parseFloat(high);
        this.overnightLow = parseFloat(low);
        this.overnightMid = (this.overnightHigh + this.overnightLow) / 2;
    }

    /**
     * Called at RTH open
     */
    setRTHOpen(price) {
        this.rthOpenPrice = parseFloat(price);
    }

    /**
     * Update with opening drive data (first 15 min)
     */
    setOpeningDrive(high, low, closePrice) {
        this.first15minHigh = parseFloat(high);
        this.first15minLow = parseFloat(low);
        this.first15minClose = parseFloat(closePrice);
        this.openingDriveComplete = true;

        if (this.rthOpenPrice) {
            this.openingDriveDirection = this.first15minClose > this.rthOpenPrice ? 1 : this.first15minClose < this.rthOpenPrice ? -1 : 0;
        } else if (this.priorDayPOC) {
            this.openingDriveDirection = this.first15minClose > this.priorDayPOC ? 1 : this.first15minClose < this.priorDayPOC ? -1 : 0;
        }
    }

    /**
     * Update volume delta
     */
    updateDelta(buyVol, sellVol) {
        this.totalBuyVol += parseFloat(buyVol);
        this.totalSellVol += parseFloat(sellVol);
    }

    /**
     * Update current price and refresh TPO bias data
     */
    updatePrice(price) {
        this.currentPrice = parseFloat(price);
        this._updateTPOBias();
    }

    /**
     * Pull latest TPO bias data from the TPO engine
     */
    _updateTPOBias() {
        if (!this.tpoEngine || !this.currentPrice) return;

        try {
            const tpoBias = this.tpoEngine.getTPOBias(this.currentPrice);
            
            // Shape bias
            this.tpoShape = tpoBias.shape;
            this.tpoShapeBias = tpoBias.shape.bias || 0;

            // Single print positioning
            this.tpoPrintBias = tpoBias.printBias.bias || 0;
            this.tpoSinglePrintsAbove = tpoBias.printBias.above || 0;
            this.tpoSinglePrintsBelow = tpoBias.printBias.below || 0;

            // IB extension
            this.tpoIBBias = tpoBias.ibBias.bias || 0;
            this.ibPosition = tpoBias.ibBias.position || 'forming';
        } catch (err) {
            // TPO engine may not have enough data yet
        }
    }

    /**
     * Calculate overall bias score (-1 to +1)
     * 
     * Factors:
     * 1. Overnight positioning (20%)
     * 2. Opening drive (18%)
     * 3. Volume delta (15%)
     * 4. TPO Profile Shape (18%)
     * 5. TPO Single Print Positioning (14%)
     * 6. IB Extension (10%)
     * 7. Prior day close vs VA (5%)
     */
    calculateBias() {
        let score = 0;

        // 1. Overnight positioning
        if (this.overnightMid && this.currentPrice) {
            const overnightScore = this.currentPrice > this.overnightMid ? 1 : -1;
            score += overnightScore * (this.weights.overnightWeight || 0.20);
        }

        // 2. Opening drive
        if (this.openingDriveComplete) {
            score += this.openingDriveDirection * (this.weights.openingDriveWeight || 0.18);
        }

        // 3. Delta (buy vs sell aggression)
        const totalVol = this.totalBuyVol + this.totalSellVol;
        if (totalVol > 0) {
            const buyPct = this.totalBuyVol / totalVol;
            const deltaScore = (buyPct - 0.5) * 2; // Normalize to -1 to +1
            score += Math.max(-1, Math.min(1, deltaScore)) * (this.weights.deltaWeight || 0.15);
        }

        // 4. TPO Profile Shape (b-shape bullish, p-shape bearish)
        if (this.tpoShapeBias !== 0) {
            score += this.tpoShapeBias * (this.weights.tpoShapeWeight || 0.18);
        }

        // 5. TPO Single Print Positioning
        if (this.tpoPrintBias !== 0) {
            score += this.tpoPrintBias * (this.weights.tpoSinglePrintWeight || 0.14);
        }

        // 6. IB Extension
        if (this.tpoIBBias !== 0) {
            score += this.tpoIBBias * (this.weights.tpoIBWeight || 0.10);
        }

        // 7. Prior day close relative to VA
        if (this.priorDayClose && this.priorDayVAH && this.priorDayVAL) {
            let priorScore = 0;
            if (this.priorDayClose > this.priorDayVAH) priorScore = 1;
            else if (this.priorDayClose < this.priorDayVAL) priorScore = -1;
            score += priorScore * (this.weights.priorDayWeight || 0.05);
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

        // TPO Profile Shape
        if (this.tpoShape && this.tpoShape.shape !== 'none' && this.tpoShape.shape !== 'forming') {
            const shapeScore = this.tpoShapeBias > 0.1 ? '+' : this.tpoShapeBias < -0.1 ? '-' : '=';
            factors.push({ name: 'TPO Shape', value: this.tpoShape.description || this.tpoShape.shape, score: shapeScore });
        }

        // TPO Single Prints
        if (this.tpoSinglePrintsAbove + this.tpoSinglePrintsBelow > 0) {
            const spScore = this.tpoPrintBias > 0.1 ? '+' : this.tpoPrintBias < -0.1 ? '-' : '=';
            factors.push({ name: 'Single Prints', value: `${this.tpoSinglePrintsAbove} above / ${this.tpoSinglePrintsBelow} below`, score: spScore });
        }

        // IB Extension
        if (this.ibPosition !== 'forming') {
            const ibScore = this.tpoIBBias > 0.1 ? '+' : this.tpoIBBias < -0.1 ? '-' : '=';
            factors.push({ name: 'IB Extension', value: this.ibPosition, score: ibScore });
        }

        // Prior day
        if (this.priorDayClose && this.priorDayVAH) {
            const pos = this.priorDayClose > this.priorDayVAH ? 'Above VAH' : this.priorDayClose < this.priorDayVAL ? 'Below VAL' : 'Inside VA';
            factors.push({ name: 'Prior Close', value: pos, score: this.priorDayClose > this.priorDayVAH ? '+' : this.priorDayClose < this.priorDayVAL ? '-' : '=' });
        }

        return factors;
    }
}

module.exports = BiasEngine;
