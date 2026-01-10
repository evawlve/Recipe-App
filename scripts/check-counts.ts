#!/usr/bin/env tsx
import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function check() {
    const fatSecretFoods = await prisma.fatSecretFoodCache.count();
    const fdcFoods = await prisma.fdcFoodCache.count();
    const validatedMappings = await prisma.validatedMapping.count();
    const aliases = await prisma.validatedMapping.count({ where: { isAlias: true } });

    console.log('=== Cache Summary ===');
    console.log('FatSecret Foods:', fatSecretFoods);
    console.log('FDC Foods:', fdcFoods);
    console.log('Total hydrated foods:', fatSecretFoods + fdcFoods);
    console.log('');
    console.log('=== Validated Mappings ===');
    console.log('Main mappings:', validatedMappings - aliases);
    console.log('Alias mappings:', aliases);
    console.log('Total:', validatedMappings);
}

check().finally(() => prisma.$disconnect());
