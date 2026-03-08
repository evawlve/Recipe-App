#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    console.log('\n🔍 Unmapped Ingredients Report\n');
    console.log('='.repeat(50));

    const unmapped = await prisma.ingredient.findMany({
        where: {
            foodMaps: {
                none: {},
            },
        },
        include: { recipe: { select: { id: true, title: true } } },
        orderBy: { id: 'desc' },
        take: 50,
    });

    if (unmapped.length === 0) {
        console.log('\n✅ All ingredients are mapped!');
        return;
    }

    console.log(`\nFound ${unmapped.length} unmapped ingredients:\n`);

    unmapped.forEach((ing, idx) => {
        const line = ing.unit && ing.unit.trim()
            ? `${ing.qty} ${ing.unit} ${ing.name}`
            : `${ing.qty} ${ing.name}`;

        console.log(`${idx + 1}. "${line}"`);
        console.log(`   Recipe: ${ing.recipe.title} (${ing.recipe.id})`);
        console.log(`   Ingredient ID: ${ing.id}`);
        console.log('');
    });

    console.log('='.repeat(50));
    console.log(`\nTotal unmapped: ${unmapped.length}`);
}

main()
    .catch((error) => {
        console.error('Error:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
