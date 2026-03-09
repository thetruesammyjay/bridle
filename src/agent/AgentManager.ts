import { v4 as uuidv4 } from 'uuid';
import { WalletManager } from '../wallet/WalletManager.js';
import { AIEngine } from '../ai/AIEngine.js';
import { RuleEngine } from '../ai/RuleEngine.js';
import { MarketDataService } from '../ai/MarketDataService.js';
import { TradingEngine } from '../trading/TradingEngine.js';
import { PolicyGuard } from '../policy/PolicyGuard.js';
import { AuditLogger } from '../policy/AuditLogger.js';
import { config } from '../config.js';
import { Agent } from './Agent.js';
import { AgentConfig, AgentState, AgentEvent } from './types.js';
import { DEFAULT_RISK_PROFILES } from '../ai/types.js';
import { TelegramNotifier } from '../notifications/TelegramNotifier.js';
import { WalletConnectService } from '../walletconnect/WalletConnectService.js';

/**
 * AgentManager orchestrates multiple autonomous agents.
 * Handles spawning, stopping, and querying agent states.
 */
export class AgentManager {
    private agents: Map<string, Agent> = new Map();
    private walletManager: WalletManager;
    private aiEngine: AIEngine;
    private ruleEngine: RuleEngine;
    private marketDataService: MarketDataService;
    private tradingEngine: TradingEngine;
    private policyGuard: PolicyGuard;
    private auditLogger: AuditLogger;
    private telegramNotifier: TelegramNotifier;
    private wcService: WalletConnectService;
    private eventListeners: Array<(event: AgentEvent) => void> = [];

    constructor() {
        this.walletManager = new WalletManager();
        this.aiEngine = new AIEngine();
        this.ruleEngine = new RuleEngine();
        this.marketDataService = new MarketDataService();
        this.policyGuard = new PolicyGuard();
        this.auditLogger = new AuditLogger();
        this.tradingEngine = new TradingEngine(
            this.walletManager,
            this.policyGuard,
            this.auditLogger
        );
        this.telegramNotifier = new TelegramNotifier();
        this.wcService = new WalletConnectService(this.walletManager);

        // Forward WalletConnect events through the main event bus
        this.wcService.onEvent((wcEvent) => {
            this.broadcastEvent({
                type: wcEvent.type as AgentEvent['type'],
                agentId: (wcEvent.data as any).agentId || '',
                data: wcEvent.data as Record<string, unknown>,
                timestamp: new Date().toISOString(),
            });
        });

        if (this.telegramNotifier.isEnabled()) {
            this.onEvent((event) => this.telegramNotifier.handleAgentEvent(event));
        }
    }

    async initialize(): Promise<void> {
        await this.walletManager.initialize();
        await this.auditLogger.initialize();
    }

    /**
     * Subscribe to agent events (used by WebSocket handler).
     */
    onEvent(listener: (event: AgentEvent) => void): void {
        this.eventListeners.push(listener);
    }

    private broadcastEvent(event: AgentEvent): void {
        for (const listener of this.eventListeners) {
            try {
                listener(event);
            } catch (error) {
                console.error('[AgentManager] Event listener error:', error);
            }
        }
    }

    /**
     * Spawn a new agent with the given config.
     */
    async spawnAgent(partialConfig?: Partial<AgentConfig>): Promise<AgentState> {
        const id = uuidv4();
        const agentConfig: AgentConfig = {
            name: partialConfig?.name || `Agent-${id.substring(0, 6)}`,
            riskProfile: partialConfig?.riskProfile || 'moderate',
            policy: partialConfig?.policy || {
                maxTradeSOL: DEFAULT_RISK_PROFILES[partialConfig?.riskProfile || 'moderate'].maxTradeSizeSOL,
                dailyLimitSOL: DEFAULT_RISK_PROFILES[partialConfig?.riskProfile || 'moderate'].dailyLimitSOL,
                allowedTokens: DEFAULT_RISK_PROFILES[partialConfig?.riskProfile || 'moderate'].preferredTokens,
                cooldownMs: 10000, // 10 second cooldown between trades
            },
            intervalMs: partialConfig?.intervalMs || config.agent.intervalMs,
        };

        // Register policy
        this.policyGuard.setPolicy(id, agentConfig.policy);

        // Create agent
        const agent = new Agent(
            id,
            agentConfig,
            this.walletManager,
            this.aiEngine,
            this.ruleEngine,
            this.marketDataService,
            this.tradingEngine,
            this.auditLogger,
            (event) => this.broadcastEvent(event)
        );

        // Initialize (creates wallet, airdrops)
        await agent.initialize();

        this.agents.set(id, agent);

        // Start autonomous loop
        await agent.start();

        return agent.getState();
    }

    /**
     * Stop and remove an agent.
     */
    async stopAgent(agentId: string): Promise<void> {
        const agent = this.agents.get(agentId);
        if (!agent) throw new Error(`Agent ${agentId} not found`);

        await agent.stop();
        this.agents.delete(agentId);
    }

    /**
     * Get all agents' current states.
     */
    getAgents(): AgentState[] {
        return Array.from(this.agents.values()).map(agent => agent.getState());
    }

    /**
     * Get a single agent's state.
     */
    getAgent(agentId: string): AgentState | undefined {
        return this.agents.get(agentId)?.getState();
    }

    /**
     * Request an airdrop for an agent.
     */
    async requestAirdrop(agentId: string, amountSOL?: number): Promise<string> {
        const agent = this.agents.get(agentId);
        if (!agent) throw new Error(`Agent ${agentId} not found`);
        return agent.requestAirdrop(amountSOL);
    }

    /**
     * Get audit history for an agent.
     */
    async getAgentHistory(agentId: string, limit?: number) {
        return this.auditLogger.getHistory(agentId, limit);
    }

    /**
     * Stop all agents gracefully.
     */
    async shutdown(): Promise<void> {
        const stopPromises = Array.from(this.agents.keys()).map(id => this.stopAgent(id));
        await Promise.allSettled(stopPromises);
    }

    /**
     * Get the WalletConnect service (used by API routes).
     */
    getWalletConnectService(): WalletConnectService {
        return this.wcService;
    }
}
