import fs from 'fs/promises';
import { config, isGeminiConfigured } from './config.js';
import { AgentManager } from './agent/AgentManager.js';
import { startServer } from './server/server.js';

async function main(): Promise<void> {
    console.log('🐴 Bridle — Starting up...');

    // Ensure data directories exist
    await fs.mkdir(config.paths.keys, { recursive: true });
    await fs.mkdir(config.paths.logs, { recursive: true });

    // Log configuration
    console.log(`  RPC:        ${config.solana.rpcUrl}`);
    console.log(`  AI Engine:  ${isGeminiConfigured() ? 'Gemini (' + config.gemini.model + ')' : 'Rule-based fallback'}`);
    console.log(`  Port:       ${config.server.port}`);
    console.log(`  Interval:   ${config.agent.intervalMs}ms`);

    // Initialize agent manager
    const agentManager = new AgentManager();
    await agentManager.initialize();

    // Start HTTP + WebSocket server
    await startServer(agentManager);

    // Graceful shutdown
    const shutdown = async () => {
        console.log('\n🐴 Bridle — Shutting down...');
        await agentManager.shutdown();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});
