/**
 * Check serving weights for specific foods mentioned in issues
 */
import { prisma } from '../src/lib/db';

async function main() {
    console.log('=== CHECKING SERVING WEIGHTS FOR ISSUE ITEMS ===\n');

    // 1. Black Olives (ID: 6809) - should have "large" = ~5g each
    console.log('--- BLACK OLIVES (ID: 6809) ---');
    const oliveServings = await prisma.fatSecretServingCache.findMany({
        where: { foodId: '6809' }
    });
    for (const s of oliveServings) {
        console.log(`  ${s.measurementDescription}: ${s.servingWeightGrams}g [source: ${s.source}]`);
    }

    // 2. Whey Protein Isolate (Optimum Nutrition) - ID: 22591650
    console.log('\n--- WHEY PROTEIN ISOLATE (Optimum Nutrition, ID: 22591650) ---');
    const wheyServings = await prisma.fatSecretServingCache.findMany({
        where: { foodId: '22591650' }
    });
    for (const s of wheyServings) {
        console.log(`  ${s.measurementDescription}: ${s.servingWeightGrams}g [source: ${s.source}]`);
    }

    // 3. Generic Protein Powder - ID: 32825
    console.log('\n--- PROTEIN POWDER (ID: 32825) ---');
    const proteinServings = await prisma.fatSecretServingCache.findMany({
        where: { foodId: '32825' }
    });
    for (const s of proteinServings) {
        console.log(`  ${s.measurementDescription}: ${s.servingWeightGrams}g [source: ${s.source}]`);
    }

    // 4. Crushed Tomatoes Hunt's - ID: 49806
    console.log('\n--- CRUSHED TOMATOES (Hunt\'s, ID: 49806) ---');
    const crushedTomatoServings = await prisma.fatSecretServingCache.findMany({
        where: { foodId: '49806' }
    });
    for (const s of crushedTomatoServings) {
        console.log(`  ${s.measurementDescription}: ${s.servingWeightGrams}g [source: ${s.source}]`);
    }

    // 5. Fire roasted tomatoes with green chiles (Trader Joe's) - ID: 244577
    console.log('\n--- FIRE ROASTED TOMATOES WITH GREEN CHILES (TJ, ID: 244577) ---');
    const fireRoastedServings = await prisma.fatSecretServingCache.findMany({
        where: { foodId: '244577' }
    });
    for (const s of fireRoastedServings) {
        console.log(`  ${s.measurementDescription}: ${s.servingWeightGrams}g [source: ${s.source}]`);
    }

    await prisma.$disconnect();
}

main().catch(console.error);
