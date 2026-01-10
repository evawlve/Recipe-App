import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const logFile = process.argv[2] || 'logs/mapping-analysis-2025-12-19T05-25-12.json';
const content = fs.readFileSync(logFile, 'utf8');
const lines = content.trim().split('\n').filter(Boolean);

interface Entry {
    rawIngredient: string;
    finalResult: 'success' | 'failed';
    failureReason?: string;
    selectedCandidate?: {
        foodName: string;
        confidence: number;
        selectionReason: string;
    };
}

const entries: Entry[] = [];
for (const line of lines) {
    try {
        entries.push(JSON.parse(line));
    } catch { /* skip malformed */ }
}

const success = entries.filter(e => e.finalResult === 'success');
const failed = entries.filter(e => e.finalResult === 'failed');

console.log('='.repeat(60));
console.log('MAPPING ANALYSIS SUMMARY');
console.log('='.repeat(60));
console.log(`Total Ingredients: ${entries.length}`);
console.log(`✅ Success: ${success.length} (${((success.length / entries.length) * 100).toFixed(1)}%)`);
console.log(`❌ Failed: ${failed.length} (${((failed.length / entries.length) * 100).toFixed(1)}%)`);
console.log();

if (failed.length > 0) {
    console.log('FAILURES:');
    for (const f of failed.slice(0, 10)) {
        console.log(`  - "${f.rawIngredient}": ${f.failureReason || 'unknown'}`);
    }
    if (failed.length > 10) {
        console.log(`  ... and ${failed.length - 10} more`);
    }
}

// Average confidence
const avgConf = success.length > 0
    ? success.reduce((acc, s) => acc + (s.selectedCandidate?.confidence || 0), 0) / success.length
    : 0;
console.log(`\nAverage Confidence: ${avgConf.toFixed(2)}`);
