#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

/**
 * Phase A: Fix Portion Resolution Bugs
 * 
 * Adds FoodUnit entries and fixes densityGml for template foods
 * This fixes portion resolution errors (e.g., "1 cup" resolving to 60g instead of 240g)
 */

type PortionType = 'liquid' | 'paste' | 'powder' | 'solid' | 'oil';

const STANDARD_PORTIONS: Record<PortionType, Array<{ label: string; grams: number }>> = {
  liquid: [
    { label: 'cup', grams: 240 },
    { label: 'tbsp', grams: 15 },
    { label: 'tsp', grams: 5 }
  ],
  paste: [
    { label: 'cup', grams: 240 },
    { label: 'tbsp', grams: 17 },
    { label: 'tsp', grams: 6 }
  ],
  powder: [
    { label: 'cup', grams: 120 },
    { label: 'tbsp', grams: 8 },
    { label: 'tsp', grams: 2.6 }
  ],
  solid: [
    { label: 'cup', grams: 150 },
    { label: 'tbsp', grams: 15 }
  ],
  oil: [
    { label: 'cup', grams: 216 },
    { label: 'tbsp', grams: 13.6 },
    { label: 'tsp', grams: 4.5 }
  ]
};

type FoodConfig = {
  searchName: string;
  portionType: PortionType;
  densityGml: number;
  units?: Array<{ label: string; grams: number }>; // Override default portions
};

