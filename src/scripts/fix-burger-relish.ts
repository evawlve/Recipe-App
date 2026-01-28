/**
 * Delete bad burger relish cache entries
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log("\n=== FINDING AND DELETING BAD BURGER RELISH ENTRIES ===\n");

    // Find ALL entries that could be burger relish related
    const allRelated = await prisma.validatedMapping.findMany({
        where: {
            OR: [
                { normalizedForm: { contains: 'burger relish', mode: 'insensitive' } },
                { rawIngredient: { contains: 'burger relish', mode: 'insensitive' } },
            ]
        }
    });

    console.log(`Found ${allRelated.length} burger relish related entries:\n`);
    for (const m of allRelated) {
        console.log(`  ID: ${m.id}`);
        console.log(`  Raw: "${m.rawIngredient}"`);
        console.log(`  Normalized: "${m.normalizedForm}"`);
        console.log(`  Food: "${m.foodName}" (${m.foodId})`);
        console.log(`  Confidence: ${m.aiConfidence}`);

        // Delete if it maps to Black Bean Burger
        if (m.foodName.includes('Black Bean Burger') || m.foodName.includes('Black')) {
            console.log(`  ❌ DELETING - Bad mapping to Black Bean Burger`);
            await prisma.validatedMapping.delete({ where: { id: m.id } });
        }
        console.log('');
    }

    // Also check AiNormalizeCache 
    const aiCache = await prisma.aiNormalizeCache.findMany({
        where: {
            rawLine: { contains: 'burger relish', mode: 'insensitive' }
        }
    });

    console.log(`\nAiNormalizeCache entries (${aiCache.length}):\n`);
    for (const c of aiCache) {
        console.log(`  "${c.rawLine}" → "${c.normalizedName}"`);
    }

    await prisma.$disconnect();
    console.log("\n✅ Done\n");
}

main().catch(console.error);
