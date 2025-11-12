#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

/**
 * Phase B: Add Missing High-Impact Foods
 * 
 * Adds template foods that are causing NO MATCH errors in evaluation
 * Based on gold.v3.csv failure analysis
 */

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
  densityGml: number;
  units: Array<{ label: string; grams: number }>;
};

const MISSING_FOODS: TemplateFoodCreate[] = [
  // 1. Chocolate Chips (170g) - High MAE: 170g
  {
    name: "Chocolate Chips, Semisweet",
    aliases: ["chocolate chips", "semi-sweet chocolate chips", "semisweet chocolate chips", "chocolate chip"],
    categoryId: "sugar",
    kcal100: 486,
    protein100: 4.2,
    carbs100: 63.9,
    fat100: 24.4,
    fiber100: 5.0,
    sugar100: 51.0,
    densityGml: 0.61,
    units: [
      { label: "cup", grams: 170 },
      { label: "tbsp", grams: 10.6 }
    ]
  },
  
  // 2. Pasta, Dry (170g) - High MAE: 170g
  {
    name: "Pasta, Dry",
    aliases: ["pasta dry", "dry pasta", "pasta uncooked", "uncooked pasta", "pasta"],
    categoryId: "grain",
    kcal100: 371,
    protein100: 13.0,
    carbs100: 74.7,
    fat100: 1.5,
    fiber100: 3.2,
    sugar100: 2.7,
    densityGml: 0.43,
    units: [
      { label: "cup", grams: 85 },  // ~2oz dry pasta per cup (varies by shape)
      { label: "oz", grams: 28.35 }
    ]
  },
  
  // 3. Flax Seeds (168g) - High MAE: 168g
  {
    name: "Seeds, Flaxseed",
    aliases: ["flax seeds", "flaxseed", "flax seed", "ground flaxseed"],
    categoryId: "seed",
    kcal100: 534,
    protein100: 18.3,
    carbs100: 28.9,
    fat100: 42.2,
    fiber100: 27.3,
    sugar100: 1.6,
    densityGml: 0.67,
    units: [
      { label: "cup", grams: 168 },
      { label: "tbsp", grams: 10.5 }
    ]
  },
  
  // 4. Hemp Seeds (154g) - High MAE: 154g
  {
    name: "Seeds, Hemp Seed, Hulled",
    aliases: ["hemp seeds", "hemp seed", "hulled hemp seeds", "hemp hearts"],
    categoryId: "seed",
    kcal100: 553,
    protein100: 31.6,
    carbs100: 8.7,
    fat100: 48.8,
    fiber100: 4.0,
    sugar100: 1.5,
    densityGml: 0.62,
    units: [
      { label: "cup", grams: 154 },
      { label: "tbsp", grams: 9.6 }
    ]
  },
  
  // 5-7. Bell Peppers (149g each) - High MAE: 149g
  {
    name: "Peppers, Sweet, Red, Raw, Chopped",
    aliases: ["red bell pepper", "red pepper", "bell pepper red", "red bell peppers"],
    categoryId: "veg",
    kcal100: 31,
    protein100: 1.0,
    carbs100: 6.0,
    fat100: 0.3,
    fiber100: 2.1,
    sugar100: 4.2,
    densityGml: 0.60,
    units: [
      { label: "cup", grams: 149 }
    ]
  },
  {
    name: "Peppers, Sweet, Green, Raw, Chopped",
    aliases: ["green bell pepper", "green pepper", "bell pepper green", "green bell peppers"],
    categoryId: "veg",
    kcal100: 20,
    protein100: 0.9,
    carbs100: 4.6,
    fat100: 0.2,
    fiber100: 1.7,
    sugar100: 2.4,
    densityGml: 0.60,
    units: [
      { label: "cup", grams: 149 }
    ]
  },
  {
    name: "Peppers, Sweet, Yellow, Raw, Chopped",
    aliases: ["yellow bell pepper", "yellow pepper", "bell pepper yellow", "yellow bell peppers"],
    categoryId: "veg",
    kcal100: 27,
    protein100: 1.0,
    carbs100: 6.3,
    fat100: 0.2,
    fiber100: 0.9,
    sugar100: 5.1,
    densityGml: 0.60,
    units: [
      { label: "cup", grams: 149 }
    ]
  },
  
  // 8. Chicken Drumsticks - Add food with plural alias
  {
    name: "Chicken, Drumstick",
    aliases: ["chicken drumstick", "chicken drumsticks", "drumstick", "drumsticks"],
    categoryId: "chicken",
    kcal100: 172,
    protein100: 28.3,
    carbs100: 0,
    fat100: 5.7,
    fiber100: 0,
    sugar100: 0,
    densityGml: 1.05,
    units: [
      { label: "drumstick", grams: 44 },  // Average drumstick weight
      { label: "oz", grams: 28.35 }
    ]
  },
  
  // 9. Mustard (prepared, yellow) - Already exists in USDA but add template
  {
    name: "Mustard, Prepared, Yellow",
    aliases: ["mustard", "yellow mustard", "prepared mustard", "mustard prepared"],
    categoryId: "condiment",
    kcal100: 60,
    protein100: 3.7,
    carbs100: 5.3,
    fat100: 3.3,
    fiber100: 3.3,
    sugar100: 1.1,
    densityGml: 1.08,
    units: [
      { label: "cup", grams: 240 },
      { label: "tbsp", grams: 15 },
      { label: "tsp", grams: 5 }
    ]
  },
  
  // 10. Almond Flour
  {
    name: "Almond Flour",
    aliases: ["almond flour", "almond meal", "ground almonds"],
    categoryId: "flour",
    kcal100: 571,
    protein100: 21.4,
    carbs100: 21.4,
    fat100: 50.0,
    fiber100: 10.7,
    sugar100: 3.6,
    densityGml: 0.48,
    units: [
      { label: "cup", grams: 96 },
      { label: "tbsp", grams: 6 }
    ]
  },
  
  // 11. Coconut Flour
  {
    name: "Coconut Flour",
    aliases: ["coconut flour", "coconut meal"],
    categoryId: "flour",
    kcal100: 400,
    protein100: 20.0,
    carbs100: 60.0,
    fat100: 13.3,
    fiber100: 40.0,
    sugar100: 20.0,
    densityGml: 0.48,
    units: [
      { label: "cup", grams: 112 },
      { label: "tbsp", grams: 7 }
    ]
  },
  
  // 12. Chia Seeds
  {
    name: "Seeds, Chia Seeds, Dried",
    aliases: ["chia seeds", "chia seed", "chia"],
    categoryId: "seed",
    kcal100: 486,
    protein100: 16.5,
    carbs100: 42.1,
    fat100: 30.7,
    fiber100: 34.4,
    sugar100: 0,
    densityGml: 0.60,
    units: [
      { label: "cup", grams: 160 },
      { label: "tbsp", grams: 12 }
    ]
  },
  
  // 13. Nutritional Yeast
  {
    name: "Nutritional Yeast",
    aliases: ["nutritional yeast", "nooch", "yeast nutritional"],
    categoryId: "condiment",
    kcal100: 325,
    protein100: 50.0,
    carbs100: 37.5,
    fat100: 6.2,
    fiber100: 25.0,
    sugar100: 0,
    densityGml: 0.32,
    units: [
      { label: "cup", grams: 60 },
      { label: "tbsp", grams: 5 }
    ]
  },
  
  // 14. Pumpkin Seeds
  {
    name: "Seeds, Pumpkin and Squash Seed Kernels, Dried",
    aliases: ["pumpkin seeds", "pepitas", "pumpkin seed", "squash seeds"],
    categoryId: "seed",
    kcal100: 559,
    protein100: 30.2,
    carbs100: 10.7,
    fat100: 49.1,
    fiber100: 6.0,
    sugar100: 1.4,
    densityGml: 0.54,
    units: [
      { label: "cup", grams: 138 },
      { label: "tbsp", grams: 9 }
    ]
  },
  
  // 15. Sunflower Seeds
  {
    name: "Seeds, Sunflower Seed Kernels, Dried",
    aliases: ["sunflower seeds", "sunflower seed", "sunflower kernels"],
    categoryId: "seed",
    kcal100: 584,
    protein100: 20.8,
    carbs100: 20.0,
    fat100: 51.5,
    fiber100: 8.6,
    sugar100: 2.6,
    densityGml: 0.56,
    units: [
      { label: "cup", grams: 140 },
      { label: "tbsp", grams: 9 }
    ]
  }
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  
  console.log('🚀 Phase B: Adding Missing High-Impact Foods');
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN' : '💾 LIVE RUN'}`);
  console.log('='.repeat(80));
  
  let foodsCreated = 0;
  let aliasesAdded = 0;
  let unitsAdded = 0;
  
  for (const foodData of MISSING_FOODS) {
    console.log(`\n📦 Processing: "${foodData.name}"`);
    
    // Check if food already exists
    const existing = await prisma.food.findFirst({
      where: {
        name: { equals: foodData.name, mode: 'insensitive' },
        source: 'template'
      }
    });
    
    if (existing) {
      console.log(`  ℹ️  Food already exists: "${existing.name}" (ID: ${existing.id})`);
      continue;
    }
    
    if (dryRun) {
      console.log(`  🔍 [DRY RUN] Would create food: "${foodData.name}"`);
      console.log(`     Category: ${foodData.categoryId}`);
      console.log(`     Macros: ${foodData.kcal100}kcal, P:${foodData.protein100}g, C:${foodData.carbs100}g, F:${foodData.fat100}g`);
      console.log(`     Density: ${foodData.densityGml} g/ml`);
      console.log(`     Aliases: ${foodData.aliases.length} (${foodData.aliases.slice(0, 2).join(', ')}...)`);
      console.log(`     Units: ${foodData.units.length} (${foodData.units.map(u => u.label).join(', ')})`);
      foodsCreated++;
      aliasesAdded += foodData.aliases.length;
      unitsAdded += foodData.units.length;
    } else {
      // Create the food
      const food = await prisma.food.create({
        data: {
          name: foodData.name,
          source: 'template',
          categoryId: foodData.categoryId,
          kcal100: foodData.kcal100,
          protein100: foodData.protein100,
          carbs100: foodData.carbs100,
          fat100: foodData.fat100,
          fiber100: foodData.fiber100 ?? 0,
          sugar100: foodData.sugar100 ?? 0,
          densityGml: foodData.densityGml,
          verification: 'accepted'
        }
      });
      
      console.log(`  ✅ Created food: "${food.name}" (ID: ${food.id})`);
      foodsCreated++;
      
      // Add aliases
      for (const alias of foodData.aliases) {
        await prisma.foodAlias.create({
          data: {
            foodId: food.id,
            alias: alias
          }
        });
        aliasesAdded++;
      }
      console.log(`     ➕ Added ${foodData.aliases.length} aliases`);
      
      // Add units
      for (const unit of foodData.units) {
        await prisma.foodUnit.create({
          data: {
            foodId: food.id,
            label: unit.label,
            grams: unit.grams
          }
        });
        unitsAdded++;
      }
      console.log(`     ➕ Added ${foodData.units.length} units`);
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 Summary:');
  console.log(`  Foods ${dryRun ? 'to be ' : ''}created: ${foodsCreated}`);
  console.log(`  Aliases ${dryRun ? 'to be ' : ''}added: ${aliasesAdded}`);
  console.log(`  FoodUnits ${dryRun ? 'to be ' : ''}added: ${unitsAdded}`);
  console.log('='.repeat(80));
  
  if (dryRun) {
    console.log('\n✅ Dry run complete. Run without --dry-run to apply changes.');
  } else {
    console.log('\n✅ All missing foods added successfully!');
    console.log('\n💡 Next Steps:');
    console.log('   1. Run: npm run eval');
    console.log('   2. Expected improvement: +4-5pp (from 72.8% → 77-78%)');
    console.log('   3. Should fix 10-15 NO MATCH cases');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });

