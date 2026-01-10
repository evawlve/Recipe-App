// Debug milk lowfat filtering with detailed logging
import 'dotenv/config';
process.env.LOG_LEVEL = 'debug';

import { parseIngredientLine } from '../lib/parse/ingredient-line';
import { normalizeIngredientName } from '../lib/fatsecret/normalization-rules';
import { isCategoryMismatch, filterCandidatesByTokens } from '../lib/fatsecret/filter-candidates';

// Fake candidate to match what API might return
const fakeCandidates = [
    { name: 'Milk (Nonfat)', brandName: null, source: 'fatsecret', confidence: 0.9 },
    { name: 'Low Fat Milk', brandName: null, source: 'fatsecret', confidence: 0.85 },
    { name: '2% Fat Milk', brandName: null, source: 'fatsecret', confidence: 0.8 },
];

const rawLine = '1.5 cup milk lowfat';
const parsed = parseIngredientLine(rawLine);
const normalized = normalizeIngredientName(parsed?.name || rawLine);

console.log('Query:', parsed?.name);
console.log('Normalized:', normalized.cleaned);

console.log('\n=== Testing isCategoryMismatch directly ===');
for (const c of fakeCandidates) {
    const result = isCategoryMismatch(normalized.cleaned, c.name, c.brandName);
    console.log(`  "${normalized.cleaned}" vs "${c.name}": ${result ? 'MISMATCH (exclude)' : 'OK (keep)'}`);
}

console.log('\n=== Testing via filterCandidatesByTokens ===');
// Cast as UnifiedCandidate format
const unifiedCandidates = fakeCandidates.map((c, i) => ({
    ...c,
    searchRank: i,
    confidence: c.confidence,
    nutrition: null,
}));

const filtered = filterCandidatesByTokens(unifiedCandidates as any, parsed?.name || rawLine, { debug: true, rawLine });
console.log('\nFiltered candidates:');
for (const c of filtered.passed) {
    console.log(`  ✅ ${c.name}`);
}
console.log('\nRejected candidates:');
for (const r of filtered.rejected) {
    console.log(`  ❌ ${r.candidate.name}: ${r.reason}`);
}
