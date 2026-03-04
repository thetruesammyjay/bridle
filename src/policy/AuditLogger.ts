import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { AuditEntry } from './types.js';

/**
 * AuditLogger writes append-only JSON log files per agent.
 * Each entry is a single JSON line in a .jsonl file.
 */
export class AuditLogger {
    private logsDir: string;

    constructor() {
        this.logsDir = config.paths.logs;
    }

    async initialize(): Promise<void> {
        await fs.mkdir(this.logsDir, { recursive: true });
    }

    /**
     * Append a log entry for an agent.
     */
    async log(entry: AuditEntry): Promise<void> {
        const filePath = path.join(this.logsDir, `${entry.agentId}.jsonl`);
        const line = JSON.stringify(entry) + '\n';
        await fs.appendFile(filePath, line, 'utf-8');
    }

    /**
     * Read recent log entries for an agent.
     */
    async getHistory(agentId: string, limit: number = 50): Promise<AuditEntry[]> {
        const filePath = path.join(this.logsDir, `${agentId}.jsonl`);

        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const lines = content.trim().split('\n').filter(Boolean);
            const entries: AuditEntry[] = lines.map(line => JSON.parse(line));

            // Return most recent entries
            return entries.slice(-limit);
        } catch {
            return [];
        }
    }

    /**
     * Get all log entries across all agents.
     */
    async getAllHistory(limit: number = 100): Promise<AuditEntry[]> {
        try {
            const files = await fs.readdir(this.logsDir);
            const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

            const allEntries: AuditEntry[] = [];
            for (const file of jsonlFiles) {
                const filePath = path.join(this.logsDir, file);
                const content = await fs.readFile(filePath, 'utf-8');
                const lines = content.trim().split('\n').filter(Boolean);
                for (const line of lines) {
                    try {
                        allEntries.push(JSON.parse(line));
                    } catch {
                        // Skip malformed lines
                    }
                }
            }

            // Sort by timestamp and return most recent
            allEntries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
            return allEntries.slice(-limit);
        } catch {
            return [];
        }
    }
}
