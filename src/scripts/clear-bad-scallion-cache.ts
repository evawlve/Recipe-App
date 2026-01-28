/**
 * Clear bad AI-cached scallion servings and verify fix
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

async function main() {
    console.log("\n=== CLEARING BAD SCALLION AI SERVINGS ===\n");

    // 1. Find and delete AI-generated scallion servings with bad weights
    const aiServings = await prisma.fatSecretServingCache.findMany({
        where: {
            source: 'ai_ambiguous',
            foodId: '36451', // Scallions or Spring Onions
        },
    });

    console.log(`Found ${aiServings.length} AI-generated servings for scallion food 36451:`);
    for (const s of aiServings) {
        console.log(`  - "${s.measurementDescription}": ${s.servingWeightGrams}g (${s.id})`);
    }

    // Delete AI servings with weights > 30g (definitely wrong for individual scallions)
    const badServings = aiServings.filter(s => s.servingWeightGrams && s.servingWeightGrams > 30);
    if (badServings.length > 0) {
        console.log(`\nDeleting ${badServings.length} bad AI servings (>30g)...`);
        for (const s of badServings) {
            await prisma.fatSecretServingCache.delete({ where: { id: s.id } });
            console.log(`  Deleted: ${s.id} (${s.servingWeightGrams}g)`);
        }
    }

    // 2. Also check for any scallion-related mappings in ValidatedMapping
    const mappings = await prisma.validatedMapping.findMany({
        where: { normalizedForm: { contains: 'scallion', mode: 'insensitive' } }
    });

    if (mappings.length > 0) {
        console.log(`\nDeleting ${mappings.length} validated mappings for scallions...`);
        await prisma.validatedMapping.deleteMany({
            where: { normalizedForm: { contains: 'scallion', mode: 'insensitive' } }
        });
    }

    // 3. Verify remaining servings for scallion food
    const remainingServings = await prisma.fatSecretServingCache.findMany({
        where: { foodId: '36451' },
        select: { measurementDescription: true, metricServingAmount: true, servingWeightGrams: true, source: true }
    });

    console.log(`\nRemaining servings for scallions (36451):`);
    for (const s of remainingServings) {
        const grams = s.servingWeightGrams ?? s.metricServingAmount ?? 'null';
        console.log(`  - "${s.measurementDescription}": ${grams}g (source: ${s.source ?? 'api'})`);
    }

    await prisma.$disconnect();
    console.log("\n✅ Cleanup complete\n");
}

main().catch(console.error);
