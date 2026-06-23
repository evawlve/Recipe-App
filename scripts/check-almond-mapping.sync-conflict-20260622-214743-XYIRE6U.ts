import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    const mappings = await prisma.validatedMapping.findMany({
        where: { rawIngredient: { contains: 'almond milk', mode: 'insensitive' } },
        select: {
            rawIngredient: true,
            foodId: true,
            foodName: true,
            aiConfidence: true,
            createdAt: true,
            updatedAt: true
        }
    });

    console.log('=== VALIDATED MAPPINGS FOR ALMOND MILK ===');
    for (const m of mappings) {
        console.log(`\nRaw: ${m.rawIngredient}`);
        console.log(`  Food: ${m.foodName} (${m.foodId})`);
        console.log(`  Confidence: ${m.aiConfidence}`);
        console.log(`  Created: ${m.createdAt}`);
    }
}

main().finally(() => prisma.$disconnect());
