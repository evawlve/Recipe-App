import { PrismaClient } from '@prisma/client';

async function investigateChiliPeppers() {
    const prisma = new PrismaClient();

    try {
        // Check AiNormalizeCache for anything with 'chilli' or 'chili'
        console.log('=== AiNormalizeCache entries for chilli/chili ===\n');
        const aiCache = await prisma.aiNormalizeCache.findMany({
            where: {
                OR: [
                    { rawLine: { contains: 'chilli', mode: 'insensitive' } },
                    { rawLine: { contains: 'chili', mode: 'insensitive' } },
                    { normalizedName: { contains: 'chilli', mode: 'insensitive' } },
                    { normalizedName: { contains: 'chili', mode: 'insensitive' } }
                ]
            }
        });

        if (aiCache.length === 0) {
            console.log('No entries found in AiNormalizeCache');
        }

        for (const entry of aiCache) {
            console.log('Raw:', entry.rawLine);
            console.log('  normalizedName:', entry.normalizedName);
            console.log('  canonicalBase:', entry.canonicalBase);
            console.log('');
        }

        // Check ValidatedMapping for anything with chilli/chili
        console.log('\n=== ValidatedMapping entries for chilli/chili ===\n');
        const mappings = await prisma.validatedMapping.findMany({
            where: {
                OR: [
                    { normalizedForm: { contains: 'chilli', mode: 'insensitive' } },
                    { normalizedForm: { contains: 'chili', mode: 'insensitive' } },
                    { foodName: { contains: 'chilli', mode: 'insensitive' } },
                    { foodName: { contains: 'chili', mode: 'insensitive' } }
                ]
            }
        });

        if (mappings.length === 0) {
            console.log('No entries found in ValidatedMapping');
        }

        for (const m of mappings) {
            console.log('NormalizedForm:', m.normalizedForm);
            console.log('  rawIngredient:', m.rawIngredient);
            console.log('  foodId:', m.foodId);
            console.log('  foodName:', m.foodName);
            console.log('  source:', m.source);
            console.log('');
        }

        // Also check "pepper" variations
        console.log('\n=== ValidatedMapping entries for "pepper" ===\n');
        const pepperMappings = await prisma.validatedMapping.findMany({
            where: { normalizedForm: { contains: 'pepper', mode: 'insensitive' } },
            take: 10
        });

        for (const m of pepperMappings) {
            console.log('NormalizedForm:', m.normalizedForm);
            console.log('  foodName:', m.foodName);
            console.log('');
        }

    } finally {
        await prisma.$disconnect();
    }
}

investigateChiliPeppers();
