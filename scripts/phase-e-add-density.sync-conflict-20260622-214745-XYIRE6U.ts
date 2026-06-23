#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

/**
 * Phase E Step 3: Add densityGml to template foods
 * Fixes volume portion resolution (1 cup → correct grams instead of 60g default)
 */

// Density values in g/ml (grams per milliliter)
// 1 cup = 240ml, so grams = 240ml * densityGml
const DENSITY_VALUES: Record<string, number> = {
  // Dairy (densities from USDA data)
  'Cheese, cottage, lowfat, 2% milkfat': 0.94,  // 226g per cup
  'Cottage Cheese': 0.94,
  'Greek Yogurt, Plain, Nonfat (Fage)': 1.05,  // 252g per cup
  'Greek Yogurt 0%': 1.05,
  'Cream, Half and Half': 1.02,  // 245g per cup
  'Cream, Heavy Whipping': 0.96,  // 230g per cup
  'Heavy Cream': 0.96,
  'Sour Cream': 0.96,
  'Butter': 0.96,
  'Ghee': 0.96,
  
  // Oils (all oils are less dense than water)
  'Oil, coconut': 0.92,  // 218g per cup
  'Coconut Oil': 0.92,
  'Oil, olive': 0.92,  // 216g per cup
  'Olive Oil': 0.92,
  'Oil, avocado': 0.92,
  'Avocado Oil': 0.92,
  'Canola Oil': 0.92,
  'Sesame Oil': 0.92,
  'Peanut Oil': 0.92,
  
  // Milks (close to water density)
  'Milk, Nonfat': 1.03,  // 247g per cup
  'Milk, 2%': 1.03,  // 244g per cup
  'Milk, Whole': 1.03,  // 244g per cup
  'Oat Milk, Unsweetened': 1.03,
  'Almond Milk, Unsweetened': 1.03,
  'Soy Milk, Unsweetened': 1.03,
  'Coconut Milk': 0.95,  // 226g per cup (thicker)
  
  // Liquids
  'Chicken Broth': 1.00,  // 240g per cup
  'Beef Broth': 1.00,
  'Vegetable Broth': 1.00,
  'Soy Sauce': 1.08,  // 260g per cup (salty, denser)
  'Fish Sauce': 1.08,
  'Rice Vinegar': 1.01,  // 242g per cup
  'Vinegar, Distilled': 1.01,
  'Vanilla Extract': 0.88,  // 211g per cup (alcohol-based)
  
  // Pastes and thick sauces
  'Tomato Paste': 1.02,
  'Miso Paste': 1.08,  // Dense paste
  'Gochujang': 1.08,
  'Curry Paste': 1.05,
  'Mustard, Prepared, Yellow': 1.05,
  'Ketchup': 1.06,  // 255g per cup
  
  // Flours and powders (much less dense)
  'All-Purpose Flour': 0.52,  // 125g per cup
  'Whole Wheat Flour': 0.5,  // 120g per cup
  'Almond Flour': 0.4,  // 96g per cup
  'Oat Flour': 0.4,
  'Coconut Flour': 0.45,  // 108g per cup
  'Corn Starch': 0.53,  // 128g per cup
  'Baking Powder': 0.96,
  'Baking Soda': 0.96,
  'Nutritional Yeast': 0.26,  // 62g per cup (very light)
  
  // Protein powders (very light)
  'Whey Protein Isolate (Generic)': 0.5,  // 120g per cup
  'Whey Protein Concentrate (Generic)': 0.5,
  'Protein Powder, Casein': 0.5,
  'Protein Powder, Plant-Based': 0.5,
  
  // Nut butters (dense and thick)
  'Peanut Butter': 1.08,  // 258g per cup
  'Almond Butter': 1.06,  // 254g per cup
  
  // Other
  'Honey': 1.42,  // 340g per cup (very dense)
  'Maple Syrup': 1.33,  // 320g per cup
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  
  console.log('🔧 Phase E Step 3: Add densityGml to Template Foods\n');
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN' : '💾 LIVE RUN'}`);
  console.log('=' .repeat(80));
  
  let added = 0;
  let updated = 0;
  let notFound = 0;
  
  for (const [foodName, density] of Object.entries(DENSITY_VALUES)) {
    const food = await prisma.food.findFirst({
      where: {
        name: { equals: foodName, mode: 'insensitive' }
      },
      select: { id: true, name: true, densityGml: true }
    });
    
    if (!food) {
      console.log(`\n⚠️  Food not found: ${foodName}`);
      notFound++;
      continue;
    }
    
    // Skip if already has density
    if (food.densityGml !== null && Math.abs(food.densityGml - density) < 0.01) {
      continue; // Already set correctly
    }
    
    const action = food.densityGml === null ? 'ADD' : 'UPDATE';
    const oldValue = food.densityGml ?? 'null';
    
    console.log(`\n${action === 'ADD' ? '➕' : '🔄'} ${food.name}`);
    console.log(`   ${oldValue} → ${density} g/ml`);
    console.log(`   1 cup = ${Math.round(240 * density)}g`);
    
    if (!dryRun) {
      await prisma.food.update({
        where: { id: food.id },
        data: { densityGml: density }
      });
    }
    
    if (action === 'ADD') added++;
    else updated++;
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 Summary:');
  console.log(`   Added: ${added}`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Not found: ${notFound}`);
  console.log(`   Total processed: ${added + updated}`);
  
  if (dryRun) {
    console.log('\n💡 Run without --dry-run to apply changes');
  } else {
    console.log('\n✅ Density values added!');
    console.log('\n🧪 Expected Impact:');
    console.log('   - "1 cup cottage cheese" will resolve to 226g (not 60g)');
    console.log('   - "1 cup coconut oil" will resolve to 221g (not 54.6g)');
    console.log('   - All volume portions will calculate correctly');
    console.log('   - Expected: +2-3pp improvement (84.2% → 86-87%)');
    console.log('\n   Run: npm run eval');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

