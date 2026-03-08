#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function checkCache() {
    const food1 = await (prisma as any).fatSecretFoodCache.findUnique({
        where: { id: '36442' }
    });

    const food2 = await (prisma as any).fatSecretFoodCache.findUnique({
        where: { id: '40396' }
    });

    console.log('\n🔍 Checking FatSecret Cache:\n');
    console.log(`Food 36442 (Onions): ${food1 ? food1.name : '❌ NOT FOUND'}`);
    console.log(`Food 40396 (Ground Beef): ${food2 ? food2.name : '❌ NOT FOUND'}`);
    console.log();

    await prisma.$disconnect();
}

checkCache().catch(console.error);
