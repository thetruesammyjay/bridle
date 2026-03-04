import { WalletManager } from '../wallet/WalletManager.js';
import { AIEngine } from '../ai/AIEngine.js';
import { RuleEngine } from '../ai/RuleEngine.js';
import { MarketDataService } from '../ai/MarketDataService.js';
import { TradingEngine } from '../trading/TradingEngine.js';
import { AuditLogger } from '../policy/AuditLogger.js';
import { isGeminiConfigured } from '../config.js';
import {
    TradeDecision,
    PortfolioState,
    RiskProfile,
    DEFAULT_RISK_PROFILES,
} from '../ai/types.js';
import { AgentConfig, AgentState, AgentEvent, AgentStatus } from './types.js';
import { TradeResult } from '../trading/types.js';

/**
 * Agent represents a single autonomous trading agent with its own wallet,
 * AI decision engine, and trading loop.
 */
export class Agent {
    readonly id: string;
    readonly name: string;
    private status: AgentStatus = 'idle';
    private publicKey: string = '';
    private balanceSOL: number = 0;
    private lastDecision: TradeDecision | null = null;
    private lastMarketSnapshot: any = null;
    private tradeHistory: TradeResult[] = [];
    private cycleCount: number = 0;
    private totalPnlSOL: number = 0;
    private createdAt: string;
    private intervalMs: number;
    private loopTimer: ReturnType<typeof setTimeout> | null = null;
    private consecutiveErrors: number = 0;
    private readonly MAX_BACKOFF_MS = 300_000; // 5 minutes max

    private riskProfile: RiskProfile;
    private walletManager: WalletManager;
    private aiEngine: AIEngine;
    private ruleEngine: RuleEngine;
    private marketDataService: MarketDataService;
    private tradingEngine: TradingEngine;
    private auditLogger: AuditLogger;
    private eventCallback: (event: AgentEvent) => void;

    constructor(
        id: string,
        agentConfig: AgentConfig,
        walletManager: WalletManager,
        aiEngine: AIEngine,
        ruleEngine: RuleEngine,
        marketDataService: MarketDataService,
        tradingEngine: TradingEngine,
        auditLogger: AuditLogger,
        eventCallback: (event: AgentEvent) => void
    ) {
        this.id = id;
        this.name = agentConfig.name;
        this.intervalMs = agentConfig.intervalMs;
        this.riskProfile = DEFAULT_RISK_PROFILES[agentConfig.riskProfile];
        this.walletManager = walletManager;
        this.aiEngine = aiEngine;
        this.ruleEngine = ruleEngine;
        this.marketDataService = marketDataService;
        this.tradingEngine = tradingEngine;
        this.auditLogger = auditLogger;
        this.eventCallback = eventCallback;
        this.createdAt = new Date().toISOString();
    }

    /**
     * Initialize the agent: create wallet, request airdrop.
     */
    async initialize(): Promise<void> {
        // Create wallet
        const walletInfo = await this.walletManager.createWallet(this.id);
        this.publicKey = walletInfo.publicKey;

        await this.auditLogger.log({
            timestamp: new Date().toISOString(),
            agentId: this.id,
            event: 'WALLET_CREATED',
            data: { publicKey: this.publicKey },
        });

        // Request devnet airdrop
        try {
            const sig = await this.walletManager.requestAirdrop(this.id);
            this.balanceSOL = await this.walletManager.getBalance(this.id);

            await this.auditLogger.log({
                timestamp: new Date().toISOString(),
                agentId: this.id,
                event: 'AIRDROP_RECEIVED',
                data: { signature: sig, amount: this.balanceSOL },
            });
        } catch (error) {
            console.warn(`[Agent ${this.name}] Airdrop failed:`, error);
        }

        this.emitEvent('agent:spawned', {
            name: this.name,
            publicKey: this.publicKey,
            balance: this.balanceSOL,
            riskProfile: this.riskProfile.level,
        });
    }

