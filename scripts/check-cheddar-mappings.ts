import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function checkMappings() {
    const results = await prisma.validatedMapping.findMany({
        where: {
            normalizedForm: {
                contains: 'cheddar',
                mode: 'insensitive',
            },
        },
        take: 10,
        select: {
            rawIngredient: true,
            normalizedForm: true,
            mappedFoodName: true,
            aiConfidence: true,
        },
        orderBy: { usedCount: 'desc' },
    });

    console.log('ValidatedMappings containing "cheddar":');
    results.forEach(r => {
        console.log(`  "${r.rawIngredient}" → "${r.mappedFoodName}" (conf: ${r.aiConfidence})`);
        console.log(`    normalizedForm: ${r.normalizedForm}`);
    });
}

checkMappings()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
