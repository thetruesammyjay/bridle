import { EventEmitter } from 'events';
import { WalletManager } from '../wallet/WalletManager.js';
import { AIEngine } from '../ai/AIEngine.js';
import { RuleEngine } from '../ai/RuleEngine.js';
import { MarketDataService } from '../ai/MarketDataService.js';
import { TradingEngine } from '../trading/TradingEngine.js';
import { PolicyGuard } from '../policy/PolicyGuard.js';
import { AuditLogger } from '../policy/AuditLogger.js';
import { Agent } from '../agent/Agent.js';
import { config, isGeminiConfigured } from '../config.js';
import { DEFAULT_RISK_PROFILES, RiskProfileLevel, TradeDecision, MarketSnapshot } from '../ai/types.js';
import { AgentEvent, AgentState } from '../agent/types.js';
import { TradeResult } from '../trading/types.js';

// ─── Public Types ───

export interface BridleAgentOptions {
    /** Agent display name */
    name?: string;
    /** Risk profile: 'conservative' | 'moderate' | 'aggressive' */
    riskProfile?: RiskProfileLevel;
    /** Decision loop interval in milliseconds (default: 30000) */
    intervalMs?: number;
    /** Gemini API key (overrides .env) */
    geminiApiKey?: string;
    /** Gemini model name (overrides .env) */
    geminiModel?: string;
    /** Solana RPC URL (overrides .env) */
    rpcUrl?: string;
}

export interface BridleAgentInfo {
    id: string;
    name: string;
    publicKey: string;
    balanceSOL: number;
    riskProfile: RiskProfileLevel;
    status: string;
    cycleCount: number;
    totalTradesExecuted: number;
    lastDecision: TradeDecision | null;
}

export type BridleEventType = 'decision' | 'trade' | 'balance' | 'error' | 'cycle' | 'started' | 'stopped';

export interface BridleEvent {
    type: BridleEventType;
    agentId: string;
    data: Record<string, unknown>;
    timestamp: string;
}

// ─── BridleAgent SDK ───

/**
 * BridleAgent — Programmatic SDK for creating autonomous Solana trading agents.
 *
 * @example
 * ```typescript
 * import { BridleAgent } from 'bridle/sdk';
 *
 * const agent = new BridleAgent({ name: 'Alpha', riskProfile: 'moderate' });
 * await agent.initialize();
 *
 * agent.on('decision', (event) => console.log('Decision:', event.data));
 * agent.on('trade', (event) => console.log('Trade:', event.data));
 *
 * await agent.start();
 * ```
 */
export class BridleAgent extends EventEmitter {
    private readonly agentId: string;
    private readonly options: Required<BridleAgentOptions>;
    private agent: Agent | null = null;
    private walletManager: WalletManager | null = null;
    private auditLogger: AuditLogger | null = null;
    private initialized = false;
    private running = false;

