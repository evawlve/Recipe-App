/**
 * Clear weight-unit based mappings from ValidatedMapping cache
 * These are affected by the gram calculation fix
 */
import { prisma } from '../src/lib/db';

const PATTERNS = [
    '%g %',      // "100 g", "150 g"
    '%oz %',     // "4 oz"  
    '%lb %',     // "1 lb"
    '%gram %',
    '%grams %',
    'tofu',
    'mozzarella',
    'cream',
    'tomatoes',
    'flour',
    'potato',
    'olives',
    'yogurt',
    'ice cube',
];

async function main() {
    console.log('🧹 Clearing weight-unit mappings from ValidatedMapping cache...\n');

    let totalCleared = 0;

    for (const pattern of PATTERNS) {
        const result = await prisma.validatedMapping.deleteMany({
            where: {
                rawIngredient: {
                    contains: pattern.replace(/%/g, ''),
                    mode: 'insensitive',
                },
            },
        });

        if (result.count > 0) {
            console.log(`  Cleared ${result.count} mappings containing "${pattern}"`);
            totalCleared += result.count;
        }
    }

    console.log(`\n🎯 Total cleared: ${totalCleared} mappings`);
    await prisma.$disconnect();
}

main().catch(console.error);
