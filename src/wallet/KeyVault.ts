import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { EncryptedKeyData } from './types.js';

/**
 * KeyVault provides AES-256-GCM encrypted storage for Solana keypair secret keys.
 * Each agent's key is stored as an encrypted file with a unique salt and IV.
 */
export class KeyVault {
    private keysDir: string;
    private password: string;

    constructor() {
        this.keysDir = config.paths.keys;
        this.password = config.encryption.password;
    }

    async initialize(): Promise<void> {
        await fs.mkdir(this.keysDir, { recursive: true });
    }

    /**
     * Encrypt and store a secret key for an agent.
     */
    async storeKey(agentId: string, secretKey: Uint8Array): Promise<void> {
        const salt = crypto.randomBytes(config.encryption.saltLength);
        const iv = crypto.randomBytes(config.encryption.ivLength);

        // Derive encryption key from password using PBKDF2
        const derivedKey = crypto.pbkdf2Sync(
            this.password,
            salt,
            config.encryption.iterations,
            config.encryption.keyLength,
            'sha512'
        );

        // Encrypt with AES-256-GCM
        const cipher = crypto.createCipheriv(config.encryption.algorithm, derivedKey, iv);
        const encrypted = Buffer.concat([
            cipher.update(Buffer.from(secretKey)),
            cipher.final(),
        ]);
        const authTag = cipher.getAuthTag();

        const keyData: EncryptedKeyData = {
            iv: iv.toString('hex'),
            salt: salt.toString('hex'),
            authTag: authTag.toString('hex'),
            encrypted: encrypted.toString('hex'),
        };

        const filePath = path.join(this.keysDir, `${agentId}.enc`);
        await fs.writeFile(filePath, JSON.stringify(keyData, null, 2), 'utf-8');
    }

    /**
     * Decrypt and retrieve a secret key for an agent.
     */
    async retrieveKey(agentId: string): Promise<Uint8Array> {
        const filePath = path.join(this.keysDir, `${agentId}.enc`);

        try {
            const raw = await fs.readFile(filePath, 'utf-8');
            const keyData: EncryptedKeyData = JSON.parse(raw);

            const salt = Buffer.from(keyData.salt, 'hex');
            const iv = Buffer.from(keyData.iv, 'hex');
            const authTag = Buffer.from(keyData.authTag, 'hex');
            const encrypted = Buffer.from(keyData.encrypted, 'hex');

            // Derive the same key from password
            const derivedKey = crypto.pbkdf2Sync(
                this.password,
                salt,
                config.encryption.iterations,
                config.encryption.keyLength,
                'sha512'
            );

            // Decrypt
            const decipher = crypto.createDecipheriv(config.encryption.algorithm, derivedKey, iv);
            decipher.setAuthTag(authTag);
            const decrypted = Buffer.concat([
                decipher.update(encrypted),
                decipher.final(),
            ]);

            return new Uint8Array(decrypted);
        } catch (error) {
            throw new Error(`Failed to retrieve key for agent ${agentId}: ${error}`);
        }
    }

    /**
     * Delete an agent's encrypted key file.
     */
    async deleteKey(agentId: string): Promise<void> {
        const filePath = path.join(this.keysDir, `${agentId}.enc`);
        try {
            // Overwrite with random data before deleting (secure deletion)
            const stat = await fs.stat(filePath);
            await fs.writeFile(filePath, crypto.randomBytes(stat.size));
            await fs.unlink(filePath);
        } catch {
            // File may not exist, ignore
        }
    }

    /**
     * Check if a key exists for an agent.
     */
    async hasKey(agentId: string): Promise<boolean> {
        const filePath = path.join(this.keysDir, `${agentId}.enc`);
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }
}
