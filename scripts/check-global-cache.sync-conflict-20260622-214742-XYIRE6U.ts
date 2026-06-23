#!/usr/bin/env ts-node
import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    const count = await (prisma as any).globalIngredientMapping.count();
    const avgUsage = await (prisma as any).globalIngredientMapping.aggregate({
        _avg: { usageCount: true, confidence: true }
    });

    console.log('\n📊 Global Mapping Cache Stats:\n');
    console.log(`Total Cached Ingredients: ${count}`);
    console.log(`Average Usage: ${avgUsage._avg.usageCount?.toFixed(1)}x per ingredient`);
    console.log(`Average Confidence: ${(avgUsage._avg.confidence * 100)?.toFixed(1)}%`);

    const recent = await (prisma as any).globalIngredientMapping.findMany({
        orderBy: { lastUsed: 'desc' },
        take: 10
    });

    console.log('\n🔥 Top 10 Most Recently Used:\n');
    recent.forEach((m: any, i: number) => {
        console.log(`${i + 1}. "${m.normalizedName}"`);
        console.log(`   Confidence: ${(m.confidence * 100).toFixed(0)}% | Used: ${m.usageCount}x | Source: ${m.source}`);
    });
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
