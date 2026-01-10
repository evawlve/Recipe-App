#!/usr/bin/env tsx
import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function clear() {
    // Clear onion mappings
    const result = await prisma.validatedMapping.deleteMany({
        where: { rawIngredient: { contains: 'onion' } }
    });
    console.log('Deleted onion mappings:', result.count);

    // Also clear milk mappings to retest modifier fix
    const milkResult = await prisma.validatedMapping.deleteMany({
        where: { rawIngredient: { contains: 'milk' } }
    });
    console.log('Deleted milk mappings:', milkResult.count);
}

clear().finally(() => prisma.$disconnect());
