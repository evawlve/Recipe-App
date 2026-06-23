#!/usr/bin/env ts-node
import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    const potatoes = await prisma.fdcFoodCache.findMany({
        where: { description: { contains: 'potato', mode: 'insensitive' } },
        take: 10,
        include: { servings: true },
    });

    console.log(`Found ${potatoes.length} FDC potato entries:`);
    for (const p of potatoes) {
        console.log(`  ID ${p.id}: "${p.description}" (${p.dataType})`);
        console.log(`    Servings: ${p.servings.map(s => `${s.description}=${s.grams}g`).join(', ') || 'none'}`);
    }

    await prisma.$disconnect();
}

main();
