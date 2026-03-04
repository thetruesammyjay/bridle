// ── AI Decision Types ──

export type TradeAction = 'BUY' | 'SELL' | 'HOLD';

export type RiskProfileLevel = 'conservative' | 'moderate' | 'aggressive';

export interface TradeDecision {
    action: TradeAction;
    inputToken: string;   // token symbol e.g. 'SOL'
    outputToken: string;  // token symbol e.g. 'USDC'
    amountSOL: number;    // amount in SOL terms
    confidence: number;   // 0-1
    reasoning: string;    // LLM explanation
}

export interface MarketSnapshot {
    timestamp: string;
    prices: Record<string, number>;    // token symbol → price in USD
    changes24h: Record<string, number>; // token symbol → 24h % change
    volumes: Record<string, number>;    // token symbol → 24h volume
    trend: 'bullish' | 'bearish' | 'sideways';
}

export interface RiskProfile {
    level: RiskProfileLevel;
    maxTradeSizeSOL: number;
    dailyLimitSOL: number;
    preferredTokens: string[];
    stopLossPercent: number;
    takeProfitPercent: number;
}

export interface PortfolioState {
    balanceSOL: number;
    tokens: Record<string, number>; // mint → balance
    totalValueUSD: number;
}

export const DEFAULT_RISK_PROFILES: Record<RiskProfileLevel, RiskProfile> = {
    conservative: {
        level: 'conservative',
        maxTradeSizeSOL: 0.1,
        dailyLimitSOL: 0.5,
        preferredTokens: ['SOL', 'USDC'],
        stopLossPercent: 5,
        takeProfitPercent: 10,
    },
    moderate: {
        level: 'moderate',
        maxTradeSizeSOL: 0.5,
        dailyLimitSOL: 2,
        preferredTokens: ['SOL', 'USDC', 'BONK'],
        stopLossPercent: 10,
        takeProfitPercent: 20,
    },
    aggressive: {
        level: 'aggressive',
        maxTradeSizeSOL: 1,
        dailyLimitSOL: 5,
        preferredTokens: ['SOL', 'USDC', 'BONK', 'RAY'],
        stopLossPercent: 20,
        takeProfitPercent: 50,
    },
};
