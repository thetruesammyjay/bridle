import { config } from '../config.js';
import { AgentEvent } from '../agent/types.js';

export class TelegramNotifier {
    private readonly botToken: string;
    private readonly chatId: string;
    private readonly enabled: boolean;
    private readonly apiUrl: string;

    constructor() {
        this.botToken = config.telegram.botToken;
        this.chatId = config.telegram.chatId;
        this.enabled = this.botToken.length > 0 && this.chatId.length > 0;
        this.apiUrl = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    async sendAlert(message: string): Promise<boolean> {
        if (!this.enabled) return false;

        try {
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: this.chatId,
                    text: message,
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                }),
            });

            if (!response.ok) {
                const error = await response.text();
                console.error(`[TelegramNotifier] Failed to send alert: ${error}`);
                return false;
            }

            return true;
        } catch (error) {
            console.error('[TelegramNotifier] Error sending alert:', error);
            return false;
        }
    }

    async handleAgentEvent(event: AgentEvent): Promise<void> {
        if (!this.enabled) return;

        let message = '';
        const agentName = event.data.name || event.agentId.substring(0, 8);

        switch (event.type) {
            case 'agent:spawned':
                message = `🤖 <b>Agent Spawned</b>\n` +
                    `👤 Name: ${agentName}\n` +
                    `🛡 Risk Profile: ${event.data.riskProfile}\n` +
                    `🔑 Public Key: <code>${event.data.publicKey}</code>`;
                break;

            case 'agent:trade':
                const result = event.data.result as any;
                if (result.success) {
                    message = `✅ <b>Trade Executed</b> | ${agentName}\n` +
                        `🔄 Swap: ${result.inputAmount} ${result.inputToken} ➔ ${result.outputAmount} ${result.outputToken}\n` +
                        `🔗 <a href="https://explorer.solana.com/tx/${result.signature}?cluster=devnet">View Transaction</a>\n` +
                        `💰 New Balance: ${Number(event.data.newBalance).toFixed(4)} SOL`;
                }
                break;

            case 'agent:error':
                message = `⚠️ <b>Agent Error</b> | ${agentName}\n` +
                    `❌ ${event.data.error}\n` +
                    `🔄 Cycle: ${event.data.cycle} | Wait: ${event.data.consecutiveErrors}x backoff`;
                break;

            case 'agent:balance':
                // Only alert on significant balance changes (like airdrops)
                if (event.data.reason === 'airdrop') {
                    message = `💧 <b>Airdrop Received</b> | ${agentName}\n` +
                        `💰 New Balance: ${Number(event.data.balance).toFixed(4)} SOL`;
                }
                break;
        }

        if (message) {
            await this.sendAlert(message);
        }
    }
}
