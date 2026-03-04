import { TradeAction } from '../ai/types.js';

// ── Trading Types ──

export interface SwapQuote {
    inputMint: string;
    outputMint: string;
    inAmount: number;
    outAmount: number;
    priceImpactPercent: number;
    route: string;
}

export interface TradeResult {
    signature: string;
    action: TradeAction;
    inputToken: string;
    outputToken: string;
    inputAmount: number;
    outputAmount: number;
    success: boolean;
    timestamp: string;
    error?: string;
}
