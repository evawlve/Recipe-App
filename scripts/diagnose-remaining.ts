import 'dotenv/config';
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';
import { filterCandidatesByTokens, deriveMustHaveTokens } from '../src/lib/fatsecret/filter-candidates';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';

process.env.LOG_LEVEL = 'error';

const TESTS = [
    '1 cup petite tomatoes',
    '2 cup water - 1 to 2 cups',
    '1.75 cup tomatoes with green chilies',
];

async function diagnose(rawLine: string) {
    const parsed = parseIngredientLine(rawLine);
    const baseName = parsed?.name?.trim() || rawLine.trim();
    const normalized = normalizeIngredientName(baseName).cleaned || baseName;
    const mustHave = deriveMustHaveTokens(normalized);

    console.log(`\n${'='.repeat(70)}`);
    console.log(`  RAW: "${rawLine}"`);
    console.log(`  PARSED NAME: "${baseName}"`);
    console.log(`  NORMALIZED: "${normalized}"`);
    console.log(`  MUST-HAVE TOKENS: [${mustHave.join(', ')}]`);
    console.log(`${'='.repeat(70)}`);

    const client = new FatSecretClient();
    const candidates = await gatherCandidates(rawLine, parsed, normalized, {
        client,
        skipCache: true,
    });

    console.log(`\n  Gathered ${candidates.length} candidates:`);
    for (const c of candidates) {
        const nut = c.nutrition;
        const kcal = nut?.kcal ?? '?';
        console.log(`    [${c.source}] "${c.name}" (score: ${c.score?.toFixed(3) ?? '?'}, ${kcal}kcal)`);
    }

    // Run filter
    const result = filterCandidatesByTokens(candidates, normalized, { debug: true, rawLine });
    console.log(`\n  FILTER: ${result.filtered.length} kept, ${result.removedCount} removed`);

    if (result.filtered.length > 0) {
        console.log(`  Survivors:`);
        for (const c of result.filtered.slice(0, 5)) {
            console.log(`    ✓ "${c.name}" [${c.source}] (score: ${c.score?.toFixed(3)})`);
        }
    } else {
        console.log(`  ❌ ALL CANDIDATES REMOVED`);
        // Show which filter removed each
        for (const c of candidates.slice(0, 5)) {
            const candName = [c.name, c.brandName].filter(Boolean).join(' ').toLowerCase();
            const candTokens = new Set(candName.split(/[^\w]+/).filter(t => t.length > 2));
            const missing = mustHave.filter(t => {
                if (candTokens.has(t)) return false;
                if (new RegExp(`\\b${t}\\b`, 'i').test(candName)) return false;
                return true;
            });
            if (missing.length > 0) {
                console.log(`    "${c.name}" — MISSING_TOKENS: ${missing.join(', ')}`);
            } else {
                console.log(`    "${c.name}" — passed token check, removed by another filter`);
            }
        }
    }
}

async function main() {
    for (const t of TESTS) {
        await diagnose(t);
    }
    process.exit(0);
}

main().catch(console.error);
