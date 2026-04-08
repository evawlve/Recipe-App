import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    const entries = await prisma.aiNormalizeCache.findMany({
        where: { normalizedName: { contains: 'sour cream' } }
    });
    console.log('AiNormalizeCache entries for "sour cream":');
    for (const e of entries) {
        console.log(`  key="${e.normalizedKey}" => name="${e.normalizedName}" base="${e.canonicalBase}" raw="${e.rawLine}"`);
    }

    const lightEntries = await prisma.aiNormalizeCache.findMany({
        where: { normalizedKey: { contains: 'light' } }
    });
    console.log('\nAiNormalizeCache entries with "light" in key:');
    for (const e of lightEntries) {
        console.log(`  key="${e.normalizedKey}" => name="${e.normalizedName}" base="${e.canonicalBase}"`);
    }

    // Also check what normalizedKey looks like for sour cream
    const scEntries = await prisma.aiNormalizeCache.findMany({
        where: { normalizedKey: { contains: 'sour' } }
    });
    console.log('\nAiNormalizeCache entries with "sour" in key:');
    for (const e of scEntries) {
        console.log(`  key="${e.normalizedKey}" => name="${e.normalizedName}" base="${e.canonicalBase}"`);
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
