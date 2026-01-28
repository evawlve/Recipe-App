import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    console.log('\n=== Checking ValidatedMapping Cache ===\n');

    // Check cinnamon entries
    const cinnamonMappings = await prisma.validatedMapping.findMany({
        where: { normalizedForm: { contains: 'cinnamon' } }
    });
    console.log('CINNAMON ValidatedMappings:');
    cinnamonMappings.forEach(m => {
        console.log(`  "${m.normalizedForm}" → "${m.foodName}" (ID: ${m.foodId})`);
    });

    // Check flax entries
    const flaxMappings = await prisma.validatedMapping.findMany({
        where: { normalizedForm: { contains: 'flax' } }
    });
    console.log('\nFLAX ValidatedMappings:');
    flaxMappings.forEach(m => {
        console.log(`  "${m.normalizedForm}" → "${m.foodName}" (ID: ${m.foodId})`);
    });

    // Check golden entries (to find the bad apple mapping)
    const goldenMappings = await prisma.validatedMapping.findMany({
        where: { normalizedForm: { contains: 'golden' } }
    });
    console.log('\nGOLDEN ValidatedMappings:');
    goldenMappings.forEach(m => {
        console.log(`  "${m.normalizedForm}" → "${m.foodName}" (ID: ${m.foodId})`);
    });

    // Check AiNormalizeCache for flaxseed
    const aiNormCache = await prisma.aiNormalizeCache.findMany({
        where: { rawLine: { contains: 'flax' } }
    });
    console.log('\nAI NORMALIZE CACHE (flax):');
    aiNormCache.forEach(c => {
        console.log(`  raw: "${c.rawLine}"`);
        console.log(`    → normalized: "${c.normalizedName}", canonical: "${c.canonicalBase}"`);
    });

    await prisma.$disconnect();
}

main().catch(console.error);