    /**
     * Start the autonomous trading loop.
     */
    async start(): Promise<void> {
        this.status = 'running';

        await this.auditLogger.log({
            timestamp: new Date().toISOString(),
            agentId: this.id,
            event: 'AGENT_STARTED',
            data: { name: this.name, riskProfile: this.riskProfile.level },
        });

        this.scheduleNextCycle();
    }

    /**
     * Stop the trading loop.
     */
    async stop(): Promise<void> {
        this.status = 'stopped';
        if (this.loopTimer) {
            clearTimeout(this.loopTimer);
            this.loopTimer = null;
        }

        await this.auditLogger.log({
            timestamp: new Date().toISOString(),
            agentId: this.id,
            event: 'AGENT_STOPPED',
            data: { cycleCount: this.cycleCount, totalTrades: this.tradeHistory.length },
        });

        this.emitEvent('agent:stopped', { name: this.name });
    }

    /**
     * Execute one decision cycle.
     */
    private async executeCycle(): Promise<void> {
        if (this.status === 'stopped') return;

        this.cycleCount++;

        try {
            // 1. Update balance
            this.status = 'deciding';
            this.balanceSOL = await this.walletManager.getBalance(this.id);

            this.emitEvent('agent:balance', {
                balance: this.balanceSOL,
                cycle: this.cycleCount,
            });

            // 2. Get market data (live Jupiter prices with simulation fallback)
            const marketData = await this.marketDataService.getMarketSnapshotAsync();
            this.lastMarketSnapshot = marketData;

            // 3. Build portfolio state
            const portfolio: PortfolioState = {
                balanceSOL: this.balanceSOL,
                tokens: {},
                totalValueUSD: this.balanceSOL * (marketData.prices['SOL'] || 150),
            };

            // 4. Get AI decision — auto-fallback to RuleEngine if Gemini is rate-limited
            let decision: TradeDecision;
            const useGemini = isGeminiConfigured() && this.aiEngine.isAvailable() && !this.aiEngine.isRateLimited();

            if (useGemini) {
                try {
                    decision = await this.aiEngine.analyzeAndDecide(
                        this.id, this.name, marketData, portfolio, this.riskProfile
                    );
                } catch (error) {
                    const errMsg = String(error);
                    if (errMsg.includes('RATE_LIMITED') || errMsg.includes('GEMINI_UNAVAILABLE')) {
                        console.log(`[Agent ${this.name}] Gemini unavailable, using RuleEngine for this cycle.`);
                        decision = this.ruleEngine.analyzeAndDecide(
                            this.id, this.name, marketData, portfolio, this.riskProfile
                        );
                        decision.reasoning = `[RuleEngine fallback] ${decision.reasoning}`;
                    } else {
                        throw error;
                    }
                }
            } else {
                decision = this.ruleEngine.analyzeAndDecide(
                    this.id, this.name, marketData, portfolio, this.riskProfile
                );
                if (isGeminiConfigured() && this.aiEngine.isRateLimited()) {
                    decision.reasoning = `[RuleEngine: Gemini rate-limited] ${decision.reasoning}`;
                }
            }

            this.lastDecision = decision;

            await this.auditLogger.log({
                timestamp: new Date().toISOString(),
                agentId: this.id,
                event: 'TRADE_DECISION',
                data: {
                    decision,
                    marketTrend: marketData.trend,
                    balance: this.balanceSOL,
                    cycle: this.cycleCount,
                },
            });

            this.emitEvent('agent:decision', {
                decision,
                market: {
                    trend: marketData.trend,
                    solPrice: marketData.prices['SOL'],
                },
                cycle: this.cycleCount,
            });

            // 5. Execute trade if not HOLD
            if (decision.action !== 'HOLD' && decision.amountSOL > 0) {
                this.status = 'trading';

                const result = await this.tradingEngine.executeTrade(this.id, decision);
                this.tradeHistory.push(result);

                // Keep only last 50 trades in memory
                if (this.tradeHistory.length > 50) {
                    this.tradeHistory = this.tradeHistory.slice(-50);
                }

                // Update balance after trade
                this.balanceSOL = await this.walletManager.getBalance(this.id);

                this.emitEvent('agent:trade', {
                    result,
                    newBalance: this.balanceSOL,
                    cycle: this.cycleCount,
                });
            }

            this.consecutiveErrors = 0; // Reset on success
            this.status = 'running';

            this.emitEvent('agent:cycle', {
                cycle: this.cycleCount,
                status: this.status,
                balance: this.balanceSOL,
            });

        } catch (error) {
            this.consecutiveErrors++;
            console.error(`[Agent ${this.name}] Cycle error (attempt ${this.consecutiveErrors}):`, error);

            this.status = 'error';
            await this.auditLogger.log({
                timestamp: new Date().toISOString(),
                agentId: this.id,
                event: 'ERROR',
                data: {
                    error: String(error),
                    cycle: this.cycleCount,
                    consecutiveErrors: this.consecutiveErrors,
                },
            });

            this.emitEvent('agent:error', {
                error: String(error),
                cycle: this.cycleCount,
                consecutiveErrors: this.consecutiveErrors,
            });

            // Auto-recover to running state
            this.status = 'running';
        }

        // Schedule next cycle (with backoff if errors)
        this.scheduleNextCycle();
    }

