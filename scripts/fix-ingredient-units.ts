import { prisma } from '../src/lib/db';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';

/**
 * Re-parse all ingredients using the updated parser to fix:
 * 1. Units that were incorrectly stored in the name field (e.g., "tbsps butter")
 * 2. Count-based ingredients that were missing unit (e.g., "egg" without unit="egg")
 */
async function main() {
    console.log('Re-parsing all ingredients with updated parser...\n');

    const allIngredients = await prisma.ingredient.findMany();
    console.log(`Found ${allIngredients.length} total ingredients\n`);

    let fixed = 0;
    let unchanged = 0;
    let errors = 0;

    for (const ing of allIngredients) {
        // Reconstruct the original line
        const originalLine = `${ing.qty} ${ing.unit || ''} ${ing.name}`.replace(/\s+/g, ' ').trim();

        const parsed = parseIngredientLine(originalLine);

        if (!parsed) {
            // Parser couldn't parse - leave unchanged
            unchanged++;
            continue;
        }

        // Check if anything changed
        const newUnit = parsed.unit || '';
        const newName = parsed.name;

        if (newUnit !== (ing.unit || '') || newName !== ing.name) {
            console.log(`Fixing: "${originalLine}"`);
            console.log(`  Old: qty=${ing.qty}, unit="${ing.unit || ''}", name="${ing.name}"`);
            console.log(`  New: qty=${parsed.qty}, unit="${newUnit}", name="${newName}"`);
            console.log('');

            try {
                await prisma.ingredient.update({
                    where: { id: ing.id },
                    data: {
                        qty: parsed.qty,
                        unit: newUnit,
                        name: newName
                    }
                });
                fixed++;
            } catch (err) {
                console.error(`  ERROR: ${(err as Error).message}`);
                errors++;
            }
        } else {
            unchanged++;
        }
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log(`✅ Fixed: ${fixed}`);
    console.log(`⏭️  Unchanged: ${unchanged}`);
    console.log(`❌ Errors: ${errors}`);
    console.log('='.repeat(50));

    await prisma.$disconnect();
}

main();
