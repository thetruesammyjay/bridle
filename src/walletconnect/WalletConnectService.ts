import { v4 as uuidv4 } from 'uuid';
import { WalletManager } from '../wallet/WalletManager.js';
import {
    Transaction,
    PublicKey,
    VersionedTransaction,
} from '@solana/web3.js';

// ── Types ──

export interface DAppSession {
    id: string;
    agentId: string;
    dappName: string;
    dappUrl: string;
    publicKey: string;
    connectedAt: string;
    status: 'active' | 'disconnected';
}

export interface SignRequest {
    id: string;
    sessionId: string;
    agentId: string;
    dappName: string;
    type: 'sign_transaction' | 'sign_message' | 'sign_and_send';
    payload: string; // base64-encoded transaction or message
    description: string;
    status: 'pending' | 'approved' | 'rejected' | 'expired';
    createdAt: string;
    resolvedAt?: string;
}

export type WCEvent =
    | { type: 'wc:session_created'; data: DAppSession }
    | { type: 'wc:session_disconnected'; data: { sessionId: string; agentId: string } }
    | { type: 'wc:sign_request'; data: SignRequest }
    | { type: 'wc:sign_resolved'; data: { requestId: string; status: string; signature?: string; error?: string } };

/**
 * WalletConnectService manages dApp connections to agent wallets.
 * The Bridle dashboard acts as the approval interface — all external
 * transaction signing requires explicit user approval via the UI.
 */
export class WalletConnectService {
    private sessions: Map<string, DAppSession> = new Map();
    private pendingRequests: Map<string, SignRequest> = new Map();
    private requestResolvers: Map<string, { resolve: (result: { approved: boolean; signature?: string }) => void }> = new Map();
    private walletManager: WalletManager;
    private eventListeners: Array<(event: WCEvent) => void> = [];

    // Sign requests expire after 2 minutes
    private static REQUEST_TIMEOUT_MS = 120_000;

    constructor(walletManager: WalletManager) {
        this.walletManager = walletManager;
    }

    /**
     * Subscribe to WalletConnect events (used by WebSocket handler).
     */
    onEvent(listener: (event: WCEvent) => void): void {
        this.eventListeners.push(listener);
    }

    private emit(event: WCEvent): void {
        for (const listener of this.eventListeners) {
            try {
                listener(event);
            } catch (error) {
                console.error('[WC] Event listener error:', error);
            }
        }
    }

    /**
     * Connect a dApp to a specific agent's wallet.
     * Returns the session info including the agent's public key.
     */
    connectDApp(agentId: string, dappName: string, dappUrl: string): DAppSession | null {
        const publicKey = this.walletManager.getPublicKey(agentId);
        if (!publicKey) {
            console.error(`[WC] No wallet found for agent ${agentId}`);
            return null;
        }

        const session: DAppSession = {
            id: uuidv4(),
            agentId,
            dappName,
            dappUrl,
            publicKey,
            connectedAt: new Date().toISOString(),
            status: 'active',
        };

        this.sessions.set(session.id, session);

        console.log(`[WC] dApp "${dappName}" connected to agent ${agentId} (session: ${session.id})`);
        this.emit({ type: 'wc:session_created', data: session });

        return session;
    }

    /**
     * Disconnect a dApp session.
     */
    disconnectSession(sessionId: string): boolean {
        const session = this.sessions.get(sessionId);
        if (!session) return false;

        session.status = 'disconnected';
        this.sessions.delete(sessionId);

        console.log(`[WC] Session ${sessionId} disconnected`);
        this.emit({
            type: 'wc:session_disconnected',
            data: { sessionId, agentId: session.agentId },
        });

        return true;
    }

