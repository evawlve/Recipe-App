import fs from 'fs';
import path from 'path';

const rulesPath = path.resolve(process.cwd(), 'data/fatsecret/normalization-rules.json');
const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Find the flour rule
const flourRule = rules.synonym_rewrites.find((r: any) => r.from === 'all purpose flour');
console.log('Flour rule in JSON:', JSON.stringify(flourRule));

// Test it manually
const input = 'all purpose flour';
const escaped = escapeRegex(flourRule.from);
const pattern = `\\b${escaped}\\b`;
const re = new RegExp(pattern, 'i');
console.log('Pattern:', pattern);
console.log('Test result:', re.test(input));
console.log('Replacement:', input.replace(re, flourRule.to));
