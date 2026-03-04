import { SwapQuote } from './types.js';

/**
 * JupiterClient wraps the Jupiter Aggregator API for token swap quotes.
 * On devnet, Jupiter may not be available, so this includes a simulation mode.
 */
export class JupiterClient {
    private readonly JUPITER_API = 'https://quote-api.jup.ag/v6';
    private simulationMode: boolean = false;

    // Well-known devnet token mints
    static readonly TOKEN_MINTS: Record<string, string> = {
        SOL: 'So11111111111111111111111111111111111111112',
        USDC: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // Devnet USDC
    };

    constructor(useSimulation: boolean = true) {
        // Default to simulation on devnet since Jupiter API is mainnet-focused
        this.simulationMode = useSimulation;
    }

    /**
     * Get a swap quote. Returns simulated quote on devnet.
     */
    async getQuote(
        inputMint: string,
        outputMint: string,
        amountLamports: number,
        slippageBps: number = 50
    ): Promise<SwapQuote> {
        if (this.simulationMode) {
            return this.simulateQuote(inputMint, outputMint, amountLamports, slippageBps);
        }

        try {
            const params = new URLSearchParams({
                inputMint,
                outputMint,
                amount: amountLamports.toString(),
                slippageBps: slippageBps.toString(),
            });

            const response = await fetch(`${this.JUPITER_API}/quote?${params}`);
            if (!response.ok) {
                throw new Error(`Jupiter API error: ${response.status}`);
            }

            const data: any = await response.json();

            return {
                inputMint,
                outputMint,
                inAmount: parseInt(data.inAmount),
                outAmount: parseInt(data.outAmount),
                priceImpactPercent: parseFloat(data.priceImpactPct),
                route: JSON.stringify(data.routePlan?.map((r: any) => r.swapInfo?.label) || ['direct']),
            };
        } catch (error) {
            console.warn(`[JupiterClient] API unavailable, falling back to simulation:`, error);
            this.simulationMode = true;
            return this.simulateQuote(inputMint, outputMint, amountLamports, slippageBps);
        }
    }

    /**
     * Simulate a swap quote with realistic pricing for devnet testing.
     */
    private simulateQuote(
        inputMint: string,
        outputMint: string,
        amountLamports: number,
        slippageBps: number
    ): SwapQuote {
        // Simulated exchange rates
        const rates: Record<string, number> = {
            [`${JupiterClient.TOKEN_MINTS.SOL}-${JupiterClient.TOKEN_MINTS.USDC}`]: 150,
            [`${JupiterClient.TOKEN_MINTS.USDC}-${JupiterClient.TOKEN_MINTS.SOL}`]: 1 / 150,
        };

        const key = `${inputMint}-${outputMint}`;
        const reverseKey = `${outputMint}-${inputMint}`;
        let rate = rates[key] || (rates[reverseKey] ? 1 / rates[reverseKey] : 1);

        // Add some slippage simulation
        const slippageFactor = 1 - (slippageBps / 10000) * Math.random();
        const outAmount = Math.floor(amountLamports * rate * slippageFactor);

        return {
            inputMint,
            outputMint,
            inAmount: amountLamports,
            outAmount,
            priceImpactPercent: Math.random() * 0.5,
            route: '["simulated-direct-swap"]',
        };
    }

    /**
     * Get the mint address for a token symbol.
     */
    static getMint(symbol: string): string {
        const mint = JupiterClient.TOKEN_MINTS[symbol.toUpperCase()];
        if (!mint) {
            throw new Error(`Unknown token symbol: ${symbol}`);
        }
        return mint;
    }

    isSimulating(): boolean {
        return this.simulationMode;
    }
}
