import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { config } from '../config.js';
import { AgentManager } from '../agent/AgentManager.js';
import { createApiRouter } from './api.js';
import { WSHandler } from './wsHandler.js';

/**
 * Creates and starts the Express + WebSocket server.
 */
export async function startServer(agentManager: AgentManager): Promise<void> {
    const app = express();
    const httpServer = createServer(app);

    // Middleware
    app.use(express.json());

    // Serve dashboard static files
    app.use(express.static(config.paths.dashboard));

    // API routes
    app.use('/api', createApiRouter(agentManager));

    // SPA fallback — serve index.html for non-api routes
    app.get('*', (_req, res) => {
        res.sendFile(path.join(config.paths.dashboard, 'index.html'));
    });

    // WebSocket server
    const wss = new WebSocketServer({ server: httpServer });
    new WSHandler(wss, agentManager);

    // Start listening
    return new Promise((resolve) => {
        httpServer.listen(config.server.port, () => {
            console.log('');
            console.log('  ╔══════════════════════════════════════════════╗');
            console.log('  ║                                              ║');
            console.log('  ║   🐴 BRIDLE — Agentic Wallet Platform        ║');
            console.log('  ║                                              ║');
            console.log(`  ║   Dashboard:  http://localhost:${config.server.port}            ║`);
            console.log(`  ║   API:        http://localhost:${config.server.port}/api/status  ║`);
            console.log(`  ║   WebSocket:  ws://localhost:${config.server.port}              ║`);
            console.log('  ║                                              ║');
            console.log('  ╚══════════════════════════════════════════════╝');
            console.log('');
            resolve();
        });
    });
}
