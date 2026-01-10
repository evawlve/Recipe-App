#!/usr/bin/env npx tsx

import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    // Check for validated mappings for raw/roma tomato
    const tomatoMappings = await prisma.validatedMapping.findMany({
        where: {
            OR: [
                { rawIngredient: { contains: 'roma', mode: 'insensitive' } },
                { foodName: { contains: 'roma', mode: 'insensitive' } },
            ]
        },
        select: { rawIngredient: true, foodName: true },
        take: 10
    });

    console.log('ROMA TOMATO MAPPINGS:');
    console.log(JSON.stringify(tomatoMappings, null, 2));

    // Check if there's a stale "tomato salsa" -> "roma tomato" mapping
    const salsaMappings = await prisma.validatedMapping.findMany({
        where: { rawIngredient: { contains: 'tomato salsa', mode: 'insensitive' } },
        select: { rawIngredient: true, foodName: true },
    });
    console.log('\nTOMATO SALSA MAPPINGS:');
    console.log(JSON.stringify(salsaMappings, null, 2));

    await prisma.$disconnect();
}

main().catch(console.error);
