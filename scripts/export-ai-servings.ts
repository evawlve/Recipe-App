/**
 * Export all AI-generated serving sizes from the cache
 * 
 * This script queries both FatSecretServingCache and FdcServingCache
 * for entries that were created by AI estimation.
 */

import { prisma } from '../src/lib/db';
import * as fs from 'fs';

interface AiServingEntry {
    cacheType: 'fatsecret' | 'fdc';
    foodId: string;
    foodName: string;
    brandName: string | null;
    servingDescription: string;
    grams: number;
    source: string;
    confidence: number | null;
    note: string | null;
    createdAt: Date;
}

async function main() {
    const results: AiServingEntry[] = [];

    console.log('Querying FatSecretServingCache for AI-generated entries...');

    // FatSecret servings with AI source (not "fatsecret")
    const fatSecretAiServings = await prisma.fatSecretServingCache.findMany({
        where: {
            OR: [
                { source: { not: 'fatsecret' } },
                { source: { contains: 'ai' } },
                { source: { contains: 'ollama' } },
                { source: { contains: 'estimate' } },
            ]
        },
        include: {
            food: {
                select: {
                    name: true,
                    brandName: true,
                }
            }
        },
        orderBy: { createdAt: 'desc' }
    });

    console.log(`Found ${fatSecretAiServings.length} FatSecret AI servings`);

    for (const s of fatSecretAiServings) {
        results.push({
            cacheType: 'fatsecret',
            foodId: s.foodId,
            foodName: s.food.name,
            brandName: s.food.brandName,
            servingDescription: s.measurementDescription || 'unknown',
            grams: s.servingWeightGrams || 0,
            source: s.source || 'unknown',
            confidence: s.confidence,
            note: s.note,
            createdAt: s.createdAt,
        });
    }

    console.log('\nQuerying FdcServingCache for AI-generated entries...');

    // FDC servings with isAiEstimated flag or non-fdc source
    const fdcAiServings = await prisma.fdcServingCache.findMany({
        where: {
            OR: [
                { isAiEstimated: true },
                { source: { not: 'fdc' } },
                { source: { contains: 'ai' } },
                { source: { contains: 'ollama' } },
            ]
        },
        include: {
            food: {
                select: {
                    description: true,
                    brandName: true,
                }
            }
        },
        orderBy: { fdcId: 'asc' }
    });

    console.log(`Found ${fdcAiServings.length} FDC AI servings`);

    for (const s of fdcAiServings) {
        results.push({
            cacheType: 'fdc',
            foodId: `fdc_${s.fdcId}`,
            foodName: s.food.description,
            brandName: s.food.brandName,
            servingDescription: s.description,
            grams: s.grams,
            source: s.source,
            confidence: null,
            note: null,
            createdAt: new Date(), // FDC schema doesn't have createdAt
        });
    }

    // Sort by cache type then food name
    results.sort((a, b) => {
        if (a.cacheType !== b.cacheType) return a.cacheType.localeCompare(b.cacheType);
        return a.foodName.localeCompare(b.foodName);
    });

    // Write to JSON file
    const jsonPath = 'logs/ai-generated-servings.json';
    fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
    console.log(`\n✅ Wrote ${results.length} entries to ${jsonPath}`);

    // Also write a human-readable summary
    const summaryPath = 'logs/ai-generated-servings-summary.txt';
    let summary = `AI-Generated Serving Sizes Summary\n`;
    summary += `Generated: ${new Date().toISOString()}\n`;
    summary += `Total entries: ${results.length}\n`;
    summary += `FatSecret entries: ${results.filter(r => r.cacheType === 'fatsecret').length}\n`;
    summary += `FDC entries: ${results.filter(r => r.cacheType === 'fdc').length}\n`;
    summary += `\n${'='.repeat(80)}\n\n`;

    // Group by source
    const bySource = new Map<string, AiServingEntry[]>();
    for (const r of results) {
        const key = r.source;
        if (!bySource.has(key)) bySource.set(key, []);
        bySource.get(key)!.push(r);
    }

    for (const [source, entries] of bySource) {
        summary += `\n## Source: ${source} (${entries.length} entries)\n`;
        summary += '-'.repeat(60) + '\n';

        for (const e of entries.slice(0, 50)) { // Limit to 50 per source
            const brand = e.brandName ? ` (${e.brandName})` : '';
            summary += `  ${e.foodName}${brand}\n`;
            summary += `    → "${e.servingDescription}" = ${e.grams}g\n`;
            if (e.confidence) summary += `    → confidence: ${e.confidence}\n`;
            if (e.note) summary += `    → note: ${e.note}\n`;
        }

        if (entries.length > 50) {
            summary += `  ... and ${entries.length - 50} more entries\n`;
        }
    }

    fs.writeFileSync(summaryPath, summary);
    console.log(`✅ Wrote summary to ${summaryPath}`);

    await prisma.$disconnect();
}

main().catch(console.error);
