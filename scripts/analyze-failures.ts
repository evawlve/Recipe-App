#!/usr/bin/env ts-node

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

interface FailureLog {
    timestamp: string;
    level: string;
    message: string;
    context: {
        ingredient: string;
        reason?: string;
        candidates?: number;
        bestScore?: number;
        [key: string]: any;
    };
}

async function main() {
    console.log('\n🔍 FatSecret Mapping Failure Analysis\n');
    console.log('='.repeat(50));

    // Find all failure logs
    const logFiles = await glob('logs/fatsecret-failures-*.jsonl');

    if (logFiles.length === 0) {
        console.log('No failure logs found.');
        return;
    }

    console.log(`Found ${logFiles.length} log files. Analyzing...\n`);

    const failures: FailureLog[] = [];
    const reasonCounts: Record<string, number> = {};
    const failedIngredients: Record<string, number> = {};

    for (const file of logFiles) {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());

        for (const line of lines) {
            try {
                const log = JSON.parse(line) as FailureLog;
                failures.push(log);

                // Count reasons
                const reason = log.context.reason || 'Unknown';
                reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;

                // Count ingredients
                const ingredient = log.context.ingredient;
                if (ingredient) {
                    failedIngredients[ingredient] = (failedIngredients[ingredient] || 0) + 1;
                }
            } catch (e) {
                // Ignore parse errors
            }
        }
    }

    console.log(`Total Failures Logged: ${failures.length}\n`);

    console.log('❌ Top Failure Reasons:');
    Object.entries(reasonCounts)
        .sort(([, a], [, b]) => b - a)
        .forEach(([reason, count]) => {
            console.log(`   - ${reason}: ${count}`);
        });

    console.log('\n🥦 Top Failed Ingredients:');
    Object.entries(failedIngredients)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 20)
        .forEach(([ing, count]) => {
            console.log(`   - "${ing}": ${count} failures`);
        });

    console.log('\n' + '='.repeat(50));
}

main().catch(console.error);
