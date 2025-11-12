#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

/**
 * Phase C: Add missing foods causing NO MATCH failures
 * - Protein powders
 * - Tofu aliases  
 * - Cashews
 * - Other missing foods from eval
 */

const MISSING_FOODS = [
  // Protein powders
  {
    id: 'phase_c_casein_protein',
    name: 'Protein Powder, Casein',
    categoryId: 'whey',
    source: 'template' as const,
    kcal100: 354,
    protein100: 79,
    carbs100: 4,
    fat100: 2,
    densityGml: 0.5, // typical protein powder density
    aliases: ['casein protein', 'casein powder', 'casein protein powder'],
    units: [
      { label: '1 scoop', grams: 30 },
      { label: 'scoop', grams: 30 },
      { label: '1 cup', grams: 120 }
    ]
  },
  {
    id: 'phase_c_plant_protein',
    name: 'Protein Powder, Plant-Based',
    categoryId: 'whey',
    source: 'template' as const,
    kcal100: 400,
    protein100: 67,
    carbs100: 20,
    fat100: 6,
    densityGml: 0.5,
    aliases: ['plant protein', 'plant-based protein', 'plant protein powder', 'vegan protein', 'pea protein'],
    units: [
      { label: '1 scoop', grams: 30 },
      { label: 'scoop', grams: 30 },
      { label: '1 cup', grams: 120 }
    ]
  },
  // Tofu variations
  {
    id: 'phase_c_tofu_cubed',
    name: 'Tofu, Firm, Cubed',
    categoryId: 'legume',
    source: 'template' as const,
    kcal100: 144,
    protein100: 17.3,
    carbs100: 3.5,
    fat100: 8.7,
    densityGml: 1.05,
    aliases: ['tofu cubed', 'tofu, cubed', 'firm tofu cubed', 'firm tofu, cubed', 'cubed tofu'],
    units: [
      { label: '1 cup', grams: 126 },
      { label: 'cup', grams: 126 },
      { label: '1 piece', grams: 85 }
    ]
  },
  // Cashews
  {
    id: 'phase_c_cashews',
    name: 'Nuts, Cashews, Raw',
    categoryId: 'nut',
    source: 'template' as const,
    kcal100: 553,
    protein100: 18.2,
    carbs100: 30.2,
    fat100: 43.8,
    densityGml: 0.6,
    aliases: ['cashews', 'cashew nuts', 'raw cashews'],
    units: [
      { label: '1 cup', grams: 120 },
      { label: 'cup', grams: 120 },
      { label: '1 oz', grams: 28 }
    ]
  }
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  
  console.log('🔧 Phase C: Adding Missing Foods\n');
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN' : '💾 LIVE RUN'}`);
  console.log('=' .repeat(80));
  
  let added = 0;
  let skipped = 0;
  
  for (const food of MISSING_FOODS) {
    console.log(`\n📝 ${food.name}`);
    
    // Check if food already exists
    const existing = await prisma.food.findUnique({
      where: { id: food.id }
    });
    
    if (existing) {
      console.log(`   ⏭️  Already exists`);
      skipped++;
      continue;
    }
    
    if (dryRun) {
      console.log(`   🔍 Would create:`);
      console.log(`      - Category: ${food.categoryId}`);
      console.log(`      - Nutrition: ${food.kcal100}kcal, ${food.protein100}g protein`);
      console.log(`      - Aliases: ${food.aliases.length}`);
      console.log(`      - Units: ${food.units.length}`);
    } else {
      // Create food
      await prisma.food.create({
        data: {
          id: food.id,
          name: food.name,
          categoryId: food.categoryId,
          source: food.source,
          verification: 'verified',
          kcal100: food.kcal100,
          protein100: food.protein100,
          carbs100: food.carbs100,
          fat100: food.fat100,
          densityGml: food.densityGml
        }
      });
      
      // Add aliases
      for (const alias of food.aliases) {
        await prisma.foodAlias.create({
          data: {
            foodId: food.id,
            alias: alias
          }
        });
      }
      
      // Add units
      for (const unit of food.units) {
        await prisma.foodUnit.create({
          data: {
            foodId: food.id,
            label: unit.label,
            grams: unit.grams
          }
        });
      }
      
      added++;
      console.log(`   ✅ Created with ${food.aliases.length} aliases and ${food.units.length} units`);
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 Summary:');
  console.log(`   ✅ Foods added: ${added}`);
  console.log(`   ⏭️  Foods skipped: ${skipped}`);
  
  if (dryRun) {
    console.log('\n💡 Run without --dry-run to apply changes');
  } else {
    console.log('\n✅ Foods added!');
    console.log('\n🧪 Next Steps:');
    console.log('   1. Run: npm run eval');
    console.log('   2. Expected: +1.5-2pp improvement (83% → 84.5-85%)');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

