import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function check() {
    // Check for any mappings containing 'pancake' in foodName
    const pancake = await prisma.validatedMapping.findMany({
        where: {
            foodName: { contains: 'Pancake', mode: 'insensitive' }
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
            rawIngredient: true,
            foodName: true,
            aiConfidence: true,
        }
    });

    console.log('PANCAKE MAPPINGS:');
    if (pancake.length === 0) {
        console.log('  None found');
    } else {
        for (const m of pancake) {
            console.log(`  "${m.rawIngredient}" -> ${m.foodName} (${m.aiConfidence})`);
        }
    }

    // Also check AiNormalizeCache for SIMPLIFY entries
    const simplified = await prisma.aiNormalizeCache.findMany({
        where: { rawLine: { startsWith: 'SIMPLIFY:' } },
        take: 5,
        select: { rawLine: true, normalizedName: true }
    });

    console.log('\nAI SIMPLIFY CACHE:');
    if (simplified.length === 0) {
        console.log('  None found');
    } else {
        for (const s of simplified) {
            console.log(`  ${s.rawLine} -> ${s.normalizedName}`);
        }
    }
}

check().finally(() => prisma.$disconnect());
