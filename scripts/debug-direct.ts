/**
 * Direct test bypassing the module cache
 */

import fs from 'fs';
import path from 'path';

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collapseSpaces(value: string): string {
    return value.replace(/\s+/g, ' ').replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
}

// Read rules directly
const rulesPath = path.resolve(process.cwd(), 'data/fatsecret/normalization-rules.json');
const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));

console.log('Rule count:', rules.synonym_rewrites.length);
console.log('Has flour rule:', !!rules.synonym_rewrites.find((r: any) => r.from === 'all purpose flour'));

function normalizeIngredientNameDirect(raw: string): string {
    let working = raw;

    // PRE-PROCESSING
    working = working.replace(/\b\d+%\s*/g, '');
    working = working.replace(/\s+/g, ' ').trim();
    working = working.replace(/\b(\w+\s+\w+)\s+\1\b/gi, '$1');
    working = working.replace(/\b(\w+)\s+\1\b/gi, '$1');

    // SYNONYM REWRITES
    for (const rewrite of rules.synonym_rewrites) {
        const re = new RegExp(`\\b${escapeRegex(rewrite.from)}\\b`, 'i');
        if (re.test(working)) {
            console.log(`  MATCH: "${rewrite.from}" -> "${rewrite.to}"`);
            working = working.replace(re, rewrite.to);
        }
    }

    return collapseSpaces(working);
}

console.log('\n=== Testing ===');
console.log('all purpose flour:', normalizeIngredientNameDirect('all purpose flour'));
console.log('liquid aminos:', normalizeIngredientNameDirect('liquid aminos'));
