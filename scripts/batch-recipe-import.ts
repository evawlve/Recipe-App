#!/usr/bin/env ts-node

import 'dotenv/config';
import fs from 'node:fs';
import { prisma } from '../src/lib/db';
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { autoMapIngredients } from '../src/lib/nutrition/auto-map';

const KEYWORDS = [
    // High protein combinations
    'high protein breakfast', 'high protein lunch', 'high protein dinner',
    'high protein salad', 'high protein soup', 'high protein snack',
    // Healthy cuisine styles
    'healthy asian', 'healthy mexican', 'healthy italian',
    // Diet-focused
    'low calorie dinner', 'low carb breakfast', 'lean protein meal',
    // Specific healthy foods
    'grilled chicken', 'salmon bowl', 'quinoa salad'
];
const RECIPES_PER_KEYWORD = 10;
const AUTHOR_ID = process.env.IMPORT_AUTHOR_ID || '279a6119-a377-42b4-9ee9-1f08169a8e71';

async function main() {
    const client = new FatSecretClient();
    const logFile = `batch-import-log-${Date.now()}.json`;
    const results: any[] = [];

    console.log(`Starting batch import with keywords: ${KEYWORDS.join(', ')}`);
    console.log(`Target: ${RECIPES_PER_KEYWORD} recipes per keyword`);
    console.log(`Logs will be saved to: ${logFile}\n`);

    for (const keyword of KEYWORDS) {
        console.log(`\n=== Importing recipes for keyword: "${keyword}" ===`);

        try {
            const recipes = await client.searchRecipes(keyword, RECIPES_PER_KEYWORD);
            console.log(`Found ${recipes.length} recipes for "${keyword}"`);

            for (const summary of recipes) {
                let details = await client.getRecipeDetails(summary.id);
                if (!details) {
                    console.log(`Using search payload for recipe ${summary.id} (details unavailable)`);
                    details = {
                        id: summary.id,
                        name: summary.name,
                        description: summary.description ?? null,
                        servings: summary.servings ?? null,
                        ingredients: summary.ingredients ?? [],
                        directions: null,
                    };
                }

                const title = details.name || summary.name || 'FatSecret Recipe';
                const description = details.description ?? summary.description ?? '';
                const servings = Number(details.servings ?? summary.servings ?? 1) || 1;
                const ingredients: string[] = (details.ingredients ?? summary.ingredients ?? []).filter(Boolean);

                if (ingredients.length === 0) {
                    console.log(`Skipping recipe "${title}" - no ingredients`);
                    continue;
                }

                const created = await prisma.recipe.create({
                    data: {
                        authorId: AUTHOR_ID,
                        title: `[${keyword}] ${title}`,
                        bodyMd: description || title,
                        servings,
                    },
                });

                for (const ingredientLine of ingredients) {
                    if (!ingredientLine) continue;
                    const parsed = parseIngredientLine(ingredientLine);
                    const qty = parsed?.qty ?? 1;
                    const unit = parsed?.unit ?? '';
                    const name = parsed?.name ?? ingredientLine;
                    await prisma.ingredient.create({
                        data: {
                            recipeId: created.id,
                            name,
                            qty,
                            unit,
                        },
                    });
                }

                console.log(`Created recipe ${created.id}: "${title}" (${ingredients.length} ingredients)`);
                // console.log(`Auto-mapping ingredients...`);
                // const mapResult = await autoMapIngredients(created.id);
                const mapResult = 0; // Skipped for pilot

                results.push({
                    keyword,
                    recipeId: created.id,
                    title,
                    ingredientCount: ingredients.length,
                    mapResult,
                    timestamp: new Date().toISOString(),
                });

                console.log(`✓ Completed: ${created.id}`);
            }
        } catch (error) {
            console.error(`Error importing recipes for "${keyword}":`, error);
            results.push({
                keyword,
                error: (error as Error).message,
                timestamp: new Date().toISOString(),
            });
        }
    }

    fs.writeFileSync(logFile, JSON.stringify(results, null, 2), 'utf8');
    console.log(`\n✅ Batch import complete. Results saved to: ${logFile}`);
    console.log(`Total recipes imported: ${results.filter(r => r.recipeId).length}`);
}

main()
    .catch((error) => {
        console.error('batch-recipe-import failed', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
