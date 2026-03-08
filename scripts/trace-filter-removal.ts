import 'dotenv/config';
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';
import { filterCandidatesByTokens, deriveMustHaveTokens } from '../src/lib/fatsecret/filter-candidates';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';

process.env.LOG_LEVEL = 'error';

const TESTS = [
    '0.5 cup vegetable oil',
    '1 tsp cayenne pepper',
    '1 tsp dijon mustard',
    '2 oz salted butter',
    '1 cup petite tomatoes',
    '0.5 cup no calorie sweetener',
    '1 tbsp dark sesame oil',
];

async function main() {
    const client = new FatSecretClient();

    for (const rawLine of TESTS) {
        const parsed = parseIngredientLine(rawLine);
        const baseName = parsed?.name?.trim() || rawLine.trim();
        const normalized = normalizeIngredientName(baseName).cleaned || baseName;
        const mustHave = deriveMustHaveTokens(normalized);

        console.log(`\n${'='.repeat(70)}`);
        console.log(`  "${rawLine}" → normalized: "${normalized}" → mustHave: [${mustHave}]`);
        console.log(`${'='.repeat(70)}`);

        const candidates = await gatherCandidates(rawLine, parsed, normalized, {
            client,
            skipCache: true,
        });

        console.log(`  Gathered ${candidates.length} candidates\n`);

        // Run filter with debug ON
        const result = filterCandidatesByTokens(candidates, normalized, {
            rawLine,
            debug: true, // This will trigger all the logger.info calls
        });

        console.log(`\n  FILTER RESULT: ${result.filtered.length} kept, ${result.removedCount} removed`);

        if (result.filtered.length > 0) {
            console.log(`  Survivors:`);
            for (const c of result.filtered.slice(0, 3)) {
                console.log(`    ✓ "${c.name}" [${c.source}]`);
            }
        }
    }

    process.exit(0);
}

main().catch(console.error);
