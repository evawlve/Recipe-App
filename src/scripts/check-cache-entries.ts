/**
 * Check specific cache entries
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    // Check ValidatedMapping for exact "burger relish"
    const burgerEntry = await prisma.validatedMapping.findFirst({
        where: { normalizedForm: 'burger relish' }
    });

    console.log("\n=== EXACT 'burger relish' ValidatedMapping ===\n");
    if (burgerEntry) {
        console.log(`  Found: "${burgerEntry.rawIngredient}"`);
        console.log(`  Normalized: "${burgerEntry.normalizedForm}"`);
        console.log(`  Food: "${burgerEntry.foodName}" (${burgerEntry.foodId})`);
        console.log(`  Confidence: ${burgerEntry.aiConfidence}`);
        console.log(`  ID: ${burgerEntry.id}`);
    } else {
        console.log("  No exact match found");
    }

    // Check ALL ValidatedMapping entries with "burger" or "relish" 
    const allRelated = await prisma.validatedMapping.findMany({
        where: {
            OR: [
                { normalizedForm: { contains: 'burger' } },
                { normalizedForm: { contains: 'relish' } },
            ]
        }
    });

    console.log(`\n=== ALL burger/relish ValidatedMappings (${allRelated.length}) ===\n`);
    for (const m of allRelated) {
        console.log(`  "${m.normalizedForm}" → "${m.foodName}" (${m.aiConfidence})`);
    }

    // Check AiNormalizeCache for any burger relish entries (NOT SIMPLIFY: prefix)
    const aiNormCache = await prisma.aiNormalizeCache.findMany({
        where: {
            rawLine: { contains: 'burger' }
        }
    });

    console.log(`\n=== AiNormalizeCache burger entries (${aiNormCache.length}) ===\n`);
    for (const c of aiNormCache) {
        console.log(`  "${c.rawLine}" → "${c.normalizedName}"`);
    }

    await prisma.$disconnect();
}

main().catch(console.error);
