#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

/**
 * Phase D: Add critical missing foods causing major failures
 * - Salt
 * - Oat milk
 * - Half and half
 * - Soy milk
 * - Almond milk
 */

const CRITICAL_FOODS = [
  // Salt
  {
    id: 'phase_d_salt',
    name: 'Salt, Table',
    categoryId: 'condiment',
    source: 'template' as const,
    kcal100: 0,
    protein100: 0,
    carbs100: 0,
    fat100: 0,
    densityGml: 1.2, // salt density
    aliases: ['salt', 'table salt', 'sea salt', 'kosher salt'],
    units: [
      { label: '1 tsp', grams: 6 },
      { label: 'tsp', grams: 6 },
      { label: '1 tbsp', grams: 18 },
      { label: 'tbsp', grams: 18 },
      { label: '1 cup', grams: 288 },
      { label: 'cup', grams: 288 }
    ]
  },
  // Oat Milk
  {
    id: 'phase_d_oat_milk',
    name: 'Oat Milk, Unsweetened',
    categoryId: 'dairy',
    source: 'template' as const,
    kcal100: 42,
    protein100: 1,
    carbs100: 6.5,
    fat100: 1.5,
    densityGml: 1.0,
    aliases: ['oat milk', 'oatmilk'],
    units: [
      { label: '1 cup', grams: 240 },
      { label: 'cup', grams: 240 },
      { label: '1 tbsp', grams: 15 },
      { label: '1 fl oz', grams: 30 }
    ]
  },
  // Soy Milk
  {
    id: 'phase_d_soy_milk',
    name: 'Soy Milk, Unsweetened',
    categoryId: 'dairy',
    source: 'template' as const,
    kcal100: 33,
    protein100: 2.9,
    carbs100: 1.2,
    fat100: 1.8,
    densityGml: 1.03,
    aliases: ['soy milk', 'soymilk', 'soya milk'],
    units: [
      { label: '1 cup', grams: 240 },
      { label: 'cup', grams: 240 },
      { label: '1 tbsp', grams: 15 },
      { label: '1 fl oz', grams: 30 }
    ]
  },
  // Almond Milk
  {
    id: 'phase_d_almond_milk',
    name: 'Almond Milk, Unsweetened',
    categoryId: 'dairy',
    source: 'template' as const,
    kcal100: 15,
    protein100: 0.4,
    carbs100: 0.3,
    fat100: 1.1,
    densityGml: 1.0,
    aliases: ['almond milk', 'almondmilk'],
    units: [
      { label: '1 cup', grams: 240 },
      { label: 'cup', grams: 240 },
      { label: '1 tbsp', grams: 15 },
      { label: '1 fl oz', grams: 30 }
    ]
  },
  // Half and Half
  {
    id: 'phase_d_half_and_half',
    name: 'Cream, Half and Half',
    categoryId: 'dairy',
    source: 'template' as const,
    kcal100: 130,
    protein100: 2.9,
    carbs100: 4.3,
    fat100: 11.5,
    densityGml: 1.01,
    aliases: ['half and half', 'half & half', 'half-and-half', 'cream'],
    units: [
      { label: '1 cup', grams: 242 },
      { label: 'cup', grams: 242 },
      { label: '1 tbsp', grams: 15 },
      { label: 'tbsp', grams: 15 },
      { label: '1 fl oz', grams: 30 }
    ]
  },
  // Heavy Cream
  {
    id: 'phase_d_heavy_cream',
    name: 'Cream, Heavy Whipping',
    categoryId: 'dairy',
    source: 'template' as const,
    kcal100: 340,
    protein100: 2.1,
    carbs100: 2.8,
    fat100: 36.1,
    densityGml: 0.99,
    aliases: ['heavy cream', 'heavy whipping cream', 'whipping cream'],
    units: [
      { label: '1 cup', grams: 238 },
      { label: 'cup', grams: 238 },
      { label: '1 tbsp', grams: 15 },
      { label: 'tbsp', grams: 15 },
      { label: '1 fl oz', grams: 30 }
    ]
  }
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  
  console.log('🔧 Phase D: Adding Critical Missing Foods\n');
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN' : '💾 LIVE RUN'}`);
  console.log('=' .repeat(80));
  
  let added = 0;
  let skipped = 0;
  
  for (const food of CRITICAL_FOODS) {
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
    console.log('\n✅ Critical foods added!');
    console.log('\n🧪 Expected Impact:');
    console.log('   - "1 cup salt" will now find Salt, Table (not tuna)');
    console.log('   - "1 cup oat milk" will find Oat Milk (not chocolate)');
    console.log('   - "1 cup half and half" will find Cream, Half and Half (not beef)');
    console.log('   - Expected: +2-3pp improvement (84.5% → 87%)');
    console.log('\n   Run: npm run eval');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

