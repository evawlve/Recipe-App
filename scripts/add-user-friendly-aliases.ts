#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

/**
 * Add user-friendly aliases to existing foods with technical USDA names
 * Also creates missing template foods for critical ingredients
 */

type AliasPair = {
  searchPattern: string; // Pattern to find existing food
  aliases: string[]; // User-friendly aliases to add
};

type TemplateFoodCreate = {
  name: string;
  aliases: string[];
  categoryId: string;
  kcal100: number;
  protein100: number;
  carbs100: number;
  fat100: number;
  fiber100?: number;
  sugar100?: number;
  densityGml?: number;
};

// Aliases for existing foods with USDA names
const ALIAS_PAIRS: AliasPair[] = [
  // Chicken broths (recently imported)
  { 
    searchPattern: 'chicken broth, canned, condensed',
    aliases: ['chicken broth', 'chicken stock', 'chicken bouillon']
  },
  {
    searchPattern: 'beef broth bouillon and consomme',
    aliases: ['beef broth', 'beef stock', 'beef bouillon']
  },
  {
    searchPattern: 'soy sauce made from',
    aliases: ['soy sauce', 'shoyu']
  },
  // Existing chicken thigh
  {
    searchPattern: 'Chicken Thigh',
    aliases: ['chicken thighs', 'chicken thigh'] // Add plural
  },
];

// Template foods to create (for missing critical ingredients)
const TEMPLATE_FOODS: TemplateFoodCreate[] = [
  {
    name: 'Ketchup',
    aliases: ['ketchup', 'catsup', 'tomato ketchup'],
    categoryId: 'sauce',
    kcal100: 101,
    protein100: 1.0,
    carbs100: 27.4,
    fat100: 0.1,
    fiber100: 0.3,
    sugar100: 22.7,
    densityGml: 1.07, // ~1070 g/L
  },
  {
    name: 'Vinegar, Distilled',
    aliases: ['vinegar', 'white vinegar', 'distilled vinegar'],
    categoryId: 'sauce',
    kcal100: 18,
    protein100: 0.0,
    carbs100: 0.04,
    fat100: 0.0,
    densityGml: 1.01,
  },
  {
    name: 'Sriracha Sauce',
    aliases: ['sriracha', 'sriracha sauce', 'sriracha hot sauce'],
    categoryId: 'sauce',
    kcal100: 93,
    protein100: 1.8,
    carbs100: 19.6,
    fat100: 0.5,
    sugar100: 17.9,
    densityGml: 1.1,
  },
  {
    name: 'Baking Powder',
    aliases: ['baking powder', 'double-acting baking powder'],
    categoryId: 'other',
    kcal100: 53,
    protein100: 0.0,
    carbs100: 27.7,
    fat100: 0.0,
    densityGml: 0.9,
  },
  {
    name: 'Baking Soda',
    aliases: ['baking soda', 'sodium bicarbonate', 'bicarbonate of soda'],
    categoryId: 'other',
    kcal100: 0,
    protein100: 0.0,
    carbs100: 0.0,
    fat100: 0.0,
    densityGml: 2.2,
  },
  {
    name: 'Vanilla Extract',
    aliases: ['vanilla extract', 'vanilla', 'pure vanilla extract'],
    categoryId: 'other',
    kcal100: 288,
    protein100: 0.1,
    carbs100: 12.7,
    fat100: 0.1,
    sugar100: 12.7,
    densityGml: 0.88,
  },
  {
    name: 'Rice Vinegar',
    aliases: ['rice vinegar', 'rice wine vinegar', 'seasoned rice vinegar'],
    categoryId: 'sauce',
    kcal100: 18,
    protein100: 0.3,
    carbs100: 7.8,
    fat100: 0.0,
    sugar100: 2.0,
    densityGml: 1.02,
  },
  {
    name: 'Fish Sauce',
    aliases: ['fish sauce', 'nam pla', 'nuoc mam'],
    categoryId: 'sauce',
    kcal100: 35,
    protein100: 5.1,
    carbs100: 3.8,
    fat100: 0.0,
    sugar100: 0.0,
    densityGml: 1.15,
  },
  {
    name: 'Coconut Milk',
    aliases: ['coconut milk', 'coconut cream', 'canned coconut milk'],
    categoryId: 'dairy', // Or 'other'
    kcal100: 230,
    protein100: 2.3,
    carbs100: 6.0,
    fat100: 24.0,
    fiber100: 2.2,
    sugar100: 3.3,
    densityGml: 0.98,
  },
  {
    name: 'Miso Paste',
    aliases: ['miso', 'miso paste', 'soybean paste'],
    categoryId: 'legume',
    kcal100: 199,
    protein100: 12.8,
    carbs100: 25.9,
    fat100: 6.0,
    fiber100: 5.4,
    sugar100: 6.2,
    densityGml: 1.2,
  },
  {
    name: 'Mirin',
    aliases: ['mirin', 'sweet rice wine', 'rice wine'],
    categoryId: 'sauce',
    kcal100: 241,
    protein100: 0.2,
    carbs100: 43.2,
    fat100: 0.0,
    sugar100: 40.0,
    densityGml: 1.12,
  },
  {
    name: 'Gochujang',
    aliases: ['gochujang', 'korean chili paste', 'korean red pepper paste'],
    categoryId: 'sauce',
    kcal100: 139,
    protein100: 5.7,
    carbs100: 28.5,
    fat100: 0.7,
    fiber100: 2.7,
    sugar100: 16.0,
    densityGml: 1.25,
  },
  {
    name: 'Gochugaru',
    aliases: ['gochugaru', 'korean chili powder', 'korean red pepper flakes'],
    categoryId: 'other',
    kcal100: 282,
    protein100: 12.0,
    carbs100: 56.6,
    fat100: 5.1,
    fiber100: 28.7,
    sugar100: 22.0,
    densityGml: 0.5,
  },
  {
    name: 'Curry Paste',
    aliases: ['curry paste', 'thai curry paste', 'red curry paste', 'green curry paste'],
    categoryId: 'sauce',
    kcal100: 110,
    protein100: 3.0,
    carbs100: 18.0,
    fat100: 3.5,
    fiber100: 2.0,
    densityGml: 1.15,
  },
];

