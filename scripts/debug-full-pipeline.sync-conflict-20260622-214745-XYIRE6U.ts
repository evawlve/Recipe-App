/**
 * Debug Full Pipeline Script
 * 
 * Unlike debug-mapping-issue.ts which only shows candidate scoring,
 * this script runs the EXACT production pipeline including:
 * 1. Early cache checks (rawIngredient key)
 * 2. Normalized cache checks
 * 3. API calls (FatSecret + FDC)
 * 4. Candidate filtering and scoring
 * 5. Hydration with serving selection
 * 6. Volume/weight backfill
 * 7. Fallback cascade
 * 8. Cache save
 * 
 * This ensures debug results match production behavior exactly.
 * 
 * Usage:
 *   npx ts-node scripts/debug-full-pipeline.ts --ingredient "0.311625 cup ground golden flaxseed meal"
 *   npx ts-node scripts/debug-full-pipeline.ts --ingredient "5 oz dry brown rice"
 *   npx ts-node scripts/debug-full-pipeline.ts --ingredient "1 cup quick oats" --no-cache
 */

import { mapIngredientWithFallback, type FatsecretMappedIngredient } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { prisma } from '../src/lib/db';
import { FatSecretClient } from '../src/lib/fatsecret/client';

// ============================================================
// CLI Argument Parsing
// ============================================================

interface CliArgs {
    ingredient?: string;
    noCache?: boolean;
    verbose?: boolean;
}

function parseArgs(): CliArgs {
    const args = process.argv.slice(2);
    const result: CliArgs = {};

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--ingredient' || args[i] === '-i') {
            result.ingredient = args[++i];
        } else if (args[i] === '--no-cache') {
            result.noCache = true;
        } else if (args[i] === '--verbose' || args[i] === '-v') {
            result.verbose = true;
        } else if (!args[i].startsWith('-')) {
            // Bare argument = ingredient
            result.ingredient = args[i];
        }
    }

    return result;
}

function printUsage() {
    console.log(`
Debug Full Pipeline - Mirrors Production Exactly

Usage:
  npx ts-node scripts/debug-full-pipeline.ts --ingredient "INGREDIENT"
  npx ts-node scripts/debug-full-pipeline.ts -i "INGREDIENT" --no-cache
  npx ts-node scripts/debug-full-pipeline.ts "INGREDIENT" --verbose

Options:
  --ingredient, -i  The ingredient line to debug
  --no-cache        Clear this ingredient from cache before running
  --verbose, -v     Show extra logging

Examples:
  npx ts-node scripts/debug-full-pipeline.ts -i "0.311625 cup ground golden flaxseed meal"
  npx ts-node scripts/debug-full-pipeline.ts -i "5 oz dry brown rice" --no-cache
  npx ts-node scripts/debug-full-pipeline.ts "1 cup quick oats"
`);
}

// ============================================================
// Pretty Printing Helpers
// ============================================================

function printHeader(title: string) {
    console.log('\n' + '='.repeat(70));
    console.log(`  ${title}`);
    console.log('='.repeat(70) + '\n');
}

function printSection(title: string) {
    console.log('\n--- ' + title + ' ---\n');
}

function formatMacros(r: FatsecretMappedIngredient): string {
    return `${r.kcal.toFixed(0)}kcal | P:${r.protein.toFixed(1)}g C:${r.carbs.toFixed(1)}g F:${r.fat.toFixed(1)}g`;
}

// ============================================================
// Main Debug Flow
// ============================================================

async function clearCacheForIngredient(rawLine: string) {
    printSection('Clearing Cache for this Ingredient');

    // Clear ValidatedMapping entries
    const vmDeleted = await prisma.validatedMapping.deleteMany({
        where: {
            OR: [
                { rawIngredient: { contains: rawLine.toLowerCase(), mode: 'insensitive' } },
                { normalizedForm: { contains: rawLine.toLowerCase(), mode: 'insensitive' } },
            ]
        }
    });

    console.log(`  Deleted ${vmDeleted.count} ValidatedMapping entries`);
}

