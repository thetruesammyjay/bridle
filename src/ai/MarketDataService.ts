import { MarketSnapshot } from './types.js';

/**
 * Token mint addresses on Solana for Jupiter Price API lookups.
 */
const TOKEN_MINTS: Record<string, string> = {
    SOL: 'So11111111111111111111111111111111111111112',
    USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    RAY: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
};

/**
 * MarketDataService fetches live price data from the Jupiter Price API (free, no key needed).
 * Falls back to simulated data if the API is unreachable.
 */
export class MarketDataService {
    private readonly JUPITER_PRICE_URL = 'https://api.jup.ag/price/v2';

    // Simulation fallback state
    private basePrices: Record<string, number> = {
        SOL: 150,
        USDC: 1,
        BONK: 0.000025,
        RAY: 2.5,
    };
    private simulatedPrices: Record<string, number>;
    private previousPrices: Record<string, number>;
    private trend: 'bullish' | 'bearish' | 'sideways' = 'sideways';
    private trendDuration: number = 0;

    // Live data cache
    private lastLivePrices: Record<string, number> | null = null;
    private lastLiveFetchTime: number = 0;
    private readonly CACHE_TTL_MS = 15_000; // Cache for 15s to avoid hammering API
    private usingLiveData: boolean = false;

    constructor() {
        this.simulatedPrices = { ...this.basePrices };
        this.previousPrices = { ...this.basePrices };
    }

    /**
     * Get a market snapshot — first tries live Jupiter data, falls back to simulation.
     */
    async getMarketSnapshotAsync(): Promise<MarketSnapshot> {
        const liveData = await this.fetchLivePrices();

        if (liveData) {
            return this.buildLiveSnapshot(liveData);
        }

        // Fallback to simulated data
        return this.getMarketSnapshot();
    }

    /**
     * Synchronous simulated market snapshot (used when async isn't available).
     */
    getMarketSnapshot(): MarketSnapshot {
        // If we have cached live data, use it
        if (this.lastLivePrices && Date.now() - this.lastLiveFetchTime < this.CACHE_TTL_MS) {
            return this.buildLiveSnapshot(this.lastLivePrices);
        }

        // Otherwise fall back to simulation
        this.updateSimulatedPrices();

        const changes24h: Record<string, number> = {};
        const volumes: Record<string, number> = {};

        for (const [token, price] of Object.entries(this.simulatedPrices)) {
            const prevPrice = this.previousPrices[token] || price;
            changes24h[token] = ((price - prevPrice) / prevPrice) * 100;
            volumes[token] = this.generateVolume(token);
        }

        return {
            timestamp: new Date().toISOString(),
            prices: { ...this.simulatedPrices },
            changes24h,
            volumes,
            trend: this.trend,
        };
    }

    /**
     * Whether the service is currently using live data.
     */
    isLive(): boolean {
        return this.usingLiveData;
    }

    // ─── Live Data ───

    private async fetchLivePrices(): Promise<Record<string, number> | null> {
        // Don't fetch if cache is fresh
        if (this.lastLivePrices && Date.now() - this.lastLiveFetchTime < this.CACHE_TTL_MS) {
            return this.lastLivePrices;
        }

        try {
            const mintIds = Object.values(TOKEN_MINTS).join(',');
            const url = `${this.JUPITER_PRICE_URL}?ids=${mintIds}`;

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeout);

            if (!response.ok) {
                throw new Error(`Jupiter API returned ${response.status}`);
            }

            const json = await response.json() as {
                data: Record<string, { id: string; price: string }>;
            };

            const prices: Record<string, number> = {};

            for (const [symbol, mint] of Object.entries(TOKEN_MINTS)) {
                const priceData = json.data[mint];
                if (priceData && priceData.price) {
                    prices[symbol] = parseFloat(priceData.price);
                }
            }

            // Only accept if we got at least SOL
            if (prices['SOL'] && prices['SOL'] > 0) {
                // Ensure USDC is always 1
                prices['USDC'] = 1;

                this.previousPrices = this.lastLivePrices || { ...prices };
                this.lastLivePrices = prices;
                this.lastLiveFetchTime = Date.now();
                this.usingLiveData = true;

                if (!this.previousPrices['SOL']) {
                    this.previousPrices = { ...prices };
                }

                return prices;
            }

            return null;
        } catch (error) {
            // Silently fall back to simulation
            if (this.usingLiveData) {
                console.warn(`[MarketData] Jupiter API unavailable, falling back to simulation: ${error}`);
                this.usingLiveData = false;
            }
            return null;
        }
    }

    private buildLiveSnapshot(prices: Record<string, number>): MarketSnapshot {
        const changes24h: Record<string, number> = {};
        const volumes: Record<string, number> = {};

        for (const [token, price] of Object.entries(prices)) {
            const prevPrice = this.previousPrices[token] || price;
            changes24h[token] = ((price - prevPrice) / prevPrice) * 100;
            volumes[token] = this.generateVolume(token);
        }

        // Determine trend from SOL price movement
        const solChange = changes24h['SOL'] || 0;
        let trend: 'bullish' | 'bearish' | 'sideways';
        if (solChange > 0.5) trend = 'bullish';
        else if (solChange < -0.5) trend = 'bearish';
        else trend = 'sideways';

        return {
            timestamp: new Date().toISOString(),
            prices: { ...prices },
            changes24h,
            volumes,
            trend,
        };
    }

    // ─── Simulation Fallback ───

    private updateSimulatedPrices(): void {
        this.previousPrices = { ...this.simulatedPrices };

        this.trendDuration++;
        if (this.trendDuration > 5 + Math.random() * 10) {
            this.trendDuration = 0;
            const r = Math.random();
            if (r < 0.35) this.trend = 'bullish';
            else if (r < 0.7) this.trend = 'bearish';
            else this.trend = 'sideways';
        }

        for (const token of Object.keys(this.simulatedPrices)) {
            if (token === 'USDC') continue;

            let trendBias = 0;
            if (this.trend === 'bullish') trendBias = 0.01;
            else if (this.trend === 'bearish') trendBias = -0.01;

            const volatility = this.getVolatility(token);
            const change = (Math.random() - 0.5) * 2 * volatility + trendBias;
            this.simulatedPrices[token] = Math.max(
                this.basePrices[token] * 0.5,
                this.simulatedPrices[token] * (1 + change)
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
