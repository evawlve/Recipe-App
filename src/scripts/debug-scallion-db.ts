/**
 * Debug scallion serving data in all caches - JSON output
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

async function main() {
    const result: Record<string, unknown> = {};

    // 1. Check FatSecret food cache
    const fsFoods = await prisma.fatSecretFoodCache.findMany({
        where: { name: { contains: 'scallion', mode: 'insensitive' } },
        select: { id: true, name: true }
    });

    result.fatSecretFoods = [];
    for (const food of fsFoods) {
        const servings = await prisma.fatSecretServingCache.findMany({
            where: { foodId: food.id },
            select: { measurementDescription: true, metricServingAmount: true }
        });
        (result.fatSecretFoods as unknown[]).push({
            name: food.name,
            id: food.id,
            servings: servings.map(s => ({
                desc: s.measurementDescription,
                grams: s.metricServingAmount,
                bad: s.metricServingAmount && s.metricServingAmount > 50
            }))
        });
    }

    // 2. Check FDC food cache
    const fdcFoods = await prisma.fdcFoodCache.findMany({
        where: { description: { contains: 'scallion', mode: 'insensitive' } },
        select: { id: true, description: true }
    });

    result.fdcFoods = [];
    for (const food of fdcFoods) {
        const servings = await prisma.fdcServingCache.findMany({
            where: { fdcId: food.id },
            select: { description: true, grams: true }
        });
        (result.fdcFoods as unknown[]).push({
            name: food.description,
            id: food.id,
            servings: servings.map(s => ({
                desc: s.description,
                grams: s.grams,
                bad: s.grams > 50
            }))
        });
    }

    // 3. Check ValidatedMapping cache
    const mappings = await prisma.validatedMapping.findMany({
        where: { normalizedForm: { contains: 'scallion', mode: 'insensitive' } },
        select: { normalizedForm: true, foodName: true, foodId: true }
    });
    result.validatedMappings = mappings;

    await prisma.$disconnect();

    fs.writeFileSync('logs/scallion-data.json', JSON.stringify(result, null, 2));
    console.log('Wrote logs/scallion-data.json');
}

main().catch(console.error);
