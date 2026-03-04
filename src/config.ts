import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const config = {
    solana: {
        rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
        commitment: 'confirmed' as const,
    },
    gemini: {
        apiKey: process.env.GEMINI_API_KEY || '',
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
    },
    encryption: {
        password: process.env.ENCRYPTION_PASSWORD || 'bridle-default-dev-password',
        algorithm: 'aes-256-gcm' as const,
        keyLength: 32,
        ivLength: 16,
        saltLength: 32,
        tagLength: 16,
        iterations: 100000,
    },
    server: {
        port: parseInt(process.env.PORT || '3000', 10),
    },
    agent: {
        intervalMs: parseInt(process.env.AGENT_INTERVAL_MS || '30000', 10),
        defaultAirdropSOL: 2,
    },
    paths: {
        root: path.resolve(__dirname, '..'),
        data: path.resolve(__dirname, '..', 'data'),
        keys: path.resolve(__dirname, '..', 'data', 'keys'),
        logs: path.resolve(__dirname, '..', 'data', 'logs'),
        dashboard: path.resolve(__dirname, '..', 'dashboard'),
    },
    telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN || '',
        chatId: process.env.TELEGRAM_CHAT_ID || '',
    },
} as const;

export function isGeminiConfigured(): boolean {
    return config.gemini.apiKey.length > 0 && config.gemini.apiKey !== 'your_gemini_api_key_here';
}
