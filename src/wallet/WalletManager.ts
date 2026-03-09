import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
    sendAndConfirmTransaction,
} from '@solana/web3.js';
import { config } from '../config.js';
import { KeyVault } from './KeyVault.js';
import { WalletInfo, TransferResult } from './types.js';

/**
 * WalletManager handles wallet lifecycle for agents:
 * keypair generation, balance queries, SOL transfers, and devnet airdrops.
 * Secret keys are always stored encrypted via KeyVault.
 */
export class WalletManager {
    private connection: Connection;
    private keyVault: KeyVault;
    private wallets: Map<string, WalletInfo> = new Map();

    constructor() {
        this.connection = new Connection(config.solana.rpcUrl, config.solana.commitment);
        this.keyVault = new KeyVault();
    }

    async initialize(): Promise<void> {
        await this.keyVault.initialize();
    }

    /**
     * Create a new wallet for an agent. Generates keypair, encrypts and stores it.
     */
    async createWallet(agentId: string): Promise<WalletInfo> {
        const keypair = Keypair.generate();

        // Store encrypted secret key
        await this.keyVault.storeKey(agentId, keypair.secretKey);

        const walletInfo: WalletInfo = {
            agentId,
            publicKey: keypair.publicKey.toBase58(),
            createdAt: new Date().toISOString(),
        };

        this.wallets.set(agentId, walletInfo);
        return walletInfo;
    }

    /**
     * Get the public key for an agent's wallet.
     */
    getPublicKey(agentId: string): string | undefined {
        return this.wallets.get(agentId)?.publicKey;
    }

    /**
     * Reconstruct keypair from encrypted storage (used internally for signing).
     */
    private async getKeypair(agentId: string): Promise<Keypair> {
        const secretKey = await this.keyVault.retrieveKey(agentId);
        return Keypair.fromSecretKey(secretKey);
    }

    /**
     * Get SOL balance for an agent's wallet.
     */
    async getBalance(agentId: string): Promise<number> {
        const publicKey = this.getPublicKey(agentId);
        if (!publicKey) throw new Error(`No wallet found for agent ${agentId}`);

        const balance = await this.connection.getBalance(new PublicKey(publicKey));
        return balance / LAMPORTS_PER_SOL;
    }

    /**
     * Transfer SOL from an agent to a recipient.
     */
    async transferSOL(agentId: string, to: string, amountSOL: number): Promise<TransferResult> {
        try {
            const keypair = await this.getKeypair(agentId);
            const toPublicKey = new PublicKey(to);
            const lamports = Math.floor(amountSOL * LAMPORTS_PER_SOL);

            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: keypair.publicKey,
                    toPubkey: toPublicKey,
                    lamports,
                })
            );

            const signature = await sendAndConfirmTransaction(
                this.connection,
                transaction,
                [keypair]
            );

            return {
                signature,
                amount: amountSOL,
                to,
                success: true,
            };
        } catch (error) {
            return {
                signature: '',
                amount: amountSOL,
                to,
                success: false,
                error: String(error),
            };
        }
    }

    async requestAirdrop(agentId: string, amountSOL: number = 1): Promise<string> {
        const publicKey = this.getPublicKey(agentId);
        if (!publicKey) throw new Error(`No wallet found for agent ${agentId}`);

        try {
            const signature = await this.connection.requestAirdrop(
                new PublicKey(publicKey),
                amountSOL * LAMPORTS_PER_SOL
            );

            // Wait for confirmation
            const latestBlockhash = await this.connection.getLatestBlockhash();
            await this.connection.confirmTransaction({
                signature,
                ...latestBlockhash,
            });

            return signature;
        } catch (error) {
            const errStr = String(error);
            // Public Devnet RPCs often just fail with internal errors or rate limits for airdrops
            throw new Error(
                `Devnet airdrop failed or rate limited. Please visit https://faucet.solana.com to manually send SOL to: ${publicKey}`
            );
        }
    }

    /**
     * Delete an agent's wallet and its encrypted key.
     */
    async deleteWallet(agentId: string): Promise<void> {
        await this.keyVault.deleteKey(agentId);
        this.wallets.delete(agentId);
    }

    /**
     * Get the Connection object (for advanced queries).
     */
    getConnection(): Connection {
        return this.connection;
    }

    /**
     * Sign a raw transaction buffer with an agent's keypair.
     */
    async signTransaction(agentId: string, transaction: Transaction): Promise<Transaction> {
        const keypair = await this.getKeypair(agentId);
        transaction.partialSign(keypair);
        return transaction;
    }

    /**
     * Get the agent's Keypair for direct tx building (used by TradingEngine).
     */
    async getAgentKeypair(agentId: string): Promise<Keypair> {
        return this.getKeypair(agentId);
    }
}
