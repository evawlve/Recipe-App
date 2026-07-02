import * as fs from 'fs';
import * as path from 'path';

const LOG_DIR = path.join(process.cwd(), 'logs');

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    } catch (e) {
        console.error('Failed to create logs directory', e);
    }
}

function getLogPath(type: 'failures' | 'ai-usage' | 'low-confidence' | 'debug'): string {
    const date = new Date().toISOString().split('T')[0];
    return path.join(LOG_DIR, `fatsecret-${type}-${date}.jsonl`);
}

function appendLog(type: 'failures' | 'ai-usage' | 'low-confidence' | 'debug', data: Record<string, any>) {
    const logPath = getLogPath(type);
    const entry = {
        ts: new Date().toISOString(),
        ...data,
    };
    try {
        fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
    } catch (e) {
        console.error(`Failed to write to ${type} log`, e);
    }
}

export const debugLogger = {
    logFailure: (ingredient: string, reason: string, context: Record<string, any> = {}) => {
        appendLog('failures', { ingredient, reason, ...context });
    },
    logAiUsage: (type: 'normalize' | 'backfill' | 'retry', details: Record<string, any>) => {
        appendLog('ai-usage', { type, ...details });
    },
    logLowConfidence: (ingredient: string, result: any, confidence: number) => {
        appendLog('low-confidence', { ingredient, result, confidence });
    },
    logDebug: (message: string, context: Record<string, any> = {}) => {
        appendLog('debug', { message, ...context });
    }
};