    private scheduleNextCycle(): void {
        if (this.status === 'stopped') return;

        let delay = this.intervalMs;

        // Exponential backoff on consecutive errors
        if (this.consecutiveErrors > 0) {
            delay = Math.min(
                this.intervalMs * Math.pow(2, this.consecutiveErrors),
                this.MAX_BACKOFF_MS
            );
            console.log(`[Agent ${this.id}] Backing off: next cycle in ${(delay / 1000).toFixed(0)}s (${this.consecutiveErrors} consecutive errors)`);
        }

        this.loopTimer = setTimeout(() => this.executeCycle(), delay);
    }

    /**
     * Get current agent state snapshot.
     */
    getState(): AgentState {
        const successfulTrades = this.tradeHistory.filter(t => t.success);
        // Basic win rate assuming trades that increased overall PnL count as wins
        const winRate = successfulTrades.length > 0 && this.totalPnlSOL > 0
            ? 100 // Simplified: if overall profitable, 100% win rate for now as we don't track per-trade PnL yet
            : 0;

        return {
            id: this.id,
            name: this.name,
            status: this.status,
            publicKey: this.publicKey,
            balanceSOL: this.balanceSOL,
            lastDecision: this.lastDecision,
            lastMarketSnapshot: this.lastMarketSnapshot,
            tradeHistory: [...this.tradeHistory],
            createdAt: this.createdAt,
            cycleCount: this.cycleCount,
            totalTradesExecuted: successfulTrades.length,
            totalPnlSOL: this.totalPnlSOL,
            // Analytics
            decisionDistribution: {
                buy: this.tradeHistory.filter(t => t.action === 'BUY').length,
                sell: this.tradeHistory.filter(t => t.action === 'SELL').length,
                hold: this.cycleCount - this.tradeHistory.length, // Rough estimate, hold = no trade
            },
            winRate,
            realizedPnlSOL: this.totalPnlSOL,
        };
    }

    /**
     * Manually request an airdrop (from API).
     */
    async requestAirdrop(amountSOL?: number): Promise<string> {
        const sig = await this.walletManager.requestAirdrop(this.id, amountSOL);
        this.balanceSOL = await this.walletManager.getBalance(this.id);

        this.emitEvent('agent:balance', {
            balance: this.balanceSOL,
            reason: 'airdrop',
        });

        return sig;
    }

    private emitEvent(type: AgentEvent['type'], data: Record<string, unknown>): void {
        this.eventCallback({
            type,
            agentId: this.id,
            data,
            timestamp: new Date().toISOString(),
        });
    }
}
