/**
 * TPOEngine — Builds Time Price Opportunity profiles and detects single prints
 * 
 * Each 30-minute period gets a letter (A, B, C, ...).
 * A "single print" is a price level where only ONE letter printed,
 * meaning price moved through quickly — these are key S/R levels.
 * 
 * TPO profile shape analysis:
 * - b-shape: fat bottom, thin top → buying (bullish)
 * - p-shape: thin bottom, fat top → selling (bearish)
 * - D-shape: fat middle → balanced/neutral
 * - B-shape: double distribution → transitional
 */
class TPOEngine {
    constructor(config) {
        this.config = config;
        this.tickSize = config.tpo?.tickSize || 0.25;
        this.periodMinutes = config.tpo?.periodMinutes || 30;

        // Current session TPO data
        this.reset();
    }

    reset() {
        // Map of price level → array of letters that printed there
        // e.g. { 21500.00: ['A', 'B', 'C'], 21500.25: ['A'], ... }
        this.profile = new Map();

        // Track each period's range
        // e.g. [{ letter: 'A', high: 21550, low: 21480, open: 21500, close: 21520 }, ...]
        this.periods = [];

        // Current period being built
        this.currentPeriod = null;
        this.currentLetter = 'A';

        // Session boundaries
        this.sessionHigh = null;
        this.sessionLow = null;
        this.sessionOpen = null;

        // Single prints detected this session
        this.singlePrints = [];

        // Value area
        this.poc = null;        // Point of Control (price with most TPOs)
        this.vah = null;        // Value Area High
        this.val = null;        // Value Area Low

        // Session date
        this.sessionDate = new Date().toDateString();

        // IB (Initial Balance) - first 2 periods (A + B)
        this.ibHigh = null;
        this.ibLow = null;
        this.ibComplete = false;
    }

    /**
     * Get the next letter in sequence
     */
    getNextLetter() {
        const code = this.currentLetter.charCodeAt(0);
        if (code >= 90) return 'a'; // After Z, go to lowercase
        if (code >= 122) return 'A'; // Wrap around (shouldn't happen in one session)
        return String.fromCharCode(code + 1);
    }

    /**
     * Start a new TPO period (called every 30 minutes or when new period data arrives)
     */
    startNewPeriod(data = {}) {
        // Finalize current period
        if (this.currentPeriod) {
            this.periods.push({ ...this.currentPeriod });
        }

        // Advance letter
        if (this.periods.length > 0) {
            this.currentLetter = this.getNextLetter();
        }

        this.currentPeriod = {
            letter: this.currentLetter,
            high: data.high || null,
            low: data.low || null,
            open: data.open || null,
            close: data.close || null,
            startTime: data.timestamp || new Date(),
        };

        return this.currentLetter;
    }

    /**
     * Add a completed 30-min bar to the TPO profile
     * This is the main method called when TradingView sends a completed period
     */
    addPeriodBar(data) {
        const { high, low, open, close } = data;

        if (!high || !low) return;

        // Start new period
        this.startNewPeriod(data);
        const letter = this.currentPeriod.letter;

        // Update current period
        this.currentPeriod.high = parseFloat(high);
        this.currentPeriod.low = parseFloat(low);
        this.currentPeriod.open = parseFloat(open);
        this.currentPeriod.close = parseFloat(close);

        // Fill TPO letters at each price level within this bar's range
        const barHigh = parseFloat(high);
        const barLow = parseFloat(low);

        this._fillTPORange(letter, barHigh, barLow);

        // Update session extremes
        if (this.sessionOpen === null) this.sessionOpen = parseFloat(open);
        if (this.sessionHigh === null || barHigh > this.sessionHigh) this.sessionHigh = barHigh;
        if (this.sessionLow === null || barLow < this.sessionLow) this.sessionLow = barLow;

        // Update Initial Balance (first 2 periods: A + B)
        if (this.periods.length <= 2) {
            if (this.ibHigh === null || barHigh > this.ibHigh) this.ibHigh = barHigh;
            if (this.ibLow === null || barLow < this.ibLow) this.ibLow = barLow;
            if (this.periods.length === 2) this.ibComplete = true;
        }

        // Recalculate value area and detect single prints
        this._calculateValueArea();
        this._detectSinglePrints();

        // Finalize the period into the periods array
        this.periods.push({ ...this.currentPeriod });
        this.currentPeriod = null;

        return {
            letter,
            singlePrints: this.singlePrints,
            poc: this.poc,
            vah: this.vah,
            val: this.val,
        };
    }

