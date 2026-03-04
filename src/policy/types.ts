// ── Policy Types ──

export interface AgentPolicy {
    maxTradeSOL: number;
    dailyLimitSOL: number;
    allowedTokens: string[];
    cooldownMs: number;
}

export interface PolicyCheckResult {
    allowed: boolean;
    reason: string;
}

export type AuditEventType =
    | 'WALLET_CREATED'
    | 'AIRDROP_RECEIVED'
    | 'TRADE_DECISION'
    | 'TRADE_EXECUTED'
    | 'TRADE_FAILED'
    | 'POLICY_VIOLATION'
    | 'AGENT_STARTED'
    | 'AGENT_STOPPED'
    | 'ERROR';

export interface AuditEntry {
    timestamp: string;
    agentId: string;
    event: AuditEventType;
    data: Record<string, unknown>;
}
