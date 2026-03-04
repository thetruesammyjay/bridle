import { RiskProfileLevel, TradeDecision, MarketSnapshot } from '../ai/types.js';
import { TradeResult } from '../trading/types.js';
import { AgentPolicy } from '../policy/types.js';

// ── Agent Types ──

export type AgentStatus = 'idle' | 'running' | 'deciding' | 'trading' | 'stopped' | 'error';

export interface AgentConfig {
    name: string;
    riskProfile: RiskProfileLevel;
    policy: AgentPolicy;
    intervalMs: number;
}

export interface AgentState {
    id: string;
    name: string;
    status: AgentStatus;
    publicKey: string;
    balanceSOL: number;
    lastDecision: TradeDecision | null;
    lastMarketSnapshot: MarketSnapshot | null;
    tradeHistory: TradeResult[];
    createdAt: string;
    cycleCount: number;
    totalTradesExecuted: number;
    totalPnlSOL: number;
    // Analytics
    decisionDistribution: {
        buy: number;
        sell: number;
        hold: number;
    };
    winRate: number;
    realizedPnlSOL: number;
}

export interface AgentEvent {
    type: 'agent:spawned' | 'agent:decision' | 'agent:trade' | 'agent:balance' | 'agent:stopped' | 'agent:error' | 'agent:cycle';
    agentId: string;
    data: Record<string, unknown>;
    timestamp: string;
}
