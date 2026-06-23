#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

/**
 * Phase 4: Add plural aliases and missing foods
 * 
 * Based on eval failures:
 * 1. Add plural aliases (chicken breasts, salmon fillets, etc.)
 * 2. Add missing foods (heavy cream, sesame oil, fage greek yogurt)
 * 3. Fix portion matching issues
 */

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  
  console.log('🚀 Phase 4: Adding Plural Aliases and Missing Foods');
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN' : '💾 LIVE RUN'}`);
  console.log('=' .repeat(80));
  
  // ============================================================================
  // Part 1: Add Plural Aliases to Existing Foods
  // ============================================================================
  
  console.log('\n📝 Part 1: Adding Plural Aliases\n');
  
  const pluralAliases = [
    // Chicken parts
    { searchName: 'chicken breast', searchBrand: null, aliases: ['chicken breasts', 'boneless skinless chicken breasts'] },
    { searchName: 'chicken, drumstick', searchBrand: null, aliases: ['chicken drumsticks', 'chicken drumstick'] },
    { searchName: 'chicken wing', searchBrand: null, aliases: ['chicken wings'] },
    // Fish
    { searchName: 'salmon', searchBrand: null, aliases: ['salmon fillets', 'salmon fillet'] },
    // Beef
    { searchName: 'ground beef', searchBrand: null, aliases: ['beef patties', 'beef patty'] },
  ];
  
  let addedAliases = 0;
  
  for (const item of pluralAliases) {
    // Find the food
    const food = await prisma.food.findFirst({
      where: {
        name: { contains: item.searchName, mode: 'insensitive' },
        ...(item.searchBrand ? { brand: { equals: item.searchBrand, mode: 'insensitive' } } : {}),
      },
      include: {
        aliases: true,
      },
    });
    
    if (!food) {
      console.log(`  ❌ Food not found: "${item.searchName}"${item.searchBrand ? ` (brand: ${item.searchBrand})` : ''}`);
      continue;
    }
    
    console.log(`  ✅ Found: "${food.name}"${food.brand ? ` (brand: ${food.brand})` : ''}`);
    
    // Check existing aliases
    const existingAliases = food.aliases.map(a => a.alias.toLowerCase());
    
    for (const alias of item.aliases) {
      if (existingAliases.includes(alias.toLowerCase())) {
        console.log(`     ℹ️  Alias "${alias}" already exists`);
        continue;
      }
      
      if (dryRun) {
        console.log(`     🔍 [DRY RUN] Would add alias: "${alias}"`);
      } else {
        await prisma.foodAlias.create({
          data: {
            foodId: food.id,
            alias: alias,
          },
        });
        console.log(`     ➕ Added alias: "${alias}"`);
        addedAliases++;
      }
    }
  }
  
  console.log(`\n✅ Part 1 Complete: ${addedAliases} plural aliases ${dryRun ? 'would be ' : ''}added`);
  
  // ============================================================================
  // Part 2: Add Missing Foods as Templates
  // ============================================================================
  
  console.log('\n📝 Part 2: Adding Missing Foods\n');
  
  const missingFoods = [
    {
      name: 'Heavy Cream',
      aliases: ['heavy cream', 'heavy whipping cream', 'cream, heavy whipping'],
      categoryId: 'dairy',
      kcal100: 340,
      protein100: 2.1,
      carbs100: 2.8,
      fat100: 36,
      fiber100: 0,
      sugar100: 2.8,
      densityGml: 0.99,
    },
    {
      name: 'Sesame Oil',
      aliases: ['sesame oil', 'oil, sesame'],
      categoryId: 'oil',
      kcal100: 884,
      protein100: 0,
      carbs100: 0,
      fat100: 100,
      fiber100: 0,
      sugar100: 0,
      densityGml: 0.92,
    },
    {
      name: 'Greek Yogurt, Plain, Nonfat (Fage)',
      aliases: ['fage greek yogurt', 'fage yogurt', 'greek yogurt plain nonfat'],
      categoryId: 'dairy',
      kcal100: 59,
      protein100: 10.2,
      carbs100: 3.6,
      fat100: 0.4,
      fiber100: 0,
      sugar100: 3.2,
      densityGml: 1.04,
    },
    {
      name: 'Sweet Potato, Mashed',
      aliases: ['sweet potato mashed', 'sweet potato, mashed', 'mashed sweet potato'],
      categoryId: 'veg',
      kcal100: 90,
      protein100: 2,
      carbs100: 21,
      fat100: 0.2,
      fiber100: 3,
      sugar100: 6.5,
      densityGml: 0.8,
    },
  ];
  
  let createdFoods = 0;
  
  for (const food of missingFoods) {
    // Check if food already exists
    const existingFood = await prisma.food.findFirst({
      where: {
        name: { equals: food.name, mode: 'insensitive' },
      },
    });
    
    if (existingFood) {
      console.log(`  ℹ️  Food already exists: "${food.name}"`);
      continue;
    }
    
    if (dryRun) {
      console.log(`  🔍 [DRY RUN] Would create food: "${food.name}"`);
      console.log(`     Category: ${food.categoryId}`);
      console.log(`     Aliases: ${food.aliases.join(', ')}`);
      console.log(`     Macros: ${food.kcal100}kcal, P${food.protein100}g, C${food.carbs100}g, F${food.fat100}g`);
    } else {
      const created = await prisma.food.create({
        data: {
          name: food.name,
          source: 'template',
          verification: 'verified',
          categoryId: food.categoryId,
          kcal100: food.kcal100,
          protein100: food.protein100,
          carbs100: food.carbs100,
          fat100: food.fat100,
          fiber100: food.fiber100,
          sugar100: food.sugar100,
          densityGml: food.densityGml,
        },
      });
      
      // Add aliases
      for (const alias of food.aliases) {
        await prisma.foodAlias.create({
          data: {
            foodId: created.id,
            alias: alias,
          },
        });
      }
      
      console.log(`  ✅ Created: "${food.name}" with ${food.aliases.length} aliases`);
      createdFoods++;
    }
  }
  
  console.log(`\n✅ Part 2 Complete: ${createdFoods} foods ${dryRun ? 'would be ' : ''}created`);
  
  // ============================================================================
  // Summary
  // ============================================================================
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 Summary:');
  console.log(`  Plural aliases ${dryRun ? 'to be ' : ''}added: ${addedAliases}`);
  console.log(`  Missing foods ${dryRun ? 'to be ' : ''}created: ${createdFoods}`);
  console.log('='.repeat(80));
  
  if (dryRun) {
    console.log('\n✅ Dry run complete. Run without --dry-run to apply changes.');
  } else {
    console.log('\n✅ All changes applied successfully!');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });

