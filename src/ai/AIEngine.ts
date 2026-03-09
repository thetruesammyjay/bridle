import { GoogleGenerativeAI } from '@google/generative-ai';
import { config, isGeminiConfigured } from '../config.js';
import { TradeDecision, MarketSnapshot, PortfolioState, RiskProfile } from './types.js';

/**
 * AIEngine uses Google Gemini to make autonomous trade decisions
 * based on market data, portfolio state, and risk profile.
 *
 * Includes retry logic with exponential backoff and automatic
 * rate-limit detection so the system can fall back to RuleEngine.
 */
export class AIEngine {
    private genAI: GoogleGenerativeAI | null = null;
    private modelName: string;
    private rateLimitedUntil: number = 0;
    private readonly MAX_RETRIES = 2;
    private consecutiveFailures: number = 0;

    constructor() {
        this.modelName = config.gemini.model;
        if (isGeminiConfigured()) {
            this.genAI = new GoogleGenerativeAI(config.gemini.apiKey);
        }
    }

    isAvailable(): boolean {
        return this.genAI !== null;
    }

    /**
     * Check if the API is currently rate-limited.
     * When true, the Agent should use the RuleEngine instead.
     */
    isRateLimited(): boolean {
        if (Date.now() < this.rateLimitedUntil) {
            return true;
        }
        // Cooldown expired, allow retry
        if (this.rateLimitedUntil > 0) {
            this.rateLimitedUntil = 0;
            this.consecutiveFailures = 0;
            console.log('[AIEngine] Rate limit cooldown expired, will retry Gemini on next cycle.');
        }
        return false;
    }

    /**
     * Analyze market data and portfolio to make a trade decision.
     * Retries with exponential backoff on transient errors.
     */
    async analyzeAndDecide(
        agentId: string,
        agentName: string,
        marketData: MarketSnapshot,
        portfolio: PortfolioState,
        riskProfile: RiskProfile
    ): Promise<TradeDecision> {
        if (!this.genAI) {
            throw new Error('Gemini API not configured');
        }

        const model = this.genAI.getGenerativeModel({ model: this.modelName });
        const prompt = this.buildPrompt(agentName, marketData, portfolio, riskProfile);

        let lastError: unknown;

        for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
            try {
                if (attempt > 0) {
                    const delayMs = Math.min(1000 * Math.pow(2, attempt), 10000);
                    console.log(`[AIEngine] Retry ${attempt}/${this.MAX_RETRIES} for agent ${agentId} after ${delayMs}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }

                const result = await model.generateContent(prompt);
                const response = result.response.text();

                // Success — reset failure counter
                this.consecutiveFailures = 0;
                return this.parseResponse(response);
            } catch (error) {
                lastError = error;
                const errorStr = String(error);

                // Detect rate limiting (429) — don't retry, back off longer
                if (errorStr.includes('429') || errorStr.includes('quota') || errorStr.includes('Too Many Requests')) {
                    this.consecutiveFailures++;

                    // Extract retry delay from error if available, otherwise use escalating backoff
                    const retryMatch = errorStr.match(/retry in (\d+)/i);
                    const backoffSeconds = retryMatch
                        ? parseInt(retryMatch[1]) + 5
                        : Math.min(60 * Math.pow(2, this.consecutiveFailures - 1), 300); // 60s, 120s, 240s, max 300s

                    this.rateLimitedUntil = Date.now() + backoffSeconds * 1000;
                    console.warn(`[AIEngine] Rate limited. Falling back to RuleEngine for ${backoffSeconds}s.`);

                    // Throw a specific error so Agent.ts knows to use RuleEngine
                    throw new Error('RATE_LIMITED');
                }

                console.error(`[AIEngine] Attempt ${attempt + 1} failed for agent ${agentId}:`, error);
            }
        }

        // All retries exhausted
        console.error(`[AIEngine] All retries exhausted for agent ${agentId}`);
        throw new Error('GEMINI_UNAVAILABLE');
    }

    private buildPrompt(
        agentName: string,
        market: MarketSnapshot,
        portfolio: PortfolioState,
        risk: RiskProfile
    ): string {
        return `You are an autonomous AI trading agent named "${agentName}" operating on Solana devnet.
Your job is to analyze market conditions and decide whether to BUY, SELL, or HOLD.

## Current Market Data
- Market Trend: ${market.trend}
- Prices: ${JSON.stringify(market.prices, null, 2)}
- 24h Changes: ${JSON.stringify(market.changes24h, null, 2)}
- Volumes: ${JSON.stringify(market.volumes, null, 2)}
- Timestamp: ${market.timestamp}

## Your Portfolio
- SOL Balance: ${portfolio.balanceSOL} SOL
- Total Value (USD): ~$${portfolio.totalValueUSD.toFixed(2)}

## Your Risk Profile
- Level: ${risk.level}
- Max Trade Size: ${risk.maxTradeSizeSOL} SOL
- Daily Limit: ${risk.dailyLimitSOL} SOL
- Stop Loss: ${risk.stopLossPercent}%
- Take Profit: ${risk.takeProfitPercent}%
- Preferred Tokens: ${risk.preferredTokens.join(', ')}

## Instructions
Analyze the market data and your portfolio. Decide one of:
- BUY: Convert some SOL to another token (specify which)
- SELL: Convert a token back to SOL
- HOLD: Do nothing this cycle

Consider your risk profile. You are encouraged to actively test strategies! If you see any slight positive trend or dip worth buying, execute a trade.
Keep at least 0.05 SOL for transaction fees (do not spend your entire balance).

Respond ONLY with valid JSON in this exact format, no other text:
{
  "action": "BUY" | "SELL" | "HOLD",
  "inputToken": "SOL",
  "outputToken": "USDC",
  "amountSOL": 0.1,
  "confidence": 0.75,
  "reasoning": "Brief explanation of your decision"
}`;
    }

    private parseResponse(response: string): TradeDecision {
        try {
            // Extract JSON from response (handle markdown code blocks)
            let jsonStr = response.trim();
            const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                jsonStr = jsonMatch[1].trim();
            }

            // Try to find JSON object in response
            const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
            if (objectMatch) {
                jsonStr = objectMatch[0];
            }

            const parsed = JSON.parse(jsonStr);

            return {
                action: parsed.action || 'HOLD',
                inputToken: parsed.inputToken || 'SOL',
                outputToken: parsed.outputToken || 'USDC',
                amountSOL: typeof parsed.amountSOL === 'number' ? parsed.amountSOL : 0,
                confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
                reasoning: parsed.reasoning || 'No reasoning provided',
            };
        } catch {
            return {
                action: 'HOLD',
                inputToken: 'SOL',
                outputToken: 'USDC',
                amountSOL: 0,
                confidence: 0,
                reasoning: `Failed to parse AI response: ${response.substring(0, 200)}`,
            };
        }
    }
}