    /**
     * Update with live price tick (updates current period in real-time)
     */
    updatePrice(price) {
        price = parseFloat(price);

        if (this.currentPeriod) {
            if (this.currentPeriod.high === null || price > this.currentPeriod.high) {
                this.currentPeriod.high = price;
            }
            if (this.currentPeriod.low === null || price < this.currentPeriod.low) {
                this.currentPeriod.low = price;
            }
            this.currentPeriod.close = price;

            // Fill new ticks
            this._fillTPORange(this.currentPeriod.letter, this.currentPeriod.high, this.currentPeriod.low);
        }

        // Update session extremes
        if (this.sessionHigh === null || price > this.sessionHigh) this.sessionHigh = price;
        if (this.sessionLow === null || price < this.sessionLow) this.sessionLow = price;
    }

    /**
     * Fill TPO letters at each tick within a range
     */
    _fillTPORange(letter, high, low) {
        const roundedHigh = this._roundToTick(high);
        const roundedLow = this._roundToTick(low);

        for (let price = roundedLow; price <= roundedHigh; price = this._roundToTick(price + this.tickSize)) {
            const key = price.toFixed(2);
            if (!this.profile.has(key)) {
                this.profile.set(key, new Set());
            }
            this.profile.get(key).add(letter);
        }
    }

    /**
     * Round price to nearest tick
     */
    _roundToTick(price) {
        return Math.round(price / this.tickSize) * this.tickSize;
    }

    /**
     * Calculate POC and Value Area (70% of TPOs)
     */
    _calculateValueArea() {
        if (this.profile.size === 0) return;

        // Find POC (price level with most TPO letters)
        let maxTPOs = 0;
        let pocPrice = null;

        const entries = [];
        for (const [priceStr, letters] of this.profile) {
            const price = parseFloat(priceStr);
            const count = letters.size;
            entries.push({ price, count });
            if (count > maxTPOs) {
                maxTPOs = count;
                pocPrice = price;
            }
        }

        this.poc = pocPrice;

        // Sort by price
        entries.sort((a, b) => a.price - b.price);

        // Calculate total TPOs
        const totalTPOs = entries.reduce((sum, e) => sum + e.count, 0);
        const targetTPOs = Math.ceil(totalTPOs * 0.70);

        // Find POC index
        const pocIndex = entries.findIndex(e => e.price === pocPrice);
        if (pocIndex === -1) return;

        // Expand from POC in both directions until 70% captured
        let captured = entries[pocIndex].count;
        let low = pocIndex;
        let high = pocIndex;

        while (captured < targetTPOs && (low > 0 || high < entries.length - 1)) {
            const lowCount = low > 0 ? entries[low - 1].count : 0;
            const highCount = high < entries.length - 1 ? entries[high + 1].count : 0;

            if (lowCount >= highCount && low > 0) {
                low--;
                captured += entries[low].count;
            } else if (high < entries.length - 1) {
                high++;
                captured += entries[high].count;
            } else if (low > 0) {
                low--;
                captured += entries[low].count;
            } else {
                break;
            }
        }

        this.val = entries[low].price;
        this.vah = entries[high].price;
    }

    /**
     * Detect single prints — price levels with only 1 TPO letter
     * These represent fast moves through price = potential S/R
     */
    _detectSinglePrints() {
        this.singlePrints = [];

        if (this.profile.size === 0) return;

        // Get all prices sorted
        const prices = Array.from(this.profile.keys())
            .map(p => parseFloat(p))
            .sort((a, b) => a - b);

        // Find sequences of single-TPO levels (need at least 2 consecutive for significance)
        let currentRun = [];

        for (const price of prices) {
            const key = price.toFixed(2);
            const letters = this.profile.get(key);

            if (letters && letters.size === 1) {
                currentRun.push({
                    price,
                    letter: Array.from(letters)[0],
                });
            } else {
                // End of run — if 2+ consecutive single prints, record them
                if (currentRun.length >= 2) {
                    this.singlePrints.push({
                        high: currentRun[currentRun.length - 1].price,
                        low: currentRun[0].price,
                        mid: (currentRun[0].price + currentRun[currentRun.length - 1].price) / 2,
                        tickCount: currentRun.length,
                        letter: currentRun[0].letter,
                        timestamp: new Date(),
                        filled: false,
                    });
                }
                currentRun = [];
            }
        }

        // Handle trailing run
        if (currentRun.length >= 2) {
            this.singlePrints.push({
                high: currentRun[currentRun.length - 1].price,
                low: currentRun[0].price,
                mid: (currentRun[0].price + currentRun[currentRun.length - 1].price) / 2,
                tickCount: currentRun.length,
                letter: currentRun[0].letter,
                timestamp: new Date(),
                filled: false,
            });
        }
    }

