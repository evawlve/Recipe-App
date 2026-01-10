// Test the fixes for ice mapping and serving selection
import { PrismaClient } from '@prisma/client';
import { parseIngredientLine } from '../lib/parse/ingredient-line';
import { normalizeIngredientName } from '../lib/fatsecret/normalization-rules';

// Suppress logs
process.env.LOG_LEVEL = 'error';

const prisma = new PrismaClient({ log: [] });

async function main() {
    // Import dynamically to ensure LOG_LEVEL is set first
    const { gatherCandidates } = await import('../lib/fatsecret/gather-candidates');
    const { filterCandidatesByTokens } = await import('../lib/fatsecret/filter-candidates');

    console.log('=== TEST: crushed ice filtering ===\n');

    const rawLine = '1 cup crushed ice';
    const parsed = parseIngredientLine(rawLine);
    const normalizedName = normalizeIngredientName(parsed?.name || 'crushed ice').cleaned;

    // Gather candidates
    const candidates = await gatherCandidates(rawLine, parsed, normalizedName, {
        skipFdc: true,  // Skip FDC to focus on FatSecret
        maxPerSource: 10,
    });

    console.log(`Gathered ${candidates.length} candidates`);

    // Filter candidates
    const filterResult = filterCandidatesByTokens(candidates, normalizedName, {
        debug: true,
        rawLine
    });

    console.log(`After filtering: ${filterResult.filtered.length} candidates`);
    console.log(`Removed: ${filterResult.removedCount}`);

    // Check if Rice is in the results
    const riceInFiltered = filterResult.filtered.some(c =>
        c.name.toLowerCase().includes('rice')
    );
    console.log(`\nRice in filtered results: ${riceInFiltered ? 'YES (BUG!)' : 'NO (CORRECT!)'}`);

    // Show top candidates after filtering
    console.log('\nTop filtered candidates:');
    for (const c of filterResult.filtered.slice(0, 5)) {
        console.log(`  [${c.source}] ${c.name} (${c.brandName || 'Generic'})`);
    }

    await prisma.$disconnect();
}

main().catch(console.error);
