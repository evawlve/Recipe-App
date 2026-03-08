import { gatherCandidates, FatSecretClient } from '../src/lib/fatsecret/gather-candidates';
import { filterCandidatesByTokens } from '../src/lib/fatsecret/filter-candidates';
import { prisma } from '../src/lib/db';

async function main() {
    console.log('=== Debugging why FDC Strawberries is filtered ===\n');

    const client = new FatSecretClient();

    // Simulate the gather step
    const candidates = await gatherCandidates({
        normalizedName: 'strawberry halves',
        rawLine: '2 cup stberry halves',
        parsed: null,
        client,
        synonyms: ['strawberry', 'strawberries', 'strawberry halves'],
    });

    console.log(`Total candidates gathered: ${candidates.length}`);
    console.log('\nFDC candidates:');
    candidates.filter(c => c.source === 'fdc').forEach(c => {
        console.log(`  ${c.name} | score: ${c.score.toFixed(3)} | id: ${c.id}`);
    });

    // Run filter
    const filterResult = filterCandidatesByTokens(candidates, 'strawberry halves', {
        debug: true,
        rawLine: '2 cup stberry halves',
    });

    console.log('\n=== After Filtering ===');
    console.log(`Kept: ${filterResult.filtered.length} | Removed: ${filterResult.removedCount}`);

    console.log('\nKept candidates:');
    filterResult.filtered.forEach((c, i) => {
        console.log(`  ${i + 1}. [${c.source}] ${c.name} | score: ${c.score.toFixed(3)}`);
    });

    // Check if "Strawberries, raw" or similar is in the kept list
    const strawberryRaw = filterResult.filtered.find(c =>
        c.name.toLowerCase().includes('strawberr') &&
        (c.name.toLowerCase().includes('raw') || c.source === 'fdc')
    );

    if (strawberryRaw) {
        console.log('\n✅ Raw strawberries IS in filtered list:', strawberryRaw.name);
    } else {
        console.log('\n❌ Raw strawberries was FILTERED OUT');

        // Find the original candidate
        const originalStrawberry = candidates.find(c =>
            c.name.toLowerCase().includes('strawberr') &&
            c.name.toLowerCase().includes('raw') &&
            c.source === 'fdc'
        );

        if (originalStrawberry) {
            console.log('Original candidate:', originalStrawberry.name);
            console.log('Source:', originalStrawberry.source);
            console.log('Nutrition:', JSON.stringify(originalStrawberry.nutrition, null, 2));
        }
    }

    await prisma.$disconnect();
}

main().catch(console.error);
