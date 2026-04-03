/**
 * Clear moderate issue mappings: fried shallots, parsley flakes, sucralose
 */
import { prisma } from '../src/lib/db';

const MODERATE_CLEAR = [
    'fried shallots',
    'shallots',
    'parsley flakes',
    'sucralose',
    'sucralose sweetener',
];

async function main() {
    console.log('🧹 Clearing moderate issue mappings...\n');

    let totalVM = 0;
    let totalIFM = 0;

    for (const name of MODERATE_CLEAR) {
        // Clear ValidatedMapping by normalizedForm
        const vm = await prisma.validatedMapping.deleteMany({
            where: { normalizedForm: { contains: name, mode: 'insensitive' } },
        });
        if (vm.count > 0) {
            console.log(`  ✓ ValidatedMapping "${name}": ${vm.count}`);
            totalVM += vm.count;
        }

        // Clear IngredientFoodMap
        const ingredients = await prisma.ingredient.findMany({
            where: { name: { contains: name, mode: 'insensitive' } },
            select: { id: true },
        });
        if (ingredients.length > 0) {
            const ids = ingredients.map(i => i.id);
            const ifm = await prisma.ingredientFoodMap.deleteMany({
                where: { ingredientId: { in: ids } },
            });
            if (ifm.count > 0) {
                console.log(`  ✓ IngredientFoodMap "${name}": ${ifm.count} (${ingredients.length} ingredients)`);
                totalIFM += ifm.count;
            }
        }
    }

    // Also clear AiNormalizeCache for these terms so the AI re-normalizes
    for (const name of ['fried shallots', 'parsley flakes', 'sucralose sweetener']) {
        const an = await prisma.aiNormalizeCache.deleteMany({
            where: { normalizedKey: { contains: name, mode: 'insensitive' } },
        });
        if (an.count > 0) {
            console.log(`  ✓ AiNormalizeCache "${name}": ${an.count}`);
        }
    }

    console.log(`\n✅ Done! VM: ${totalVM}, IFM: ${totalIFM}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
