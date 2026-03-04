import { TradeDecision } from '../ai/types.js';
import { AgentPolicy, PolicyCheckResult } from './types.js';

/**
 * PolicyGuard validates trade decisions against per-agent policies.
 * Tracks daily spending and enforces cooldown periods.
 */
export class PolicyGuard {
    private policies: Map<string, AgentPolicy> = new Map();
    private dailySpending: Map<string, number> = new Map();
    private lastTradeTime: Map<string, number> = new Map();
    private dayStart: number = Date.now();

    /**
     * Register a policy for an agent.
     */
    setPolicy(agentId: string, policy: AgentPolicy): void {
        this.policies.set(agentId, policy);
        this.dailySpending.set(agentId, 0);
    }

    /**
     * Validate a trade decision against the agent's policy.
     */
    validateTrade(agentId: string, decision: TradeDecision): PolicyCheckResult {
        const policy = this.policies.get(agentId);
        if (!policy) {
            return { allowed: false, reason: 'No policy configured for this agent' };
        }

        // Reset daily tracking if new day
        this.resetDailyIfNeeded();

        // Check max trade size
        if (decision.amountSOL > policy.maxTradeSOL) {
            return {
                allowed: false,
                reason: `Trade size ${decision.amountSOL} SOL exceeds max ${policy.maxTradeSOL} SOL`,
            };
        }

        // Check daily limit
        const spent = this.dailySpending.get(agentId) || 0;
        if (spent + decision.amountSOL > policy.dailyLimitSOL) {
            return {
                allowed: false,
                reason: `Daily limit would be exceeded: spent ${spent.toFixed(4)} + ${decision.amountSOL} > ${policy.dailyLimitSOL} SOL`,
            };
        }

        // Check cooldown
        const lastTrade = this.lastTradeTime.get(agentId) || 0;
        const elapsed = Date.now() - lastTrade;
        if (elapsed < policy.cooldownMs && lastTrade > 0) {
            const remaining = Math.ceil((policy.cooldownMs - elapsed) / 1000);
            return {
                allowed: false,
                reason: `Cooldown active: ${remaining}s remaining`,
            };
        }

        // Check token whitelist
        if (policy.allowedTokens.length > 0) {
            const inputAllowed = policy.allowedTokens.includes(decision.inputToken);
            const outputAllowed = policy.allowedTokens.includes(decision.outputToken);
            if (!inputAllowed || !outputAllowed) {
                return {
                    allowed: false,
                    reason: `Token not whitelisted: ${!inputAllowed ? decision.inputToken : decision.outputToken}`,
                };
            }
        }

        return { allowed: true, reason: 'Trade approved by policy' };
    }

    /**
     * Record spending after a successful trade.
     */
    recordSpending(agentId: string, amountSOL: number): void {
        const current = this.dailySpending.get(agentId) || 0;
        this.dailySpending.set(agentId, current + amountSOL);
        this.lastTradeTime.set(agentId, Date.now());
    }

    /**
     * Get remaining daily allowance for an agent.
     */
    getRemainingAllowance(agentId: string): number {
        const policy = this.policies.get(agentId);
        if (!policy) return 0;
        const spent = this.dailySpending.get(agentId) || 0;
        return Math.max(0, policy.dailyLimitSOL - spent);
    }

    private resetDailyIfNeeded(): void {
        const now = Date.now();
        const oneDayMs = 24 * 60 * 60 * 1000;
        if (now - this.dayStart > oneDayMs) {
            this.dayStart = now;
            this.dailySpending.clear();
        }
    }
}
