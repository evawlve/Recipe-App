#!/usr/bin/env ts-node
/**
 * Debug script to investigate candidate sources for failing "watch for" cases
 * This will show what each API returns and where scoring is going wrong
 */

import 'dotenv/config';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';
import { gatherCandidates, type GatherOptions } from '../src/lib/fatsecret/gather-candidates';
import { filterCandidatesByTokens } from '../src/lib/fatsecret/filter-candidates';
import { getValidatedMapping } from '../src/lib/fatsecret/validated-mapping-helpers';
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { prisma } from '../src/lib/db';

const client = new FatSecretClient();

const FAILING_CASES = [
    '1 slice mixed seeds bread',
    '0.25 cup nonfat Italian dressing',
    '4 medium potatoes',
    '2 cups diced potatoes',
    '1 cup cooked lentils',
];

async function investigateCase(rawLine: string) {
    console.log('\n' + '='.repeat(80));
    console.log(`\n🔍 INVESTIGATING: "${rawLine}"\n`);
    console.log('='.repeat(80));

    // Step 1: Parse and normalize
    const parsed = parseIngredientLine(rawLine);
    const baseName = parsed?.name || rawLine;
    const normalized = normalizeIngredientName(baseName).cleaned || baseName;

    console.log('\n📝 Parsing:');
    console.log(`   Raw: "${rawLine}"`);
    console.log(`   Parsed name: "${parsed?.name}"`);
    console.log(`   Normalized: "${normalized}"`);
    console.log(`   Qty: ${parsed?.qty}, Unit: ${parsed?.unit}`);

    // Step 2: Check if there's a validated cache hit
    console.log('\n📦 Cache checks:');

    const rawCacheHit = await getValidatedMapping(rawLine);
    if (rawCacheHit) {
        console.log(`   ⚠️  ValidatedMapping CACHE HIT for raw line:`);
        console.log(`      → foodId: ${rawCacheHit.foodId}`);
        console.log(`      → foodName: "${rawCacheHit.foodName}"`);
        console.log(`      → confidence: ${rawCacheHit.confidence}`);
        console.log(`   🚨 THIS IS WHY WE'RE GETTING THIS RESULT - early exit from cache!`);
    } else {
        console.log(`   ✓ No ValidatedMapping cache hit for raw line`);
    }

    const normalizedCacheHit = await getValidatedMapping(normalized);
    if (normalizedCacheHit) {
        console.log(`   ⚠️  ValidatedMapping CACHE HIT for normalized name "${normalized}":`);
        console.log(`      → foodId: ${normalizedCacheHit.foodId}`);
        console.log(`      → foodName: "${normalizedCacheHit.foodName}"`);
        console.log(`      → confidence: ${normalizedCacheHit.confidence}`);
    } else {
        console.log(`   ✓ No ValidatedMapping cache hit for normalized name`);
    }

    // Step 3: Gather all candidates (bypassing cache)
    console.log('\n🔎 Gathering candidates from all sources (bypassing cache)...');

    const gatherOptions: GatherOptions = {
        client,
        skipCache: false, // We want to see what cache returns
        skipLiveApi: false,
        skipFdc: false,
    };

    const allCandidates = await gatherCandidates(rawLine, parsed, normalized, gatherOptions);

    // Group by source
    const bySource = {
        cache: allCandidates.filter(c => c.source === 'cache'),
        fatsecret: allCandidates.filter(c => c.source === 'fatsecret'),
        fdc: allCandidates.filter(c => c.source === 'fdc'),
    };

    console.log(`\n📊 Candidates by source:`);
    console.log(`   Cache: ${bySource.cache.length} candidates`);
    console.log(`   FatSecret API: ${bySource.fatsecret.length} candidates`);
    console.log(`   FDC: ${bySource.fdc.length} candidates`);

    // Show top 5 from each source
    for (const [source, candidates] of Object.entries(bySource)) {
        if (candidates.length === 0) continue;

        console.log(`\n   === ${source.toUpperCase()} Top 5 ===`);
        for (const c of candidates.slice(0, 5)) {
            const brand = c.brandName ? ` (${c.brandName})` : '';
            const nutrition = c.nutrition
                ? ` | ${c.nutrition.kcal}kcal F:${c.nutrition.fat}g`
                : '';
            console.log(`      [${c.score.toFixed(3)}] "${c.name}"${brand}${nutrition}`);
        }
    }

    // Step 4: Apply token filter
    console.log('\n🔧 After token filtering:');
    const filterResult = filterCandidatesByTokens(allCandidates, normalized, { debug: false, rawLine });
    console.log(`   Before: ${allCandidates.length}, After: ${filterResult.filtered.length}, Removed: ${filterResult.removedCount}`);

    // Show top 10 filtered candidates
    console.log('\n   Top 10 filtered candidates (all sources combined):');
    const sorted = [...filterResult.filtered].sort((a, b) => b.score - a.score);
    for (const c of sorted.slice(0, 10)) {
        const brand = c.brandName ? ` (${c.brandName})` : '';
        const nutrition = c.nutrition
            ? ` | ${c.nutrition.kcal}kcal F:${c.nutrition.fat}g`
            : '';
        console.log(`      [${c.score.toFixed(3)}] [${c.source}] "${c.name}"${brand}${nutrition}`);
    }

    // Step 5: Check FatSecretFoodCache for the problematic food
    if (rawCacheHit || normalizedCacheHit) {
        const cacheHit = rawCacheHit || normalizedCacheHit;
        console.log('\n🗄️  FatSecretFoodCache entry for cached food:');
        const cachedFood = await prisma.fatSecretFoodCache.findFirst({
            where: { id: cacheHit!.foodId },
            include: { servings: true }
        });
        if (cachedFood) {
            console.log(`   Name: "${cachedFood.name}"`);
            console.log(`   Brand: "${cachedFood.brandName || 'none'}"`);
            console.log(`   Food Type: ${cachedFood.foodType}`);
            if (cachedFood.nutrientsPer100g) {
                const n = cachedFood.nutrientsPer100g as { calories?: number; fat?: number };
                console.log(`   Nutrients/100g: ${n.calories}kcal, ${n.fat}g fat`);
            }
            console.log(`   Servings count: ${cachedFood.servings.length}`);
        }
    }
}

async function main() {
    console.log('\n🧪 Investigating Failing "Watch For" Cases\n');
    console.log('This will show what candidates come from each API and why bad ones are selected.\n');

    for (const testCase of FAILING_CASES) {
        await investigateCase(testCase);
    }

    console.log('\n\n' + '='.repeat(80));
    console.log('INVESTIGATION COMPLETE');
    console.log('='.repeat(80));
}

main()
    .catch((error) => {
        console.error('Error:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