    constructor(options: BridleAgentOptions = {}) {
        super();

        this.agentId = `sdk-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;

        this.options = {
            name: options.name || `Agent-${this.agentId.substring(4, 10)}`,
            riskProfile: options.riskProfile || 'moderate',
            intervalMs: options.intervalMs || 30000,
            geminiApiKey: options.geminiApiKey || config.gemini.apiKey,
            geminiModel: options.geminiModel || config.gemini.model,
            rpcUrl: options.rpcUrl || config.solana.rpcUrl,
        };
    }

    /**
     * Initialize the agent: creates wallet, sets up services.
     * Must be called before start().
     */
    async initialize(): Promise<BridleAgentInfo> {
        if (this.initialized) {
            throw new Error('Agent already initialized');
        }

        this.walletManager = new WalletManager();
        await this.walletManager.initialize();

        const aiEngine = new AIEngine();
        const ruleEngine = new RuleEngine();
        const marketDataService = new MarketDataService();
        const policyGuard = new PolicyGuard();
        this.auditLogger = new AuditLogger();
        await this.auditLogger.initialize();
        const tradingEngine = new TradingEngine(this.walletManager, policyGuard, this.auditLogger);

        const riskDef = DEFAULT_RISK_PROFILES[this.options.riskProfile];

        this.agent = new Agent(
            this.agentId,
            {
                name: this.options.name,
                riskProfile: this.options.riskProfile,
                intervalMs: this.options.intervalMs,
                policy: {
                    maxTradeSOL: riskDef.maxTradeSizeSOL,
                    dailyLimitSOL: riskDef.dailyLimitSOL,
                    allowedTokens: riskDef.preferredTokens,
                    cooldownMs: this.options.intervalMs,
                },
            },
            this.walletManager,
            aiEngine,
            ruleEngine,
            marketDataService,
            tradingEngine,
            this.auditLogger,
            (event: AgentEvent) => this.handleEvent(event),
        );

        await this.agent.initialize();
        this.initialized = true;

        return this.getInfo();
    }

    /**
     * Start the autonomous trading loop.
     */
    async start(): Promise<void> {
        if (!this.initialized || !this.agent) {
            throw new Error('Agent not initialized. Call initialize() first.');
        }
        if (this.running) {
            throw new Error('Agent is already running.');
        }

        this.running = true;
        await this.agent.start();

        this.emit('started', {
            type: 'started' as BridleEventType,
            agentId: this.agentId,
            data: { name: this.options.name },
            timestamp: new Date().toISOString(),
        });
    }

    /**
     * Stop the agent's trading loop.
     */
    async stop(): Promise<void> {
        if (!this.agent) return;

        await this.agent.stop();
        this.running = false;

        this.emit('stopped', {
            type: 'stopped' as BridleEventType,
            agentId: this.agentId,
            data: { name: this.options.name },
            timestamp: new Date().toISOString(),
        });
    }

    /**
     * Get agent info and state.
     */
    getInfo(): BridleAgentInfo {
        if (!this.agent) {
            throw new Error('Agent not initialized');
        }

        const state = this.agent.getState();
        return {
            id: this.agentId,
            name: this.options.name,
            publicKey: state.publicKey,
            balanceSOL: state.balanceSOL,
            riskProfile: this.options.riskProfile,
            status: state.status,
            cycleCount: state.cycleCount,
            totalTradesExecuted: state.totalTradesExecuted,
            lastDecision: state.lastDecision,
        };
    }

    /**
     * Request a devnet SOL airdrop.
     */
    async airdrop(amountSOL: number = 1): Promise<string> {
        if (!this.walletManager) {
            throw new Error('Agent not initialized');
        }
        return this.walletManager.requestAirdrop(this.agentId, amountSOL);
    }

    /**
     * Get the agent's public key.
     */
    getPublicKey(): string {
        if (!this.agent) throw new Error('Agent not initialized');
        return this.agent.getState().publicKey;
    }

    /**
     * Get the agent's current SOL balance.
     */
    async getBalance(): Promise<number> {
        if (!this.walletManager) throw new Error('Agent not initialized');
        return this.walletManager.getBalance(this.agentId);
    }

    /**
     * Destroy the agent: stops trading, deletes wallet.
     */
    async destroy(): Promise<void> {
        await this.stop();
        if (this.walletManager) {
            await this.walletManager.deleteWallet(this.agentId);
        }
        this.removeAllListeners();
        this.initialized = false;
    }

    /**
     * Whether the agent is currently running.
     */
    isRunning(): boolean {
        return this.running;
    }

    // ─── Internal ───

    private handleEvent(event: AgentEvent): void {
        const typeMap: Record<string, BridleEventType> = {
            'agent:decision': 'decision',
            'agent:trade': 'trade',
            'agent:balance': 'balance',
            'agent:error': 'error',
            'agent:cycle': 'cycle',
            'agent:spawned': 'started',
            'agent:stopped': 'stopped',
        };

        const bridleType = typeMap[event.type];
        if (bridleType) {
            const bridleEvent: BridleEvent = {
                type: bridleType,
                agentId: event.agentId,
                data: event.data,
                timestamp: event.timestamp,
            };
            this.emit(bridleType, bridleEvent);
            this.emit('*', bridleEvent); // wildcard listener
        }
    }
}

// ─── Convenience Exports ───

export { DEFAULT_RISK_PROFILES } from '../ai/types.js';
export type { TradeDecision, MarketSnapshot, RiskProfile, RiskProfileLevel } from '../ai/types.js';
export type { TradeResult } from '../trading/types.js';
export type { AgentState, AgentEvent } from '../agent/types.js';
