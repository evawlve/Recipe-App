#!/usr/bin/env tsx
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { aiNormalizeIngredient } from '../src/lib/fatsecret/ai-normalize';

async function test() {
    console.log('Clearing cache for "nonfat milk"...');
    await prisma.aiNormalizeCache.deleteMany({
        where: { rawLine: { contains: 'nonfat milk' } }
    });

    console.log('Testing AI normalization...');
    const result = await aiNormalizeIngredient('2 cup nonfat milk');

    if (result.status === 'success') {
        console.log('Result:', result.normalizedName);
        console.log('Prep phrases:', result.prepPhrases);
        console.log('Synonyms:', result.synonyms);

        if (result.normalizedName.includes('nonfat')) {
            console.log('✅ SUCCESS: Modifier preserved');
        } else {
            console.log('❌ FAILURE: Modifier stripped');
        }
    } else {
        console.log('Error:', result.reason);
    }
}

test().catch(console.error).finally(() => prisma.$disconnect());
