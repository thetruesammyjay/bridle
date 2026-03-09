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
        const minBalance = 0.05; // Keep for fees (reduced from 0.5 to encourage devnet testing)

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

        // Adjust momentum thresholds based on risk profile
        let momentumThreshold = 0.02; // Moderate default
        let balanceUsageBuy = 0.3;    // Moderate default (30%)
        let balanceUsageSell = 0.2;   // Moderate default (20%)

        if (riskProfile.level === 'aggressive') {
            momentumThreshold = 0.01; // Trigger trades easier
            balanceUsageBuy = 0.6;    // Use more balance
            balanceUsageSell = 0.5;
        } else if (riskProfile.level === 'conservative') {
            momentumThreshold = 0.03; // Require stronger signals
            balanceUsageBuy = 0.15;   // Use less balance
            balanceUsageSell = 0.1;
        }

        // Bullish signal: short MA above long MA + positive momentum
        if (momentum > momentumThreshold && marketData.trend === 'bullish') {
            const tradeSize = Math.min(
                riskProfile.maxTradeSizeSOL,
                (portfolio.balanceSOL - minBalance) * balanceUsageBuy
            );

            if (tradeSize > 0.01) {
                return {
                    action: 'BUY',
                    inputToken: 'SOL',
                    outputToken: 'USDC',
                    amountSOL: parseFloat(tradeSize.toFixed(4)),
                    confidence: Math.min(0.8, 0.5 + momentum * 5),
                    reasoning: `[${riskProfile.level.toUpperCase()}] Bullish signal: ShortMA>$${shortMA.toFixed(2)}, LongMA>$${longMA.toFixed(2)}. Momentum: ${(momentum * 100).toFixed(2)}%. Trading ${tradeSize.toFixed(4)} SOL.`,
                };
            }
        }

        // Bearish signal: short MA below long MA + negative momentum
        if (momentum < -momentumThreshold && marketData.trend === 'bearish') {
            const tradeSize = Math.min(
                riskProfile.maxTradeSizeSOL,
                (portfolio.balanceSOL - minBalance) * balanceUsageSell
            );

            if (tradeSize > 0.01) {
                return {
                    action: 'SELL',
                    inputToken: 'SOL',
                    outputToken: 'USDC',
                    amountSOL: parseFloat(tradeSize.toFixed(4)),
                    confidence: Math.min(0.7, 0.4 + Math.abs(momentum) * 5),
                    reasoning: `[${riskProfile.level.toUpperCase()}] Bearish signal: ShortMA<$${shortMA.toFixed(2)}, LongMA<$${longMA.toFixed(2)}. Momentum: ${(momentum * 100).toFixed(2)}%. Selling ${tradeSize.toFixed(4)} SOL.`,
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
            reasoning: `[${riskProfile.level.toUpperCase()}] No strong signal (Threshold: ${(momentumThreshold * 100).toFixed(1)}%). Momentum: ${(momentum * 100).toFixed(2)}%. Holding.`,
        };
    }

    private average(values: number[]): number {
        if (values.length === 0) return 0;
        return values.reduce((sum, v) => sum + v, 0) / values.length;
    }
}
