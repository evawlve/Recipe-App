#!/usr/bin/env npx tsx

import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    const result = await prisma.aiNormalizeCache.findFirst({
        where: { rawLine: { contains: 'colby', mode: 'insensitive' } },
        select: { rawLine: true, normalizedName: true }
    });
    console.log('AI Normalize Cache for colby:', JSON.stringify(result, null, 2));

    // Also check the AI simplify cache
    const simplifyResult = await prisma.$queryRaw`
        SELECT * FROM "AiNormalizeCache" 
        WHERE "rawLine" ILIKE '%colby%' 
        LIMIT 5
    `;
    console.log('\nAll colby entries in AiNormalizeCache:', JSON.stringify(simplifyResult, null, 2));

    await prisma.$disconnect();
}

main().catch(console.error);
