
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';

async function main() {
    console.log('--- Deep Dive Debug ---');

    // 1. Get STRAWBERRY (TONY'S) Food ID from ValidatedMapping
    // We look for the raw ingredient "2 cup stberry halves" which we know mapped to it
    const mapping = await prisma.validatedMapping.findFirst({
        where: { rawIngredient: { contains: "stberry" } }
    });

    if (mapping) {
        console.log('\nFound ValidatedMapping for stberry:');
        console.log(mapping);

        // Now get the food cache entry
        const food = await prisma.fatSecretFoodCache.findUnique({
            where: { id: mapping.foodId }
        });
        console.log('\nStrawberry Food Cache Entry:');
        console.log(food);
    } else {
        console.log('\nCould not find Clean STRAWBERRY mapping.');
    }

    // 2. Inspect Egg Beaters Candidates
    console.log('\n--- Egg Beaters Candidates ---');
    const candidates = await gatherCandidates("egg beaters");
    console.log(`Found ${candidates.length} candidates.`);

    // Show top 5
    candidates.slice(0, 5).forEach(c => {
        console.log(`\n[${c.source}] ${c.name} (ID: ${c.id})`);
        if (c.nutrients) {
            console.log(`  Nutrients (per 100g): K${c.nutrients.kcal} P${c.nutrients.protein} C${c.nutrients.carbs} F${c.nutrients.fat}`);
        } else {
            console.log('  No nutrient data fetched for candidate preview');
        }
    });

}

main().catch(console.error).finally(() => prisma.$disconnect());
