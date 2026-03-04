import { WalletManager } from './wallet/WalletManager.js';
import { AIEngine } from './ai/AIEngine.js';
import { RuleEngine } from './ai/RuleEngine.js';
import { MarketDataService } from './ai/MarketDataService.js';
import { TradingEngine } from './trading/TradingEngine.js';
import { PolicyGuard } from './policy/PolicyGuard.js';
import { AuditLogger } from './policy/AuditLogger.js';
import { Agent } from './agent/Agent.js';
import { config, isGeminiConfigured } from './config.js';
import { AgentEvent } from './agent/types.js';
import { DEFAULT_RISK_PROFILES } from './ai/types.js';

// ─── ANSI Colors ───
const C = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    red: '\x1b[31m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgRed: '\x1b[41m',
};

function log(icon: string, msg: string) {
    console.log(`  ${icon}  ${msg}`);
}

function header(text: string) {
    const line = '─'.repeat(50);
    console.log(`\n${C.green}${line}${C.reset}`);
    console.log(`${C.bold}${C.green}  ${text}${C.reset}`);
    console.log(`${C.green}${line}${C.reset}\n`);
}

function divider() {
    console.log(`${C.dim}  ${'· '.repeat(25)}${C.reset}`);
}

function actionColor(action: string): string {
    if (action === 'BUY') return `${C.bgGreen}${C.bold} BUY  ${C.reset}`;
    if (action === 'SELL') return `${C.bgRed}${C.bold} SELL ${C.reset}`;
    return `${C.dim} HOLD ${C.reset}`;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Demo Command ───
async function runDemo() {
    console.log(`
${C.bold}${C.green}
    ╔══════════════════════════════════════════╗
    ║                                          ║
    ║   🐴  BRIDLE — CLI Demo                  ║
    ║   Autonomous Agent Trading on Solana      ║
    ║                                          ║
    ╚══════════════════════════════════════════╝
${C.reset}`);

    const DEMO_CYCLES = 3;
    const riskProfile = 'moderate';
    const agentName = 'Demo-Agent';
    const agentId = `demo-${Date.now().toString(36)}`;

    // ─── Step 1: Initialize services ───
    header('Step 1: Initializing Services');

    const walletManager = new WalletManager();
    await walletManager.initialize();
    log(`${C.green}✓${C.reset}`, 'Wallet Manager initialized');

    const aiEngine = new AIEngine();
    const ruleEngine = new RuleEngine();
    const marketDataService = new MarketDataService();
    const policyGuard = new PolicyGuard();
    const auditLogger = new AuditLogger();
    await auditLogger.initialize();
    const tradingEngine = new TradingEngine(walletManager, policyGuard, auditLogger);

    const engineType = isGeminiConfigured() && aiEngine.isAvailable()
        ? `${C.cyan}Gemini (${config.gemini.model})${C.reset}`
        : `${C.yellow}Rule Engine (fallback)${C.reset}`;
    log(`${C.green}✓${C.reset}`, `AI Engine: ${engineType}`);
    log(`${C.green}✓${C.reset}`, `RPC: ${C.cyan}${config.solana.rpcUrl}${C.reset}`);

    // ─── Step 2: Create Agent & Wallet ───
    header('Step 2: Creating Agent Wallet');

    const events: AgentEvent[] = [];
    const riskDef = DEFAULT_RISK_PROFILES[riskProfile];
    const agent = new Agent(
        agentId,
        {
            name: agentName,
            riskProfile,
            intervalMs: 5000,
            policy: {
                maxTradeSOL: riskDef.maxTradeSizeSOL,
                dailyLimitSOL: riskDef.dailyLimitSOL,
                allowedTokens: riskDef.preferredTokens,
                cooldownMs: 30000,
            },
        },
        walletManager,
        aiEngine,
        ruleEngine,
        marketDataService,
        tradingEngine,
        auditLogger,
        (event: AgentEvent) => { events.push(event); }
    );

    await agent.initialize();

    const state = agent.getState();
    log(`${C.green}✓${C.reset}`, `Agent: ${C.bold}${agentName}${C.reset}`);
    log(`${C.green}✓${C.reset}`, `Public Key: ${C.cyan}${state.publicKey}${C.reset}`);
    log(`${C.green}✓${C.reset}`, `Balance: ${C.yellow}${state.balanceSOL.toFixed(4)} SOL${C.reset}`);
    log(`${C.green}✓${C.reset}`, `Risk Profile: ${C.magenta}${riskProfile}${C.reset}`);

    if (state.balanceSOL === 0) {
        log(`${C.yellow}!${C.reset}`, `${C.dim}No SOL received (devnet faucet may be rate-limited)${C.reset}`);
        log(`${C.yellow}!${C.reset}`, `${C.dim}Fund manually: https://faucet.solana.com → ${state.publicKey}${C.reset}`);
    }

    // ─── Step 3: Run Decision Cycles ───
    header(`Step 3: Running ${DEMO_CYCLES} Decision Cycles`);

    // We'll manually trigger cycles by starting and immediately running
    for (let cycle = 1; cycle <= DEMO_CYCLES; cycle++) {
        console.log(`\n  ${C.bold}${C.blue}Cycle ${cycle}/${DEMO_CYCLES}${C.reset}`);
        divider();

        // Get market data
        const marketData = await marketDataService.getMarketSnapshotAsync();
        const dataSource = marketDataService.isLive() ? `${C.green}LIVE${C.reset}` : `${C.yellow}SIMULATED${C.reset}`;
        log(`${C.blue}▸${C.reset}`, `Market Trend: ${C.bold}${marketData.trend}${C.reset} (${dataSource})`);

        const solPrice = marketData.prices['SOL'];
        const solChange = marketData.changes24h['SOL'];
        const changeColor = solChange >= 0 ? C.green : C.red;
        log(`${C.blue}▸${C.reset}`, `SOL: $${solPrice.toFixed(2)} (${changeColor}${solChange >= 0 ? '+' : ''}${solChange.toFixed(2)}%${C.reset})`);

        // Get decision
        const portfolio = {
            balanceSOL: state.balanceSOL,
            tokens: {},
            totalValueUSD: state.balanceSOL * solPrice,
        };

        let decision = ruleEngine.analyzeAndDecide(agentId, agentName, marketData, portfolio, riskDef);
        try {
            if (isGeminiConfigured() && aiEngine.isAvailable() && !aiEngine.isRateLimited()) {
                decision = await aiEngine.analyzeAndDecide(agentId, agentName, marketData, portfolio, riskDef);
            }
        } catch {
            // Already initialized with ruleEngine fallback
        }

        log(`${C.green}▸${C.reset}`, `Decision: ${actionColor(decision.action)}  Confidence: ${C.bold}${(decision.confidence * 100).toFixed(0)}%${C.reset}`);

        if (decision.action !== 'HOLD') {
            log(`${C.green}▸${C.reset}`, `Amount: ${C.yellow}${decision.amountSOL} SOL${C.reset} → ${C.cyan}${decision.outputToken}${C.reset}`);
        }

        // Wrap reasoning to fit terminal
        const reasoning = decision.reasoning.substring(0, 120);
        log(`${C.dim}▸${C.reset}`, `${C.dim}${reasoning}${reasoning.length >= 120 ? '...' : ''}${C.reset}`);

        if (cycle < DEMO_CYCLES) {
            console.log(`\n  ${C.dim}Waiting 3s for next cycle...${C.reset}`);
            await sleep(3000);
        }
    }

    // ─── Step 4: Summary ───
    header('Demo Complete');

    console.log(`  ${C.bold}Agent Summary${C.reset}`);
    console.log(`  ├─ Name:         ${C.bold}${agentName}${C.reset}`);
    console.log(`  ├─ Public Key:   ${C.cyan}${state.publicKey}${C.reset}`);
    console.log(`  ├─ Balance:      ${C.yellow}${state.balanceSOL.toFixed(4)} SOL${C.reset}`);
    console.log(`  ├─ Cycles Run:   ${C.bold}${DEMO_CYCLES}${C.reset}`);
    console.log(`  ├─ AI Engine:    ${engineType}`);
    console.log(`  └─ Events:       ${C.bold}${events.length}${C.reset} emitted\n`);

    console.log(`  ${C.green}${C.bold}Next steps:${C.reset}`);
    console.log(`  ${C.dim}1. Run the full dashboard:  ${C.cyan}npm run dev${C.reset}`);
    console.log(`  ${C.dim}2. Open in browser:         ${C.cyan}http://localhost:3000${C.reset}`);
    console.log(`  ${C.dim}3. View on Solana Explorer:  ${C.cyan}https://explorer.solana.com/address/${state.publicKey}?cluster=devnet${C.reset}\n`);

    // Cleanup
    await walletManager.deleteWallet(agentId);

    process.exit(0);
}

// ─── Entry Point ───
const command = process.argv[2];

if (command === 'demo') {
    runDemo().catch((err) => {
        console.error(`\n${C.red}  Demo failed: ${err.message}${C.reset}\n`);
        process.exit(1);
    });
} else {
    console.log(`
${C.bold}${C.green}  Bridle CLI${C.reset}

  ${C.bold}Usage:${C.reset}
    npx tsx src/cli.ts demo     Run interactive demo
    npx tsx src/cli.ts --help   Show this help

  ${C.bold}What the demo does:${C.reset}
    1. Creates an agent with its own Solana wallet
    2. Runs 3 AI decision cycles against market data
    3. Shows BUY/SELL/HOLD decisions with reasoning
    4. Cleans up and exits

  ${C.bold}Full server:${C.reset}
    npm run dev                 Start dashboard + API + WebSocket
`);
}
