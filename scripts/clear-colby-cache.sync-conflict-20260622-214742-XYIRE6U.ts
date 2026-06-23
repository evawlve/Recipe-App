#!/usr/bin/env npx tsx

import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    // Delete cache entries with "colby" so they'll be re-normalized
    const deleted = await prisma.aiNormalizeCache.deleteMany({
        where: { rawLine: { contains: 'colby', mode: 'insensitive' } }
    });
    console.log('Deleted AI normalize cache entries for colby:', deleted.count);

    await prisma.$disconnect();
}

main().catch(console.error);
