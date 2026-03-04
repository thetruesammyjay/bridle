import { PublicKey } from '@solana/web3.js';

// ── Wallet Types ──

export interface WalletInfo {
    agentId: string;
    publicKey: string;
    createdAt: string;
}

export interface TransferResult {
    signature: string;
    amount: number;
    to: string;
    success: boolean;
    error?: string;
}

export interface EncryptedKeyData {
    iv: string;       // hex
    salt: string;     // hex
    authTag: string;  // hex
    encrypted: string; // hex
}