    /**
     * Check if price has filled any single prints
     */
    checkSinglePrintFills(price) {
        price = parseFloat(price);
        const filled = [];

        this.singlePrints = this.singlePrints.filter(sp => {
            if (!sp.filled && price >= sp.low && price <= sp.high) {
                sp.filled = true;
                filled.push(sp);
                return false;
            }
            return true;
        });

        return filled;
    }

    /**
     * Determine TPO profile shape for bias
     * - b-shape: fat bottom (accumulation = bullish)
     * - p-shape: fat top (distribution = bearish)
     * - D-shape: fat middle (balanced)
     * - B-shape: double distribution (transition)
     */
    getProfileShape() {
        if (this.profile.size === 0) return { shape: 'none', bias: 0 };

        const entries = [];
        for (const [priceStr, letters] of this.profile) {
            entries.push({ price: parseFloat(priceStr), count: letters.size });
        }
        entries.sort((a, b) => a.price - b.price);

        if (entries.length < 4) return { shape: 'forming', bias: 0 };

        // Divide profile into thirds
        const third = Math.floor(entries.length / 3);
        const lower = entries.slice(0, third);
        const middle = entries.slice(third, third * 2);
        const upper = entries.slice(third * 2);

        const lowerTPOs = lower.reduce((sum, e) => sum + e.count, 0);
        const middleTPOs = middle.reduce((sum, e) => sum + e.count, 0);
        const upperTPOs = upper.reduce((sum, e) => sum + e.count, 0);
        const totalTPOs = lowerTPOs + middleTPOs + upperTPOs;

        if (totalTPOs === 0) return { shape: 'forming', bias: 0 };

        const lowerPct = lowerTPOs / totalTPOs;
        const middlePct = middleTPOs / totalTPOs;
        const upperPct = upperTPOs / totalTPOs;

        // b-shape: fat bottom (lower > upper significantly)
        if (lowerPct > 0.42 && lowerPct > upperPct * 1.3) {
            return { shape: 'b', bias: 0.6, description: 'b-shape (buying/accumulation)' };
        }

        // p-shape: fat top (upper > lower significantly)
        if (upperPct > 0.42 && upperPct > lowerPct * 1.3) {
            return { shape: 'p', bias: -0.6, description: 'p-shape (selling/distribution)' };
        }

        // D-shape: fat middle
        if (middlePct > 0.40) {
            return { shape: 'D', bias: 0, description: 'D-shape (balanced/rotational)' };
        }

        // B-shape: double distribution (lower and upper both fat, middle thin)
        if (lowerPct > 0.35 && upperPct > 0.35 && middlePct < 0.30) {
            return { shape: 'B', bias: 0, description: 'B-shape (double distribution/transition)' };
        }

        // Default: roughly balanced
        return { shape: 'D', bias: 0, description: 'D-shape (balanced)' };
    }

    /**
     * Get single print bias contribution
     * More single prints below current price = bullish (support below)
     * More single prints above = bearish (resistance above / gap to fill above means price drawn up? 
     *   Actually: single prints above = price traveled fast upward = potential resistance if revisited)
     * 
     * Single prints below = areas price dropped fast through = will act as support on revisit
     * Single prints above = areas price rallied fast through = potential to pull back into
     */
    getSinglePrintBias(currentPrice) {
        if (this.singlePrints.length === 0) return { bias: 0, above: 0, below: 0 };

        const active = this.singlePrints.filter(sp => !sp.filled);
        const above = active.filter(sp => sp.mid > currentPrice);
        const below = active.filter(sp => sp.mid < currentPrice);

        // More prints below = support below = bullish
        // More prints above = unfilled gaps above = draws price up (slightly bullish actually)
        // But in Market Profile theory: single prints below = bullish support
        const total = above.length + below.length;
        if (total === 0) return { bias: 0, above: 0, below: 0 };

        // Weighted: prints below = support = bullish bias
        const bias = (below.length - above.length) / total;

        return {
            bias: Math.max(-1, Math.min(1, bias)),
            above: above.length,
            below: below.length,
            abovePrints: above,
            belowPrints: below,
        };
    }

