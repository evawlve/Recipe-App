import { prisma } from '../src/lib/db';

async function main() {
    const maps = await prisma.ingredientFoodMap.findMany({
        take: 20,
        include: { ingredient: true }
    });

    console.log('=== IngredientFoodMap Table ===');
    console.log('Total entries:', maps.length);

    if (maps.length > 0) {
        console.log('\nEntries:');
        maps.forEach(m => {
            console.log(`  - [${m.ingredientId?.substring(0, 8)}...] ${m.ingredient?.name} -> ${m.fatsecretFoodId}`);
        });
    }

    // Check ValidatedMapping
    const validatedMaps = await prisma.validatedMapping.findMany({ take: 20 });
    console.log('\n=== ValidatedMapping Table ===');
    console.log('Total entries:', validatedMaps.length);
    validatedMaps.forEach(v => {
        console.log(`  - "${v.rawIngredient?.substring(0, 30)}" -> ${v.foodName}`);
    });

    await prisma.$disconnect();
}

main().catch(console.error);