const FOODS_TO_FIX: FoodConfig[] = [
  // Liquids
  { searchName: 'Heavy Cream', portionType: 'liquid', densityGml: 0.99 },
  { searchName: 'Milk, Whole', portionType: 'liquid', densityGml: 1.03 },
  { searchName: 'Milk, lowfat', portionType: 'liquid', densityGml: 1.03 },
  { searchName: 'Milk, nonfat', portionType: 'liquid', densityGml: 1.04 },
  
  // Greek Yogurt & Dairy
  { searchName: 'Greek Yogurt', portionType: 'paste', densityGml: 1.04, units: [
    { label: 'cup', grams: 245 },
    { label: 'tbsp', grams: 17 }
  ]},
  { searchName: 'Cheese, cottage', portionType: 'solid', densityGml: 1.04, units: [
    { label: 'cup', grams: 226 },
    { label: 'tbsp', grams: 15 }
  ]},
  
  // Oils
  { searchName: 'Sesame Oil', portionType: 'oil', densityGml: 0.92 },
  { searchName: 'Oil, coconut', portionType: 'oil', densityGml: 0.92 },
  { searchName: 'Oil, olive', portionType: 'oil', densityGml: 0.91 },
  { searchName: 'Oil, avocado', portionType: 'oil', densityGml: 0.91 },
  
  // Condiments (paste-like)
  { searchName: 'Ketchup', portionType: 'paste', densityGml: 1.05, units: [
    { label: 'cup', grams: 240 },
    { label: 'tbsp', grams: 17 }
  ]},
  { searchName: 'Mustard', portionType: 'paste', densityGml: 1.08, units: [
    { label: 'cup', grams: 240 },
    { label: 'tbsp', grams: 15 }
  ]},
  { searchName: 'Sriracha', portionType: 'liquid', densityGml: 1.05 },
  
  // Asian Condiments
  { searchName: 'Miso', portionType: 'paste', densityGml: 1.04, units: [
    { label: 'cup', grams: 275 },
    { label: 'tbsp', grams: 17 }
  ]},
  { searchName: 'Mirin', portionType: 'liquid', densityGml: 1.10 },
  { searchName: 'Soy sauce', portionType: 'liquid', densityGml: 1.15 },
  { searchName: 'Fish sauce', portionType: 'liquid', densityGml: 1.10 },
  { searchName: 'Rice vinegar', portionType: 'liquid', densityGml: 1.01 },
  { searchName: 'Gochujang', portionType: 'paste', densityGml: 1.10, units: [
    { label: 'cup', grams: 250 },
    { label: 'tbsp', grams: 17 }
  ]},
  { searchName: 'Curry paste', portionType: 'paste', densityGml: 1.05, units: [
    { label: 'cup', grams: 240 },
    { label: 'tbsp', grams: 16 }
  ]},
  
  // Liquids (other)
  { searchName: 'Vinegar', portionType: 'liquid', densityGml: 1.01 },
  { searchName: 'Vanilla extract', portionType: 'liquid', densityGml: 0.88 },
  { searchName: 'Coconut milk', portionType: 'liquid', densityGml: 0.98 },
  
  // Powders
  { searchName: 'Baking powder', portionType: 'powder', densityGml: 0.96, units: [
    { label: 'cup', grams: 192 },
    { label: 'tbsp', grams: 12 },
    { label: 'tsp', grams: 4 }
  ]},
  { searchName: 'Baking soda', portionType: 'powder', densityGml: 2.20, units: [
    { label: 'cup', grams: 220 },
    { label: 'tbsp', grams: 14 },
    { label: 'tsp', grams: 5 }
  ]},
  { searchName: 'Gochugaru', portionType: 'powder', densityGml: 0.50, units: [
    { label: 'cup', grams: 60 },
    { label: 'tbsp', grams: 4 },
    { label: 'tsp', grams: 1.3 }
  ]},
  
  // Solid/Cooked
  { searchName: 'Sweet Potato, Mashed', portionType: 'solid', densityGml: 0.80, units: [
    { label: 'cup', grams: 200 },
    { label: 'tbsp', grams: 13 }
  ]},
  { searchName: 'Salmon', portionType: 'solid', densityGml: 1.05, units: [
    { label: 'cup', grams: 140 },  // cooked, flaked
    { label: 'oz', grams: 28.35 }
  ]},
  
  // Broths
  { searchName: 'Chicken broth', portionType: 'liquid', densityGml: 1.00 },
  { searchName: 'Beef broth', portionType: 'liquid', densityGml: 1.00 },
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  
  console.log('🔧 Phase A: Fixing Template Food Portions');
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN' : '💾 LIVE RUN'}`);
  console.log('=' .repeat(80));
  
  let updatedFoods = 0;
  let addedUnits = 0;
  
  for (const config of FOODS_TO_FIX) {
    console.log(`\n📦 Processing: "${config.searchName}"`);
    
    // Find the food
    const food = await prisma.food.findFirst({
      where: {
        name: { contains: config.searchName, mode: 'insensitive' },
        source: 'template'
      },
      include: {
        units: true
      }
    });
    
    if (!food) {
      console.log(`  ⚠️  Food not found: "${config.searchName}" (may not be template food)`);
      continue;
    }
    
    console.log(`  ✅ Found: "${food.name}" (ID: ${food.id})`);
    console.log(`     Current densityGml: ${food.densityGml ?? 'null'}`);
    console.log(`     Current units: ${food.units.length} entries`);
    
    // Update densityGml if needed
    if (food.densityGml !== config.densityGml) {
      if (dryRun) {
        console.log(`     🔍 [DRY RUN] Would update densityGml: ${food.densityGml ?? 'null'} → ${config.densityGml}`);
      } else {
        await prisma.food.update({
          where: { id: food.id },
          data: { densityGml: config.densityGml }
        });
        console.log(`     ✏️  Updated densityGml: ${food.densityGml ?? 'null'} → ${config.densityGml}`);
        updatedFoods++;
      }
    } else {
      console.log(`     ℹ️  densityGml already correct`);
    }
    
    // Add FoodUnit entries
    const portions = config.units || STANDARD_PORTIONS[config.portionType];
    const existingLabels = food.units.map(u => u.label.toLowerCase());
    
    for (const portion of portions) {
      if (existingLabels.includes(portion.label.toLowerCase())) {
        console.log(`     ℹ️  Unit "${portion.label}" already exists`);
        continue;
      }
      
      if (dryRun) {
        console.log(`     🔍 [DRY RUN] Would add unit: "${portion.label}" = ${portion.grams}g`);
      } else {
        await prisma.foodUnit.create({
          data: {
            foodId: food.id,
            label: portion.label,
            grams: portion.grams
          }
        });
        console.log(`     ➕ Added unit: "${portion.label}" = ${portion.grams}g`);
        addedUnits++;
      }
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 Summary:');
  console.log(`  Foods ${dryRun ? 'to be ' : ''}updated: ${updatedFoods}`);
  console.log(`  FoodUnits ${dryRun ? 'to be ' : ''}added: ${addedUnits}`);
  console.log('='.repeat(80));
  
  if (dryRun) {
    console.log('\n✅ Dry run complete. Run without --dry-run to apply changes.');
  } else {
    console.log('\n✅ All changes applied successfully!');
    console.log('\n💡 Next Steps:');
    console.log('   1. Run: npm run eval');
    console.log('   2. Check if portion errors are fixed');
    console.log('   3. Expected improvement: +2-3pp (from 72.8% → 75-76%)');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });

