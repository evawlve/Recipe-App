#!/usr/bin/env npx tsx

import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    // Delete AI normalize cache entries with lean percentages
    const deleted = await prisma.aiNormalizeCache.deleteMany({
        where: {
            OR: [
                { rawLine: { contains: '85%', mode: 'insensitive' } },
                { rawLine: { contains: '90%', mode: 'insensitive' } },
                { rawLine: { contains: '80%', mode: 'insensitive' } },
                { rawLine: { contains: 'ground beef', mode: 'insensitive' } },
            ]
        }
    });
    console.log('Deleted AI normalize cache entries:', deleted.count);

    // Also delete validated mappings for these
    const deletedMappings = await prisma.validatedMapping.deleteMany({
        where: {
            OR: [
                { rawIngredient: { contains: '85%', mode: 'insensitive' } },
                { rawIngredient: { contains: '90%', mode: 'insensitive' } },
                { rawIngredient: { contains: 'ground beef', mode: 'insensitive' } },
            ]
        }
    });
    console.log('Deleted validated mappings:', deletedMappings.count);

    await prisma.$disconnect();
}

main().catch(console.error);
