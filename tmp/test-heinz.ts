import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function main() {
    await prisma.validatedMapping.deleteMany({
        where: { rawIngredient: { contains: 'Heinz', mode: 'insensitive' } },
    });
    await prisma.aiNormalizeCache.deleteMany({
        where: { rawLine: { contains: 'Heinz', mode: 'insensitive' } },
    });
    console.log('Cache cleared.');

    const result = await mapIngredientWithFallback('2 tbsp Heinz Tomato Ketchup');
    if (!result) { console.log('NULL result'); process.exit(1); }

    const badge =
        result.source === 'fatsecret'     ? '🟡 FatSec' :
        result.source === 'fdc'            ? '🔵 FDC   ' :
        result.source === 'openfoodfacts'  ? '🟢 OFF   ' :
        `⚪ ${result.source}`;

    console.log(
        `${badge}  "${result.foodName}"${result.brandName ? ` [${result.brandName}]` : ''}\n` +
        `         ${result.grams.toFixed(1)}g | ${result.kcal.toFixed(0)} kcal | ` +
        `P ${result.protein.toFixed(1)}g C ${result.carbs.toFixed(1)}g F ${result.fat.toFixed(1)}g | ` +
        `conf ${(result.confidence * 100).toFixed(0)}%`
    );

    await prisma.$disconnect();
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