    /**
     * Get IB (Initial Balance) extension bias
     * Price above IB = bullish trend day potential
     * Price below IB = bearish trend day potential
     * Inside IB = rotational
     */
    getIBBias(currentPrice) {
        if (!this.ibComplete || !this.ibHigh || !this.ibLow) {
            return { bias: 0, position: 'forming' };
        }

        if (currentPrice > this.ibHigh) {
            const extension = (currentPrice - this.ibHigh) / (this.ibHigh - this.ibLow);
            return { bias: Math.min(1, 0.5 + extension * 0.3), position: 'above IB' };
        }
        if (currentPrice < this.ibLow) {
            const extension = (this.ibLow - currentPrice) / (this.ibHigh - this.ibLow);
            return { bias: Math.max(-1, -0.5 - extension * 0.3), position: 'below IB' };
        }
        return { bias: 0, position: 'inside IB' };
    }

    /**
     * Combined TPO bias score
     */
    getTPOBias(currentPrice) {
        const shape = this.getProfileShape();
        const printBias = this.getSinglePrintBias(currentPrice);
        const ibBias = this.getIBBias(currentPrice);

        // Weighted combination
        const combined = (shape.bias * 0.4) + (printBias.bias * 0.35) + (ibBias.bias * 0.25);

        return {
            score: Math.max(-1, Math.min(1, combined)),
            shape,
            printBias,
            ibBias,
            poc: this.poc,
            vah: this.vah,
            val: this.val,
            ibHigh: this.ibHigh,
            ibLow: this.ibLow,
        };
    }

    /**
     * Get the visual TPO profile as text (for Discord embed)
     */
    getProfileDisplay(currentPrice, maxRows = 30) {
        if (this.profile.size === 0) return 'No TPO data yet.';

        const entries = [];
        for (const [priceStr, letters] of this.profile) {
            entries.push({
                price: parseFloat(priceStr),
                letters: Array.from(letters).sort().join(''),
            });
        }
        entries.sort((a, b) => b.price - a.price); // High to low

        // If too many levels, sample around current price
        if (entries.length > maxRows) {
            const priceIdx = entries.findIndex(e => e.price <= currentPrice);
            const startIdx = Math.max(0, priceIdx - Math.floor(maxRows / 2));
            const endIdx = Math.min(entries.length, startIdx + maxRows);
            entries.splice(0, startIdx);
            entries.splice(maxRows);
        }

        let display = '';
        for (const e of entries) {
            const priceLabel = e.price.toFixed(2).padStart(10);
            const isSingle = e.letters.length === 1;
            const isPOC = this.poc && Math.abs(e.price - this.poc) < this.tickSize;
            const isVAH = this.vah && Math.abs(e.price - this.vah) < this.tickSize;
            const isVAL = this.val && Math.abs(e.price - this.val) < this.tickSize;
            const isCurrent = currentPrice && Math.abs(e.price - currentPrice) < this.tickSize;

            let marker = ' ';
            if (isPOC) marker = '◄POC';
            else if (isVAH) marker = '◄VAH';
            else if (isVAL) marker = '◄VAL';
            else if (isSingle) marker = '◄SP';

            const highlight = isCurrent ? ' <<<' : '';
            display += `${priceLabel} | ${e.letters}${marker}${highlight}\n`;
        }

        return display;
    }

    /**
     * Get summary for quick display
     */
    getSummary(currentPrice) {
        const shape = this.getProfileShape();
        const spBias = this.getSinglePrintBias(currentPrice);
        const periodsCount = this.periods.length + (this.currentPeriod ? 1 : 0);

        return {
            periodsCompleted: periodsCount,
            currentLetter: this.currentPeriod?.letter || this.currentLetter,
            sessionHigh: this.sessionHigh,
            sessionLow: this.sessionLow,
            poc: this.poc,
            vah: this.vah,
            val: this.val,
            ibHigh: this.ibHigh,
            ibLow: this.ibLow,
            shape: shape,
            singlePrints: this.singlePrints.filter(sp => !sp.filled),
            singlePrintCount: this.singlePrints.filter(sp => !sp.filled).length,
            printsAbove: spBias.above,
            printsBelow: spBias.below,
        };
    }
}

module.exports = TPOEngine;
