import { TradeDecision, MarketSnapshot, PortfolioState, RiskProfile } from './types.js';

/**
 * RuleEngine is a fallback decision engine that uses simple rules
 * instead of an LLM. Used when no API key is configured.
 */
export class RuleEngine {
    private priceHistory: Map<string, number[]> = new Map();
    private readonly historyLength = 10;

    /**
     * Make a trade decision based on simple moving average crossover
     * and momentum rules.
     */
    analyzeAndDecide(
        agentId: string,
        agentName: string,
        marketData: MarketSnapshot,
        portfolio: PortfolioState,
        riskProfile: RiskProfile
    ): TradeDecision {
        // Track price history
        for (const [token, price] of Object.entries(marketData.prices)) {
            if (!this.priceHistory.has(token)) {
                this.priceHistory.set(token, []);
            }
            const history = this.priceHistory.get(token)!;
            history.push(price);
            if (history.length > this.historyLength) {
                history.shift();
            }
        }

        // Analyze SOL specifically
        const solHistory = this.priceHistory.get('SOL') || [];
        const solChange = marketData.changes24h['SOL'] || 0;

        // Need enough history to decide
        if (solHistory.length < 3) {
            return {
                action: 'HOLD',
                inputToken: 'SOL',
                outputToken: 'USDC',
                amountSOL: 0,
                confidence: 0.3,
                reasoning: `Gathering market data (${solHistory.length}/${this.historyLength} data points). Waiting for more history.`,
            };
        }

        // Calculate short and long moving averages
        const shortMA = this.average(solHistory.slice(-3));
        const longMA = this.average(solHistory);
        const currentPrice = solHistory[solHistory.length - 1];
        const momentum = (shortMA - longMA) / longMA;

        // Decision logic based on risk profile
        const minBalance = 0.5; // Keep for fees

        if (portfolio.balanceSOL <= minBalance) {
            return {
                action: 'HOLD',
                inputToken: 'SOL',
                outputToken: 'USDC',
                amountSOL: 0,
                confidence: 0.9,
                reasoning: `Balance too low (${portfolio.balanceSOL.toFixed(4)} SOL). Need at least ${minBalance} SOL for fees.`,
            };
        }

        // Bullish signal: short MA above long MA + positive momentum
        if (momentum > 0.02 && marketData.trend === 'bullish') {
            const tradeSize = Math.min(
                riskProfile.maxTradeSizeSOL,
                (portfolio.balanceSOL - minBalance) * 0.3 // Use 30% of available balance
            );

            if (tradeSize > 0.01) {
                return {
                    action: 'BUY',
                    inputToken: 'SOL',
                    outputToken: 'USDC',
                    amountSOL: parseFloat(tradeSize.toFixed(4)),
                    confidence: Math.min(0.8, 0.5 + momentum * 5),
                    reasoning: `Bullish signal: Short MA ($${shortMA.toFixed(2)}) > Long MA ($${longMA.toFixed(2)}), momentum: ${(momentum * 100).toFixed(2)}%. Market trend: ${marketData.trend}. Trading ${tradeSize.toFixed(4)} SOL.`,
                };
            }
        }

        // Bearish signal: short MA below long MA + negative momentum
        if (momentum < -0.02 && marketData.trend === 'bearish') {
            const tradeSize = Math.min(
                riskProfile.maxTradeSizeSOL,
                (portfolio.balanceSOL - minBalance) * 0.2 // Use 20% of available for sells
            );

            if (tradeSize > 0.01) {
                return {
                    action: 'SELL',
                    inputToken: 'SOL',
                    outputToken: 'USDC',
                    amountSOL: parseFloat(tradeSize.toFixed(4)),
                    confidence: Math.min(0.7, 0.4 + Math.abs(momentum) * 5),
                    reasoning: `Bearish signal: Short MA ($${shortMA.toFixed(2)}) < Long MA ($${longMA.toFixed(2)}), momentum: ${(momentum * 100).toFixed(2)}%. Market trend: ${marketData.trend}. Selling ${tradeSize.toFixed(4)} SOL to preserve value.`,
                };
            }
        }

        // Default: HOLD
        return {
            action: 'HOLD',
            inputToken: 'SOL',
            outputToken: 'USDC',
            amountSOL: 0,
            confidence: 0.6,
            reasoning: `No strong signal. Short MA: $${shortMA.toFixed(2)}, Long MA: $${longMA.toFixed(2)}, Momentum: ${(momentum * 100).toFixed(2)}%. Trend: ${marketData.trend}. Holding position.`,
        };
    }

    private average(values: number[]): number {
        if (values.length === 0) return 0;
        return values.reduce((sum, v) => sum + v, 0) / values.length;
    }
}
