import fs from 'fs';
import path from 'path';

const rulesPath = path.resolve(process.cwd(), 'data/fatsecret/normalization-rules.json');
const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Check all synonym_rewrites for "flour" related rules
console.log('Rules containing "flour":');
for (const rule of rules.synonym_rewrites) {
    if (rule.from.includes('flour') || rule.to.includes('flour')) {
        console.log(`  "${rule.from}" -> "${rule.to}"`);
    }
}

// Test the specific rule
const input = 'all purpose flour';
console.log(`\nInput: "${input}"`);

for (const rule of rules.synonym_rewrites) {
    const pattern = `\\b${escapeRegex(rule.from)}\\b`;
    const re = new RegExp(pattern, 'i');
    if (re.test(input)) {
        console.log(`Match found: "${rule.from}" -> "${rule.to}"`);
        const result = input.replace(re, rule.to);
        console.log(`Result: "${result}"`);
    }
}