async function addUserFriendlyAliases(dryRun: boolean = false) {
  console.log('🔧 User-Friendly Aliases & Template Foods Script');
  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No data will be modified');
  }
  console.log('');

  let aliasesAdded = 0;
  let aliasesSkipped = 0;
  let foodsCreated = 0;
  let foodsSkipped = 0;

  // PART 1: Add aliases to existing foods
  console.log('📋 PART 1: Adding Aliases to Existing Foods');
  console.log('='.repeat(80));

  for (const pair of ALIAS_PAIRS) {
    console.log(`\nSearching for: "${pair.searchPattern}"`);
    
    const food = await prisma.food.findFirst({
      where: {
        name: {
          contains: pair.searchPattern,
          mode: 'insensitive',
        },
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (!food) {
      console.log(`  ⚠️  Food not found, skipping`);
      continue;
    }

    console.log(`  ✅ Found: ${food.name}`);
    console.log(`  Adding ${pair.aliases.length} alias(es): ${pair.aliases.join(', ')}`);

    for (const alias of pair.aliases) {
      const existing = await prisma.foodAlias.findFirst({
        where: {
          foodId: food.id,
          alias: {
            equals: alias,
            mode: 'insensitive',
          },
        },
      });

      if (existing) {
        console.log(`     • "${alias}" - already exists`);
        aliasesSkipped++;
        continue;
      }

      if (!dryRun) {
        await prisma.foodAlias.create({
          data: {
            foodId: food.id,
            alias: alias.toLowerCase(),
          },
        });
      }

      console.log(`     • "${alias}" - ${dryRun ? 'would add' : 'added'} ✅`);
      aliasesAdded++;
    }
  }

  // PART 2: Create template foods
  console.log('\n\n📦 PART 2: Creating Template Foods for Missing Ingredients');
  console.log('='.repeat(80));

  for (const template of TEMPLATE_FOODS) {
    console.log(`\nChecking: "${template.name}"`);

    // Check if food already exists
    const existing = await prisma.food.findFirst({
      where: {
        name: {
          equals: template.name,
          mode: 'insensitive',
        },
      },
    });

    if (existing) {
      console.log(`  ⚠️  Food already exists, skipping`);
      foodsSkipped++;
      continue;
    }

    if (!dryRun) {
      // Create food
      const food = await prisma.food.create({
        data: {
          name: template.name,
          source: 'template',
          verification: 'verified',
          categoryId: template.categoryId,
          kcal100: template.kcal100,
          protein100: template.protein100,
          carbs100: template.carbs100,
          fat100: template.fat100,
          fiber100: template.fiber100 ?? 0,
          sugar100: template.sugar100 ?? 0,
          densityGml: template.densityGml,
          popularity: 0,
        },
      });

      // Add aliases
      for (const alias of template.aliases) {
        await prisma.foodAlias.create({
          data: {
            foodId: food.id,
            alias: alias.toLowerCase(),
          },
        });
      }

      console.log(`  ✅ Created food with ${template.aliases.length} alias(es)`);
      foodsCreated++;
    } else {
      console.log(`  ✅ Would create with ${template.aliases.length} alias(es): ${template.aliases.join(', ')}`);
      foodsCreated++;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('📊 Summary:');
  console.log(`  Aliases added: ${aliasesAdded}`);
  console.log(`  Aliases skipped (existing): ${aliasesSkipped}`);
  console.log(`  Template foods created: ${foodsCreated}`);
  console.log(`  Template foods skipped (existing): ${foodsSkipped}`);
  console.log('');

  if (dryRun) {
    console.log('🔍 This was a DRY RUN. Run without --dry-run to apply changes.');
  } else {
    console.log('✅ All changes applied successfully!');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  try {
    await addUserFriendlyAliases(dryRun);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

