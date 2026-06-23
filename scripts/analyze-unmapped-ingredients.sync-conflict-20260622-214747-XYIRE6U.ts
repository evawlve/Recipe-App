#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';
import fs from 'node:fs';

interface FailurePattern {
    ingredient: string;
    count: number;
    recipeIds: string[];
    recipeTitles: string[];
}

async function main() {
    console.log('\n🔍 Analyzing Auto-Map Failures Across All Recipes\n');

    // Get all recipes
    const recipes = await prisma.recipe.findMany({
        include: {
            ingredients: {
                include: {
                    foodMaps: true
                }
            }
        }
    });

    console.log(`Found ${recipes.length} recipes to analyze\n`);

    const unmappedPatterns = new Map<string, FailurePattern>();
    let totalIngredients = 0;
    let totalUnmapped = 0;
    let recipesWithUnmapped = 0;

    for (const recipe of recipes) {
        let hasUnmapped = false;

        for (const ingredient of recipe.ingredients) {
            totalIngredients++;

            // Check if ingredient is unmapped (no foodMaps or all foodMaps have no foodId/fatsecretFoodId/fdcId)
            const isMapped = ingredient.foodMaps.some(m =>
                m.foodId || (m as any).fatsecretFoodId || (m as any).fdcId
            );

            if (!isMapped) {
                totalUnmapped++;
                hasUnmapped = true;

                const key = ingredient.name.toLowerCase().trim();

                if (!unmappedPatterns.has(key)) {
                    unmappedPatterns.set(key, {
                        ingredient: ingredient.name,
                        count: 0,
                        recipeIds: [],
                        recipeTitles: []
                    });
                }

                const pattern = unmappedPatterns.get(key)!;
                pattern.count++;
                pattern.recipeIds.push(recipe.id);
                pattern.recipeTitles.push(recipe.title);
            }
        }

        if (hasUnmapped) recipesWithUnmapped++;
    }

    // Sort by frequency
    const sortedPatterns = Array.from(unmappedPatterns.values())
        .sort((a, b) => b.count - a.count);

    // Summary
    console.log('📊 Summary:');
    console.log(`  Total recipes: ${recipes.length}`);
    console.log(`  Recipes with unmapped ingredients: ${recipesWithUnmapped}`);
    console.log(`  Total ingredients: ${totalIngredients}`);
    console.log(`  Unmapped ingredients: ${totalUnmapped}`);
    console.log(`  Mapping success rate: ${((1 - totalUnmapped / totalIngredients) * 100).toFixed(1)}%`);
    console.log(`  Unique unmapped ingredient patterns: ${sortedPatterns.length}\n`);

    // Top failures
    console.log('🔥 Top 20 Most Common Unmapped Ingredients:\n');
    sortedPatterns.slice(0, 20).forEach((p, i) => {
        console.log(`${i + 1}. "${p.ingredient}" - ${p.count} occurrences`);
    });

    // Export detailed report
    const report = {
        summary: {
            totalRecipes: recipes.length,
            recipesWithUnmapped,
            totalIngredients,
            unmappedIngredients: totalUnmapped,
            mappingSuccessRate: ((1 - totalUnmapped / totalIngredients) * 100).toFixed(1) + '%',
            uniqueUnmappedPatterns: sortedPatterns.length
        },
        topFailures: sortedPatterns.slice(0, 50).map(p => ({
            ingredient: p.ingredient,
            occurrences: p.count,
            exampleRecipes: p.recipeTitles.slice(0, 3),
            recipeIds: p.recipeIds.slice(0, 3)
        })),
        allFailures: sortedPatterns
    };

    const reportPath = 'unmapped-ingredients-analysis.json';
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`\n✅ Detailed report saved to: ${reportPath}`);

    // Categorize failures
    console.log('\n📋 Failure Categories:\n');

    const categories = {
        likely_typos: [] as string[],
        very_specific: [] as string[], // long ingredient names with lots of modifiers
        branded: [] as string[], // might contain brand names
        measurements_in_name: [] as string[], // contains cup, tbsp, etc in the name
        short_generic: [] as string[], // very short, generic terms
    };

    for (const p of sortedPatterns.slice(0, 50)) {
        const name = p.ingredient.toLowerCase();

        if (name.length <= 4) {
            categories.short_generic.push(p.ingredient);
        } else if (name.includes('cup') || name.includes('tbsp') || name.includes('tsp') ||
            name.includes('tablespoon') || name.includes('teaspoon')) {
            categories.measurements_in_name.push(p.ingredient);
        } else if (name.split(' ').length >= 5) {
            categories.very_specific.push(p.ingredient);
        } else if (/[A-Z][a-z]+[A-Z]/.test(p.ingredient) ||
            ['®', '™', 'brand'].some(s => name.includes(s))) {
            categories.branded.push(p.ingredient);
        }
    }

    if (categories.short_generic.length > 0) {
        console.log(`  Short/Generic (${categories.short_generic.length}):`);
        categories.short_generic.slice(0, 5).forEach(i => console.log(`    - ${i}`));
    }

    if (categories.measurements_in_name.length > 0) {
        console.log(`\n  Measurements in Name (${categories.measurements_in_name.length}):`);
        categories.measurements_in_name.slice(0, 5).forEach(i => console.log(`    - ${i}`));
    }

    if (categories.very_specific.length > 0) {
        console.log(`\n  Very Specific/Complex (${categories.very_specific.length}):`);
        categories.very_specific.slice(0, 5).forEach(i => console.log(`    - ${i}`));
    }

    if (categories.branded.length > 0) {
        console.log(`\n  Possibly Branded (${categories.branded.length}):`);
        categories.branded.slice(0, 5).forEach(i => console.log(`    - ${i}`));
    }

    console.log('\n💡 Suggested Actions:');
    console.log('  1. Review top failures for potential aliases to add');
    console.log('  2. Check if ingredient parser is correctly extracting names');
    console.log('  3. Consider adding more fuzzy matching for close variants');
    console.log('  4. Add brand-to-generic mappings for common branded items');
}

main()
    .catch((error) => {
        console.error('Error:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
