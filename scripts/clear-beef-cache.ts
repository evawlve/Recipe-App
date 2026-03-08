#!/usr/bin/env npx tsx

import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    // Delete bad cached mappings for ingredients with parsing issues
    const patterns = [
        '%lbs%',
        '%ground beef%',
        '%extra lean%',
    ];

    for (const pattern of patterns) {
        const deleted = await prisma.validatedMapping.deleteMany({
            where: { rawIngredient: { contains: pattern.replace(/%/g, ''), mode: 'insensitive' } }
        });
        console.log(`Deleted mappings matching "${pattern}":`, deleted.count);
    }

    await prisma.$disconnect();
}

main().catch(console.error);
