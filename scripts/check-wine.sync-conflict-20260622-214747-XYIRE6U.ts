#!/usr/bin/env tsx
import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function check() {
    // Wine food
    const wine = await prisma.fatSecretFoodCache.findFirst({
        where: { id: '37740' }
    });
    console.log('Wine Food:', wine?.name);
    console.log('  Base calories/100g:', wine?.kcal);

    // Wine servings
    const servings = await prisma.fatSecretServingCache.findMany({
        where: { foodId: '37740' },
        select: { id: true, measurementDescription: true, numberOfUnits: true, kcal: true }
    });
    console.log('\nServings:');
    for (const s of servings) {
        console.log(`  ${s.measurementDescription}: ${s.kcal}kcal`);
    }
}

check().finally(() => prisma.$disconnect());