async function debugFullPipeline(rawLine: string, options: { noCache?: boolean; verbose?: boolean }) {
    printHeader(`FULL PIPELINE DEBUG: "${rawLine}"`);

    console.log('This script runs the EXACT same code as production.');
    console.log('All cache checks, hydration, backfill, and fallback are included.');

    if (options.noCache) {
        await clearCacheForIngredient(rawLine);
    }

    // Check current cache state
    printSection('Pre-Run Cache Check');
    const existingCache = await prisma.validatedMapping.findFirst({
        where: {
            OR: [
                { rawIngredient: rawLine },
                { normalizedForm: { contains: rawLine.split(' ').slice(-2).join(' '), mode: 'insensitive' } },
            ]
        }
    });

    if (existingCache) {
        console.log('  ⚡ Found existing cache entry:');
        console.log(`     Food: ${existingCache.foodName}`);
        console.log(`     ID: ${existingCache.foodId}`);
        console.log(`     Confidence: ${existingCache.aiConfidence}`);
        console.log('\n  This entry may be returned directly without API calls.');
    } else {
        console.log('  No existing cache entry found.');
        console.log('  Full pipeline will run including API calls.');
    }

    // Enable verbose logging for the pipeline
    if (options.verbose) {
        // Logger will show all debug messages
        process.env.LOG_LEVEL = 'debug';
    }

    // Run the ACTUAL production pipeline
    printSection('Running Production Pipeline');
    console.log('  Calling mapIngredientWithFallback()...');
    console.log('  (Watch for log output below)\n');

    const startTime = Date.now();
    const client = new FatSecretClient();

    let result: FatsecretMappedIngredient | null = null;
    try {
        result = await mapIngredientWithFallback(rawLine, client);
    } catch (error) {
        console.log('\n  ❌ Pipeline threw an error:');
        console.log(`     ${(error as Error).message}`);
        console.log(`     Stack: ${(error as Error).stack}`);
        return;
    }

    const duration = Date.now() - startTime;

    // Show results
    printSection('Final Result');

    if (result) {
        console.log('  ✅ SUCCESS\n');
        console.log(`  Food Name:   ${result.foodName}`);
        console.log(`  Brand:       ${result.brandName || '(none)'}`);
        console.log(`  Food ID:     ${result.foodId}`);
        console.log(`  Source:      ${result.source}`);
        console.log(`  Confidence:  ${result.confidence.toFixed(3)}`);
        console.log(`  Quality:     ${result.quality}`);
        console.log('');
        console.log(`  Serving:     ${result.servingDescription}`);
        console.log(`  Grams:       ${result.grams.toFixed(2)}g`);
        console.log(`  Macros:      ${formatMacros(result)}`);
        console.log('');
        console.log(`  Duration:    ${duration}ms`);

        // Flag potential issues
        const flags: string[] = [];
        if (result.confidence < 0.7) flags.push('LOW_CONF');
        if (result.kcal > 500) flags.push('HIGH_KCAL');
        if (result.source === 'cache') flags.push('FROM_CACHE');

        if (flags.length > 0) {
            console.log(`\n  ⚠️  Flags: ${flags.join(', ')}`);
        }
    } else {
        console.log('  ❌ FAILED - No mapping result');
        console.log(`  Duration: ${duration}ms`);
    }

    // Check what was saved to cache
    printSection('Post-Run Cache Check');
    const newCache = await prisma.validatedMapping.findFirst({
        where: {
            OR: [
                { rawIngredient: rawLine },
                { normalizedForm: { contains: rawLine.split(' ').slice(-2).join(' '), mode: 'insensitive' } },
            ]
        },
        orderBy: { createdAt: 'desc' }
    });

    if (newCache) {
        console.log('  Cache entry after run:');
        console.log(`     Food: ${newCache.foodName}`);
        console.log(`     Form: ${newCache.normalizedForm}`);
        console.log(`     Confidence: ${newCache.aiConfidence}`);
        console.log(`     Created: ${newCache.createdAt}`);
    } else {
        console.log('  No cache entry found after run.');
    }

    console.log('\n' + '='.repeat(70));
    console.log('  DEBUG COMPLETE');
    console.log('='.repeat(70) + '\n');
}

// ============================================================
// Main
// ============================================================

async function main() {
    const args = parseArgs();

    if (!args.ingredient) {
        printUsage();
        process.exit(1);
    }

    try {
        await debugFullPipeline(args.ingredient, {
            noCache: args.noCache,
            verbose: args.verbose,
        });
    } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
