#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

interface MappingReviewOptions {
    minConfidence?: number;
    maxConfidence?: number;
    limit?: number;
    showAll?: boolean;
    sortBy?: 'confidence' | 'recent' | 'ingredient';
}

async function reviewMappings(options: MappingReviewOptions = {}) {
    const {
        minConfidence = 0,
        maxConfidence = 1,
        limit = 100,
        showAll = false,
        sortBy = 'confidence'
    } = options;

    console.log('\n🔍 AI-Validated Mapping Review\n');
    console.log(`Filters: Confidence ${minConfidence}-${maxConfidence}, Limit: ${limit}, Sort: ${sortBy}\n`);

    // Get mappings from IngredientFoodMap with FatSecret details
    const mappings = await prisma.ingredientFoodMap.findMany({
        where: {
            isActive: true,
            fatsecretConfidence: {
                gte: minConfidence,
                lte: maxConfidence,
            },
        },
        include: {
            ingredient: {
                include: {
                    recipe: {
                        select: {
                            id: true,
                            title: true,
                        },
                    },
                },
            },
        },
        orderBy:
            sortBy === 'confidence' ? { fatsecretConfidence: 'asc' } :
                sortBy === 'recent' ? { createdAt: 'desc' } :
                    { ingredient: { name: 'asc' } },
        take: limit,
    });

    if (mappings.length === 0) {
        console.log('❌ No mappings found matching criteria.\n');
        return;
    }

    // Fetch FatSecret food details for mapped items
    const foodIds = [...new Set(mappings.map(m => m.fatsecretFoodId).filter(Boolean))];
    const foods = await prisma.fatSecretFoodCache.findMany({
        where: { id: { in: foodIds as string[] } },
        select: {
            id: true,
            name: true,
            brandName: true,
            foodType: true,
        },
    });

    const foodMap = new Map(foods.map(f => [f.id, f]));

    // Summary stats
    const stats = {
        total: mappings.length,
        high: mappings.filter(m => (m.fatsecretConfidence ?? 0) >= 0.8).length,
        medium: mappings.filter(m => (m.fatsecretConfidence ?? 0) >= 0.6 && (m.fatsecretConfidence ?? 0) < 0.8).length,
        low: mappings.filter(m => (m.fatsecretConfidence ?? 0) < 0.6).length,
        avgConfidence: mappings.reduce((sum, m) => sum + (m.fatsecretConfidence ?? 0), 0) / mappings.length,
    };

    console.log('📊 Summary Statistics:');
    console.log(`  Total Mappings: ${stats.total}`);
    console.log(`  High Confidence (≥0.8): ${stats.high} (${((stats.high / stats.total) * 100).toFixed(1)}%)`);
    console.log(`  Medium Confidence (0.6-0.8): ${stats.medium} (${((stats.medium / stats.total) * 100).toFixed(1)}%)`);
    console.log(`  Low Confidence (<0.6): ${stats.low} (${((stats.low / stats.total) * 100).toFixed(1)}%)`);
    console.log(`  Average Confidence: ${stats.avgConfidence.toFixed(3)}\n`);

    // Display mappings
    console.log('📋 Mapping Details:\n');

    mappings.forEach((mapping, idx) => {
        const food = foodMap.get(mapping.fatsecretFoodId || '');
        const confidence = mapping.fatsecretConfidence ?? 0;
        const confidenceIcon = confidence >= 0.8 ? '✅' : confidence >= 0.6 ? '⚠️' : '🔴';
        const ingredientLine = `${mapping.ingredient.qty || ''} ${mapping.ingredient.unit || ''} ${mapping.ingredient.name}`.trim();

        console.log(`${idx + 1}. ${confidenceIcon} [${confidence.toFixed(3)}] ${ingredientLine}`);
        console.log(`   → ${food?.name || 'Unknown Food'} ${food?.brandName ? `(${food.brandName})` : ''}`);
        console.log(`   Recipe: ${mapping.ingredient.recipe.title}`);
        console.log(`   Grams: ${mapping.fatsecretGrams}g, Source: ${mapping.fatsecretSource || 'unknown'}`);

        if (showAll) {
            console.log(`   Food ID: ${mapping.fatsecretFoodId}`);
            console.log(`   Serving ID: ${mapping.fatsecretServingId}`);
            console.log(`   Ingredient ID: ${mapping.ingredientId}`);
        }

        console.log();
    });

    // Check for ValidatedMapping entries
    const validatedCount = await prisma.validatedMapping.count();
    console.log(`\n💾 Validated Mapping Cache: ${validatedCount} entries\n`);
}

async function main() {
    const args = process.argv.slice(2);

    // Parse command line arguments
    const options: MappingReviewOptions = {
        minConfidence: 0,
        maxConfidence: 1,
        limit: 100,
        showAll: false,
        sortBy: 'confidence',
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '--min' || arg === '-m') {
            options.minConfidence = parseFloat(args[++i]);
        } else if (arg === '--max' || arg === '-M') {
            options.maxConfidence = parseFloat(args[++i]);
        } else if (arg === '--limit' || arg === '-l') {
            options.limit = parseInt(args[++i]);
        } else if (arg === '--all' || arg === '-a') {
            options.showAll = true;
        } else if (arg === '--sort' || arg === '-s') {
            const sort = args[++i];
            if (sort === 'confidence' || sort === 'recent' || sort === 'ingredient') {
                options.sortBy = sort;
            }
        } else if (arg === '--help' || arg === '-h') {
            console.log(`
Usage: npm run review-mappings [options]

Options:
  --min, -m <value>       Minimum confidence (0-1), default: 0
  --max, -M <value>       Maximum confidence (0-1), default: 1
  --limit, -l <number>    Max results to show, default: 100
  --sort, -s <type>       Sort by: confidence|recent|ingredient, default: confidence
  --all, -a               Show all details (IDs, etc.)
  --help, -h              Show this help

Examples:
  npm run review-mappings --min 0.8               # High confidence only
  npm run review-mappings --max 0.6               # Low confidence only
  npm run review-mappings --min 0.6 --max 0.8    # Medium confidence
  npm run review-mappings --sort recent -l 20    # 20 most recent
      `);
            process.exit(0);
        }
    }

    await reviewMappings(options);
    await prisma.$disconnect();
}

if (require.main === module) {
    main().catch((err) => {
        console.error('Error:', err);
        process.exit(1);
    });
}
