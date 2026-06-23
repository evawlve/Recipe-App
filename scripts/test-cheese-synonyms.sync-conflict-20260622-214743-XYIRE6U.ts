#!/usr/bin/env tsx
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { aiNormalizeIngredient } from '../src/lib/fatsecret/ai-normalize';

async function test() {
    const raw = '1 cup reduced fat colby and monterey jack cheese';
    console.log(`Testing AI normalization for: "${raw}"...`);

    // Clear cache to ensure fresh run
    await prisma.aiNormalizeCache.deleteMany({
        where: { rawLine: raw }
    });

    const result = await aiNormalizeIngredient(raw);

    if (result.status === 'success') {
        console.log('Normalized Name:', result.normalizedName);
        console.log('Synonyms:', result.synonyms);
    } else {
        console.log('Error:', result.reason);
    }
}

test().catch(console.error).finally(() => prisma.$disconnect());
