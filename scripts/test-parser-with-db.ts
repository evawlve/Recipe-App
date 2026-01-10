import { prisma } from '../src/lib/db';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';

async function main() {
    // Get all ingredients and filter those with empty unit
    const allIngredients = await prisma.ingredient.findMany({ take: 100 });
    const ingredients = allIngredients.filter(i => !i.unit || i.unit.trim() === '').slice(0, 20);

    console.log('Testing parser with actual ingredient data:\n');

    for (const ing of ingredients) {
        // Reconstruct what the original line might have been
        const reconstructed = `${ing.qty} ${ing.name}`.trim();
        const parsed = parseIngredientLine(reconstructed);

        console.log(`Original DB: qty=${ing.qty}, unit="${ing.unit || ''}", name="${ing.name}"`);
        console.log(`Reconstructed: "${reconstructed}"`);
        console.log(`Parser result: ${parsed ? `qty=${parsed.qty}, unit="${parsed.unit || ''}", name="${parsed.name}"` : 'NULL'}`);
        console.log('---');
    }

    await prisma.$disconnect();
}

main();
