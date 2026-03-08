#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';

async function debugIngredient(recipeId: string, ingredientName: string) {
    console.log('\n' + '='.repeat(60));
    console.log(`\n🔍 Debugging Auto-Mapper Pipeline for "${ingredientName}"\n`);

    // Find the ingredient
    const ingredient = await (prisma as any).ingredient.findFirst({
        where: {
            recipeId,
            name: {
                contains: ingredientName,
                mode: 'insensitive'
            }
        },
        include: {
            foodMaps: {
                include: {
                    food: true
                }
            }
        }
    });

    if (!ingredient) {
        console.log(`❌ Ingredient not found in recipe`);
        return;
    }

    console.log(`📋 Found Ingredient:`);
    console.log(`   ID: ${ingredient.id}`);
    console.log(`   Name: "${ingredient.name}"`);
    console.log(`   Qty: ${ingredient.qty} ${ingredient.unit || ''}`);

    // Reconstruct the full line
    const fullLine = `${ingredient.qty}${ingredient.unit ? ' ' + ingredient.unit : ''} ${ingredient.name}`;
    console.log(`   Full Line: "${fullLine}"\n`);

    // Step 1: Parser
    console.log(`📝 Step 1: Parser`);
    const parsed = parseIngredientLine(fullLine);
    console.log(`   Parsed qty: ${parsed?.qty || 'null'}`);
    console.log(`   Parsed unit: "${parsed?.unit || ''}"`);
    console.log(`   Parsed name: "${parsed?.name || fullLine}"\n`);

    // Step 2: Normalization
    console.log(`🧹 Step 2: Normalization`);
    const normalizedResult = normalizeIngredientName(parsed?.name || fullLine);
    console.log(`   Cleaned: "${normalizedResult.cleaned}"`);
    console.log(`   Noun Only: "${normalizedResult.nounOnly}"`);
    console.log(`   Stripped: [${normalizedResult.stripped.join(', ')}]\n`);

    // Step 3: Current Mapping
    console.log(`🗺️  Step 3: Current Mapping`);
    if (ingredient.foodMaps && ingredient.foodMaps.length > 0) {
        const activeMap = ingredient.foodMaps.find((m: any) => m.isActive);
        if (activeMap) {
            console.log(`   ✅ Mapped to: "${activeMap.food?.name || 'Unknown'}"`);
            console.log(`   Food ID: ${activeMap.foodId || activeMap.fatsecretFoodId || 'null'}`);
            console.log(`   Source: ${activeMap.fatsecretFoodId ? 'FatSecret Cache' : 'Legacy Food'}`);
            console.log(`   Confidence: ${(activeMap.confidence * 100).toFixed(1)}%`);

            if (activeMap.food) {
                console.log(`   Macros (per 100g):`);
                console.log(`     ${activeMap.food.protein100}g protein`);
                console.log(`     ${activeMap.food.carbs100}g carbs`);
                console.log(`     ${activeMap.food.fat100}g fat`);
                console.log(`     ${activeMap.food.kcal100} kcal`);
            }
        } else {
            console.log(`   ⚠️  Has mappings but none active`);
        }
    } else {
        console.log(`   ❌ No mapping found`);
    }

    // Step 4: What search query would auto-mapper use?
    console.log(`\n🔍 Step 4: Auto-Mapper Search Query`);
    console.log(`   Would search for: "${normalizedResult.cleaned}"`);
    console.log(`   (Using 'cleaned' from normalization)\n`);

    // Step 5: Check if ground beef leanness detected
    if (/ground\s+beef/i.test(parsed?.name || fullLine)) {
        console.log(`🥩 Ground Beef Detected!`);
        const leannessMatch = fullLine.match(/(\d{2,3})\s*%?\s*(lean|\/)/i);
        if (leannessMatch) {
            const leanPercent = parseInt(leannessMatch[1]);
            console.log(`   Leanness: ${leanPercent}% lean`);
            console.log(`   Target Fat: ${100 - leanPercent}% (${100 - leanPercent}g per 100g)`);
        } else {
            console.log(`   ⚠️  No leanness % detected in line`);
        }
        console.log();
    }

    // Step 6: Check global mapping cache
    console.log(`💾 Step 6: Global Mapping Cache`);
    const globalMapping = await (prisma as any).globalIngredientMapping.findFirst({
        where: {
            normalizedName: normalizedResult.cleaned
        }
    });

    if (globalMapping) {
        console.log(`   ✅ Found in global cache!`);
        console.log(`   Cached as: "${globalMapping.normalizedName}"`);
        console.log(`   Confidence: ${(globalMapping.confidence * 100).toFixed(1)}%`);
        console.log(`   Source: ${globalMapping.source}`);
        console.log(`   Used: ${globalMapping.usageCount}x`);
    } else {
        console.log(`   ❌ Not in global cache`);
        console.log(`   Would need to call FatSecret API`);
    }

    console.log('\n' + '='.repeat(60) + '\n');
}

async function main() {
    const recipeId = process.argv[2];
    const ingredientName = process.argv[3];

    if (!recipeId || !ingredientName) {
        console.log('\n❌ Usage: npx ts-node scripts/debug-ingredient-pipeline.ts <recipeId> <ingredientName>');
        console.log('\nExample:');
        console.log('  npx ts-node scripts/debug-ingredient-pipeline.ts cm3xyz "ground beef"\n');
        process.exit(1);
    }

    await debugIngredient(recipeId, ingredientName);
    await prisma.$disconnect();
}

main().catch(console.error);
