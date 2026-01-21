/**
 * Clear almond milk cache entries and test fresh normalization
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { aiNormalizeIngredient } from '../src/lib/fatsecret/ai-normalize';

const prisma = new PrismaClient();

async function main() {
    console.log('=== Clearing cache entries containing "unsweetened" ===');

    const deleted = await prisma.aiNormalizeCache.deleteMany({
        where: { rawLine: { contains: 'unsweetened' } }
    });
    console.log('Deleted', deleted.count, 'cache entries');

    console.log('\n=== Testing fresh normalization ===');
    console.log('Input: "1 cup unsweetened almond milk"');

    const result = await aiNormalizeIngredient('1 cup unsweetened almond milk');

    if (result.status === 'success') {
        console.log('normalized_name:', result.normalizedName);
        console.log('canonical_base:', result.canonicalBase);

        const hasUnsweetened = result.canonicalBase.toLowerCase().includes('unsweetened');
        console.log('\n' + (hasUnsweetened
            ? '✅ PASS: canonical_base preserves "unsweetened"'
            : '❌ FAIL: canonical_base missing "unsweetened"'));
    } else {
        console.log('Error:', result.reason);
    }

    await prisma.$disconnect();
}

main().catch(console.error);
