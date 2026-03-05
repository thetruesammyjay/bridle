import { Router, Request, Response } from 'express';
import { AgentManager } from '../agent/AgentManager.js';

interface AgentParams {
    id: string;
}

/**
 * REST API routes for agent management.
 */
export function createApiRouter(agentManager: AgentManager): Router {
    const router = Router();

    // GET /api/agents — List all agents
    router.get('/agents', (_req: Request, res: Response) => {
        try {
            const agents = agentManager.getAgents();
            res.json({ success: true, agents });
        } catch (error) {
            res.status(500).json({ success: false, error: String(error) });
        }
    });

    // GET /api/agents/:id — Get single agent state
    router.get('/agents/:id', (req: Request<AgentParams>, res: Response) => {
        try {
            const agent = agentManager.getAgent(req.params.id);
            if (!agent) {
                res.status(404).json({ success: false, error: 'Agent not found' });
                return;
            }
            res.json({ success: true, agent });
        } catch (error) {
            res.status(500).json({ success: false, error: String(error) });
        }
    });

    // POST /api/agents — Spawn a new agent
    router.post('/agents', async (req: Request, res: Response) => {
        try {
            const { name, riskProfile, intervalMs } = req.body || {};
            const agentState = await agentManager.spawnAgent({
                name,
                riskProfile,
                intervalMs,
            });
            res.status(201).json({ success: true, agent: agentState });
        } catch (error) {
            console.error('[API] Error spawning agent:', error);
            res.status(500).json({ success: false, error: String(error) });
        }
    });

    // DELETE /api/agents/:id — Stop an agent
    router.delete('/agents/:id', async (req: Request<AgentParams>, res: Response) => {
        try {
            await agentManager.stopAgent(req.params.id);
            res.json({ success: true, message: 'Agent stopped' });
        } catch (error) {
            res.status(500).json({ success: false, error: String(error) });
        }
    });

    // GET /api/agents/:id/history — Get audit log for agent
    router.get('/agents/:id/history', async (req: Request<AgentParams>, res: Response) => {
        try {
            const limit = parseInt(req.query.limit as string) || 50;
            const history = await agentManager.getAgentHistory(req.params.id, limit);
            res.json({ success: true, history });
        } catch (error) {
            res.status(500).json({ success: false, error: String(error) });
        }
    });

    // POST /api/agents/:id/airdrop — Request devnet airdrop
    router.post('/agents/:id/airdrop', async (req: Request<AgentParams>, res: Response) => {
        try {
            const { amount } = req.body || {};
            const signature = await agentManager.requestAirdrop(req.params.id, amount);
            const agent = agentManager.getAgent(req.params.id);
            res.json({
                success: true,
                signature,
                newBalance: agent?.balanceSOL,
            });
        } catch (error) {
            res.status(500).json({ success: false, error: String(error) });
        }
    });

    // GET /api/status — System status
    router.get('/status', (_req: Request, res: Response) => {
        const agents = agentManager.getAgents();
        res.json({
            success: true,
            status: 'operational',
            agentCount: agents.length,
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
        });
    });

    // ─── WalletConnect Routes ───

    const wcService = agentManager.getWalletConnectService();

    // POST /api/wc/connect — Connect a dApp to an agent's wallet
    router.post('/wc/connect', (req: Request, res: Response) => {
        try {
            const { agentId, dappName, dappUrl } = req.body || {};
            if (!agentId || !dappName) {
                res.status(400).json({ success: false, error: 'agentId and dappName are required' });
                return;
            }
            const session = wcService.connectDApp(agentId, dappName, dappUrl || '');
            if (!session) {
                res.status(404).json({ success: false, error: 'Agent wallet not found' });
                return;
            }
            res.status(201).json({ success: true, session });
        } catch (error) {
            res.status(500).json({ success: false, error: String(error) });
        }
    });

    // DELETE /api/wc/sessions/:id — Disconnect a dApp session
    router.delete('/wc/sessions/:id', (req: Request, res: Response) => {
        try {
            const disconnected = wcService.disconnectSession(req.params.id as string);
            if (!disconnected) {
                res.status(404).json({ success: false, error: 'Session not found' });
                return;
            }
            res.json({ success: true, message: 'Session disconnected' });
        } catch (error) {
            res.status(500).json({ success: false, error: String(error) });
        }
    });

    // GET /api/wc/sessions — List all active dApp sessions
    router.get('/wc/sessions', (_req: Request, res: Response) => {
        try {
            const sessions = wcService.getSessions();
            res.json({ success: true, sessions });
        } catch (error) {
            res.status(500).json({ success: false, error: String(error) });
        }
    });

    // POST /api/wc/sign — Submit a sign request (from a connected dApp)
    router.post('/wc/sign', async (req: Request, res: Response) => {
        try {
            const { sessionId, type, payload, description } = req.body || {};
            if (!sessionId || !payload) {
                res.status(400).json({ success: false, error: 'sessionId and payload are required' });
                return;
            }
            const result = await wcService.requestSignature(
                sessionId,
                type || 'sign_transaction',
                payload,
                description || 'Transaction signing request'
            );
            res.json({ success: true, ...result });
        } catch (error) {
            res.status(500).json({ success: false, error: String(error) });
        }
    });

    // POST /api/wc/requests/:id/resolve — Approve or reject a pending sign request
    router.post('/wc/requests/:id/resolve', async (req: Request, res: Response) => {
        try {
            const { approved } = req.body || {};
            if (typeof approved !== 'boolean') {
                res.status(400).json({ success: false, error: 'approved (boolean) is required' });
                return;
            }
            const result = await wcService.resolveRequest(req.params.id as string, approved);
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: String(error) });
        }
    });

    // GET /api/wc/requests — List pending sign requests
    router.get('/wc/requests', (_req: Request, res: Response) => {
        try {
            const requests = wcService.getPendingRequests();
            res.json({ success: true, requests });
        } catch (error) {
            res.status(500).json({ success: false, error: String(error) });
        }
    });

    return router;
}
