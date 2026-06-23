#!/usr/bin/env ts-node

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/db';
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { autoMapIngredients } from '../src/lib/nutrition/auto-map';

interface CliOptions {
  query: string;
  maxResults: number;
  authorId: string;
  dump?: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let query = '';
  let maxResults = 3;
  let authorId = '';
  let dump: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--query' && args[i + 1]) {
      query = args[i + 1];
      i += 1;
    } else if (arg.startsWith('--query=')) {
      query = arg.split('=')[1];
    } else if (arg === '--max-results' && args[i + 1]) {
      maxResults = Number(args[i + 1]) || maxResults;
      i += 1;
    } else if (arg.startsWith('--max-results=')) {
      maxResults = Number(arg.split('=')[1]) || maxResults;
    } else if (arg === '--author-id' && args[i + 1]) {
      authorId = args[i + 1];
      i += 1;
    } else if (arg.startsWith('--author-id=')) {
      authorId = arg.split('=')[1];
    } else if (arg === '--dump' && args[i + 1]) {
      dump = args[i + 1];
      i += 1;
    } else if (arg.startsWith('--dump=')) {
      dump = arg.split('=')[1];
    }
  }
  if (!query) throw new Error('Provide --query');
  if (!authorId) throw new Error('Provide --author-id (user id for recipe ownership)');
  return { query, maxResults, authorId, dump };
}

async function main() {
  const options = parseArgs();
  const client = new FatSecretClient();

  const recipes = await client.searchRecipes(options.query, options.maxResults);

  if (options.dump) {
    const dumpPath = path.resolve(options.dump);
    fs.writeFileSync(dumpPath, JSON.stringify(recipes, null, 2), 'utf8');
    console.log(`Dumped recipes to ${dumpPath}`);
  }

  const fallbackIngredients = [
    '1 cup chicken broth',
    '100 g chicken breast',
    '1 tbsp olive oil',
    '1 cup cooked rice',
  ];

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
      ingredients.push(...fallbackIngredients);
    }

    const created = await prisma.recipe.create({
      data: {
        authorId: options.authorId,
        title,
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

    await autoMapIngredients(created.id);
    console.log(`Imported recipe ${created.id}: ${title} (${ingredients.length} ingredients)`);
  }
}

main()
  .catch((error) => {
    console.error('fatsecret-recipe-import failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
