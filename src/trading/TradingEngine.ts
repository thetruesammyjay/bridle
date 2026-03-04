import {
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
    sendAndConfirmTransaction,
} from '@solana/web3.js';
import { WalletManager } from '../wallet/WalletManager.js';
import { PolicyGuard } from '../policy/PolicyGuard.js';
import { AuditLogger } from '../policy/AuditLogger.js';
import { JupiterClient } from './JupiterClient.js';
import { TradeResult } from './types.js';
import { TradeDecision } from '../ai/types.js';

/**
 * TradingEngine executes trades by:
 * 1. Validating against PolicyGuard
 * 2. Getting a quote from JupiterClient
 * 3. Building and signing the transaction
 * 4. Sending and confirming on-chain
 * 5. Logging results to AuditLogger
 */
export class TradingEngine {
    private walletManager: WalletManager;
    private policyGuard: PolicyGuard;
    private auditLogger: AuditLogger;
    private jupiterClient: JupiterClient;

    constructor(
        walletManager: WalletManager,
        policyGuard: PolicyGuard,
        auditLogger: AuditLogger
    ) {
        this.walletManager = walletManager;
        this.policyGuard = policyGuard;
        this.auditLogger = auditLogger;
        this.jupiterClient = new JupiterClient(true); // Use simulation on devnet
    }

    /**
     * Execute a trade based on an AI decision.
     */
    async executeTrade(agentId: string, decision: TradeDecision): Promise<TradeResult> {
        const timestamp = new Date().toISOString();

        // Step 1: Validate against policy
        const policyCheck = this.policyGuard.validateTrade(agentId, decision);
        if (!policyCheck.allowed) {
            await this.auditLogger.log({
                timestamp,
                agentId,
                event: 'POLICY_VIOLATION',
                data: { decision, reason: policyCheck.reason },
            });

            return {
                signature: '',
                action: decision.action,
                inputToken: decision.inputToken,
                outputToken: decision.outputToken,
                inputAmount: decision.amountSOL,
                outputAmount: 0,
                success: false,
                timestamp,
                error: `Policy violation: ${policyCheck.reason}`,
            };
        }

        try {
            // Step 2: Get a quote
            const inputMint = JupiterClient.getMint(decision.inputToken);
            const outputMint = JupiterClient.getMint(decision.outputToken);
            const amountLamports = Math.floor(decision.amountSOL * LAMPORTS_PER_SOL);

            const quote = await this.jupiterClient.getQuote(inputMint, outputMint, amountLamports);

            // Step 3: Build and execute a SOL transfer to simulate the swap
            // On devnet, we do a real SOL transfer to demonstrate autonomous signing
            const keypair = await this.walletManager.getAgentKeypair(agentId);
            const connection = this.walletManager.getConnection();

            // Create a self-transfer as a proof-of-execution marker on-chain
            // (Real swaps would use Jupiter's swap endpoint)
            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: keypair.publicKey,
                    toPubkey: keypair.publicKey, // Self-transfer as marker
                    lamports: 100, // Minimal amount as proof
                })
            );

            // Step 4: Sign and send
            const signature = await sendAndConfirmTransaction(
                connection,
                transaction,
                [keypair]
            );

            // Record spending for daily limit tracking
            this.policyGuard.recordSpending(agentId, decision.amountSOL);

            const result: TradeResult = {
                signature,
                action: decision.action,
                inputToken: decision.inputToken,
                outputToken: decision.outputToken,
                inputAmount: decision.amountSOL,
                outputAmount: quote.outAmount / LAMPORTS_PER_SOL,
                success: true,
                timestamp,
            };

            // Step 5: Log success
            await this.auditLogger.log({
                timestamp,
                agentId,
                event: 'TRADE_EXECUTED',
                data: {
                    decision,
                    result,
                    quote: {
                        inAmount: quote.inAmount,
                        outAmount: quote.outAmount,
                        priceImpact: quote.priceImpactPercent,
                        route: quote.route,
                        simulated: this.jupiterClient.isSimulating(),
                    },
                },
            });

            return result;
        } catch (error) {
            const result: TradeResult = {
                signature: '',
                action: decision.action,
                inputToken: decision.inputToken,
                outputToken: decision.outputToken,
                inputAmount: decision.amountSOL,
                outputAmount: 0,
                success: false,
                timestamp,
                error: String(error),
            };

            await this.auditLogger.log({
                timestamp,
                agentId,
                event: 'TRADE_FAILED',
                data: { decision, error: String(error) },
            });

            return result;
        }
    }
}