    /**
     * Request a transaction signature from the dashboard user.
     * This creates a pending approval request that the dashboard
     * must approve or reject. Returns a Promise that resolves
     * when the user responds.
     */
    async requestSignature(
        sessionId: string,
        type: SignRequest['type'],
        payload: string,
        description: string
    ): Promise<{ approved: boolean; signature?: string; error?: string }> {
        const session = this.sessions.get(sessionId);
        if (!session || session.status !== 'active') {
            return { approved: false, error: 'Session not found or inactive' };
        }

        const request: SignRequest = {
            id: uuidv4(),
            sessionId,
            agentId: session.agentId,
            dappName: session.dappName,
            type,
            payload,
            description,
            status: 'pending',
            createdAt: new Date().toISOString(),
        };

        this.pendingRequests.set(request.id, request);

        console.log(`[WC] Sign request ${request.id} from "${session.dappName}" for agent ${session.agentId}`);
        this.emit({ type: 'wc:sign_request', data: request });

        // Wait for dashboard user to approve/reject
        return new Promise((resolve) => {
            this.requestResolvers.set(request.id, { resolve });

            // Auto-expire after timeout
            setTimeout(() => {
                if (this.pendingRequests.has(request.id)) {
                    this.resolveRequest(request.id, false);
                }
            }, WalletConnectService.REQUEST_TIMEOUT_MS);
        });
    }

    /**
     * Resolve a pending sign request (approve or reject).
     * Called by the API when the dashboard user responds.
     */
    async resolveRequest(requestId: string, approved: boolean): Promise<{ success: boolean; signature?: string; error?: string }> {
        const request = this.pendingRequests.get(requestId);
        if (!request) {
            return { success: false, error: 'Request not found or already resolved' };
        }

        const resolver = this.requestResolvers.get(requestId);

        if (approved) {
            try {
                // Decrypt the agent's key and sign the transaction
                const session = this.sessions.get(request.sessionId);
                if (!session) throw new Error('Session expired');

                const keypair = await this.walletManager.getAgentKeypair(session.agentId);
                const txBuffer = Buffer.from(request.payload, 'base64');
                const transaction = Transaction.from(txBuffer);

                transaction.partialSign(keypair);

                const signedTxBase64 = transaction.serialize().toString('base64');

                request.status = 'approved';
                request.resolvedAt = new Date().toISOString();

                console.log(`[WC] Request ${requestId} APPROVED — signed by agent ${session.agentId}`);
                this.emit({
                    type: 'wc:sign_resolved',
                    data: { requestId, status: 'approved', signature: signedTxBase64 },
                });

                resolver?.resolve({ approved: true, signature: signedTxBase64 });
                return { success: true, signature: signedTxBase64 };
            } catch (error) {
                const errMsg = String(error);
                request.status = 'rejected';
                request.resolvedAt = new Date().toISOString();

                console.error(`[WC] Request ${requestId} signing failed:`, errMsg);
                this.emit({
                    type: 'wc:sign_resolved',
                    data: { requestId, status: 'error', error: errMsg },
                });

                resolver?.resolve({ approved: false });
                return { success: false, error: errMsg };
            }
        } else {
            request.status = 'rejected';
            request.resolvedAt = new Date().toISOString();

            console.log(`[WC] Request ${requestId} REJECTED`);
            this.emit({
                type: 'wc:sign_resolved',
                data: { requestId, status: 'rejected' },
            });

            resolver?.resolve({ approved: false });
            return { success: true };
        }

        this.pendingRequests.delete(requestId);
        this.requestResolvers.delete(requestId);
    }

    /**
     * Get all active sessions.
     */
    getSessions(): DAppSession[] {
        return Array.from(this.sessions.values());
    }

    /**
     * Get sessions for a specific agent.
     */
    getAgentSessions(agentId: string): DAppSession[] {
        return this.getSessions().filter(s => s.agentId === agentId);
    }

    /**
     * Get all pending sign requests.
     */
    getPendingRequests(): SignRequest[] {
        return Array.from(this.pendingRequests.values()).filter(r => r.status === 'pending');
    }
}
