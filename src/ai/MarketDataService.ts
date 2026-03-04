import { MarketSnapshot } from './types.js';

/**
 * MarketDataService generates simulated market data for devnet testing.
 * Produces realistic price movements with trends, volatility, and noise.
 */
export class MarketDataService {
    private basePrices: Record<string, number> = {
        SOL: 150,
        USDC: 1,
        BONK: 0.000025,
        RAY: 2.5,
    };

    private currentPrices: Record<string, number>;
    private previousPrices: Record<string, number>;
    private trend: 'bullish' | 'bearish' | 'sideways' = 'sideways';
    private trendDuration: number = 0;

    constructor() {
        this.currentPrices = { ...this.basePrices };
        this.previousPrices = { ...this.basePrices };
    }

    /**
     * Get a market snapshot with simulated price data.
     */
    getMarketSnapshot(): MarketSnapshot {
        this.updatePrices();

        const changes24h: Record<string, number> = {};
        const volumes: Record<string, number> = {};

        for (const [token, price] of Object.entries(this.currentPrices)) {
            const prevPrice = this.previousPrices[token] || price;
            changes24h[token] = ((price - prevPrice) / prevPrice) * 100;
            volumes[token] = this.generateVolume(token);
        }

        return {
            timestamp: new Date().toISOString(),
            prices: { ...this.currentPrices },
            changes24h,
            volumes,
            trend: this.trend,
        };
    }

    private updatePrices(): void {
        this.previousPrices = { ...this.currentPrices };

        // Update trend periodically
        this.trendDuration++;
        if (this.trendDuration > 5 + Math.random() * 10) {
            this.trendDuration = 0;
            const r = Math.random();
            if (r < 0.35) this.trend = 'bullish';
            else if (r < 0.7) this.trend = 'bearish';
            else this.trend = 'sideways';
        }

        // Apply price movements
        for (const token of Object.keys(this.currentPrices)) {
            if (token === 'USDC') continue; // Stablecoin stays at $1

            let trendBias = 0;
            if (this.trend === 'bullish') trendBias = 0.01;
            else if (this.trend === 'bearish') trendBias = -0.01;

            // Random walk with trend bias
            const volatility = this.getVolatility(token);
            const change = (Math.random() - 0.5) * 2 * volatility + trendBias;
            this.currentPrices[token] = Math.max(
                this.basePrices[token] * 0.5, // Floor at 50% of base
                this.currentPrices[token] * (1 + change)
            );
        }
    }

    private getVolatility(token: string): number {
        const volatilities: Record<string, number> = {
            SOL: 0.03,
            BONK: 0.08,
            RAY: 0.05,
        };
        return volatilities[token] || 0.04;
    }

    private generateVolume(token: string): number {
        const baseVolumes: Record<string, number> = {
            SOL: 500_000_000,
            USDC: 1_000_000_000,
            BONK: 50_000_000,
            RAY: 20_000_000,
        };
        const base = baseVolumes[token] || 10_000_000;
        return base * (0.7 + Math.random() * 0.6);
    }
}
