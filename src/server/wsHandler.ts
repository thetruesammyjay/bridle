import { WebSocketServer, WebSocket } from 'ws';
import { AgentManager } from '../agent/AgentManager.js';
import { AgentEvent } from '../agent/types.js';

/**
 * WebSocket handler that broadcasts agent events to all connected dashboard clients.
 */
export class WSHandler {
    private wss: WebSocketServer;
    private clients: Set<WebSocket> = new Set();

    constructor(wss: WebSocketServer, agentManager: AgentManager) {
        this.wss = wss;

        // Handle new connections
        this.wss.on('connection', (ws: WebSocket) => {
            console.log('[WS] Client connected');
            this.clients.add(ws);

            // Send current state snapshot on connect
            const agents = agentManager.getAgents();
            ws.send(JSON.stringify({
                type: 'snapshot',
                data: { agents },
                timestamp: new Date().toISOString(),
            }));

            ws.on('close', () => {
                console.log('[WS] Client disconnected');
                this.clients.delete(ws);
            });

            ws.on('error', (error) => {
                console.error('[WS] Client error:', error);
                this.clients.delete(ws);
            });
        });

        // Subscribe to agent events
        agentManager.onEvent((event: AgentEvent) => {
            this.broadcast(event);
        });
    }

    /**
     * Broadcast an event to all connected clients.
     */
    private broadcast(event: AgentEvent): void {
        const message = JSON.stringify(event);
        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(message);
                } catch (error) {
                    console.error('[WS] Broadcast error:', error);
                    this.clients.delete(client);
                }
            }
        }
    }

    /**
     * Get connected client count.
     */
    getClientCount(): number {
        return this.clients.size;
    }
}
