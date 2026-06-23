/**
 * Check mapping statistics across all recipes
 */
import { prisma } from '../src/lib/db';

async function main() {
    console.log('\n=== Mapping Statistics ===\n');

    // Get all ingredients with their food maps
    const totalIngredients = await prisma.ingredient.findMany({
        select: { id: true, name: true, unit: true, qty: true },
    });

    // Get all ingredient food maps
    const mappedIngredientIds = await prisma.ingredientFoodMap.findMany({
        where: { fatsecretFoodId: { not: null } },
        select: { ingredientId: true, fatsecretFoodId: true, fatsecretConfidence: true }
    });

    const mappedSet = new Set(mappedIngredientIds.map(m => m.ingredientId));
    const unmappedIngredients = totalIngredients.filter(i => !mappedSet.has(i.id));

    console.log(`Total ingredients: ${totalIngredients.length}`);
    console.log(`Mapped: ${mappedSet.size} (${(mappedSet.size / totalIngredients.length * 100).toFixed(1)}%)`);
    console.log(`Unmapped: ${unmappedIngredients.length}`);

    // Sample some unmapped ingredients
    if (unmappedIngredients.length > 0) {
        console.log('\nSample unmapped ingredients:');
        for (const s of unmappedIngredients.slice(0, 10)) {
            console.log(`  - ${s.qty} ${s.unit} ${s.name}`);
        }
    }

    // Check mapping confidence distribution
    const confidences = mappedIngredientIds.map(m => m.fatsecretConfidence || 0);
    const highConf = confidences.filter(c => c >= 0.8).length;
    const medConf = confidences.filter(c => c >= 0.5 && c < 0.8).length;
    const lowConf = confidences.filter(c => c < 0.5).length;

    console.log('\nMapping confidence distribution:');
    console.log(`  High (≥0.8): ${highConf}`);
    console.log(`  Medium (0.5-0.8): ${medConf}`);
    console.log(`  Low (<0.5): ${lowConf}`);

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
