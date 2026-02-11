/**
 * Test FDC caching functionality
 */
import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';
import { prisma } from '../src/lib/db';

async function testFdcCaching() {
    console.log('=== Testing FDC Caching ===\n');

    // Check initial FDC count
    const initialCount = await prisma.fdcFoodCache.count();
    console.log('Initial FDC Foods in cache:', initialCount);

    // Search for something that FDC should return but FatSecret might not have exactly
    console.log('\nSearching for "russet potatoes"...');
    const candidates = await gatherCandidates('russet potatoes', null, 'russet potatoes', {
        skipCache: true,
        maxPerSource: 5,
    });

    const fdcCandidates = candidates.filter(c => c.source === 'fdc');
    console.log('FDC candidates returned:', fdcCandidates.length);
    if (fdcCandidates.length > 0) {
        console.log('Top 3 FDC names:');
        fdcCandidates.slice(0, 3).forEach((c, i) => {
            console.log(`  ${i + 1}. ${c.name} (id: ${c.id})`);
        });
    }

    // Wait for async caching to complete
    console.log('\nWaiting for caching to complete...');
    await new Promise(r => setTimeout(r, 3000));

    // Check FDC count after search
    const afterCount = await prisma.fdcFoodCache.count();
    console.log('FDC Foods in cache after search:', afterCount);
    console.log('New foods cached:', afterCount - initialCount);

    if (afterCount > 0) {
        const samples = await prisma.fdcFoodCache.findMany({
            take: 5,
            orderBy: { id: 'desc' }
        });
        console.log('\nRecently cached foods:');
        samples.forEach(s => {
            console.log(`  - ${s.id}: ${s.description} (${s.dataType})`);
        });
    }

    console.log('\n=== Test Complete ===');
}

testFdcCaching()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
