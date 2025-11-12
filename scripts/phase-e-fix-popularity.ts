#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

/**
 * Phase E Step 1: Fix template food popularity with tiered system
 * - Primary whole foods: 1000 (chicken, milk, eggs, rice)
 * - Derivative products: 500 (oat milk, tofu, protein powder)
 * - Condiments: 100 (ketchup, mustard, hot sauce)
 * - Specialty: 50 (gochujang, nutritional yeast)
 */

// Tiered popularity system
const POPULARITY_TIERS = {
  primary: 1000,      // Whole foods
  derivative: 500,    // Processed/alternatives
  condiment: 100,     // Sauces, seasonings
  specialty: 50       // Uncommon ingredients
};

// Classification by food name patterns
const FOOD_CLASSIFICATIONS = {
  // PRIMARY WHOLE FOODS (1000)
  primary: [
    // Proteins
    'Chicken Breast', 'Chicken Thigh', 'Ground Beef', 'Salmon', 'Egg',
    'Egg White',
    
    // Dairy (primary)
    'Milk, Nonfat', 'Milk, 2%', 'Milk, Whole',
    
    // Grains
    'White Rice', 'Brown Rice', 'Oats', 'Quinoa',
    'All-Purpose Flour', 'Whole Wheat Flour',
    
    // Legumes
    'Black Beans', 'Chickpeas', 'Lentils',
    
    // Vegetables
    'Spinach, Raw', 'Broccoli, Raw', 'Tomato',
    
    // Fruits
    'Banana', 'Apple', 'Blueberries', 'Avocado',
    
    // Oils (primary)
    'Olive Oil', 'Avocado Oil', 'Canola Oil',
    
    // Nuts (whole)
    'Almonds', 'Peanut Butter',
  ],
  
  // DERIVATIVE PRODUCTS (500)
  derivative: [
    // Alternative milks
    'Oat Milk', 'Soy Milk', 'Almond Milk', 'Coconut Milk',
    
    // Processed proteins
    'Tofu, Firm', 'Tofu, Firm, Cubed',
    
    // Protein powders
    'Whey Protein Isolate', 'Whey Protein Concentrate',
    'Protein Powder, Casein', 'Protein Powder, Plant-Based',
    
    // Flours (specialty)
    'Almond Flour', 'Oat Flour', 'Coconut Flour',
    
    // Specialty oils
    'Coconut Oil', 'Sesame Oil',
    
    // Dairy products
    'Greek Yogurt', 'Cottage Cheese', 'Cream, Half and Half',
    'Cream, Heavy Whipping', 'Ghee', 'Butter',
    
    // Processed foods
    'Chocolate Chips', 'Pasta, Dry',
    
    // Nuts (specialty)
    'Hazelnuts', 'Pine Nuts', 'Macadamia Nuts', 'Brazil Nuts',
    'Pistachios', 'Pecans', 'Nuts, Cashews',
  ],
  
  // CONDIMENTS (100)
  condiment: [
    // Sauces
    'Ketchup', 'Mustard', 'Hot Sauce',
    
    // Seasonings
    'Salt, Table',
    
    // Baking
    'Baking Powder', 'Baking Soda', 'Vanilla Extract',
    'Corn Starch',
    
    // Asian condiments
    'Soy Sauce', 'Rice Vinegar', 'Fish Sauce', 'Miso Paste',
    'Mirin', 'Gochujang', 'Gochugaru', 'Curry Paste',
  ],
  
  // SPECIALTY (50)
  specialty: [
    'Nutritional Yeast',
    'Seeds, Chia Seeds', 'Seeds, Flaxseed', 'Seeds, Hemp Seed',
    'Seeds, Pumpkin', 'Seeds, Sunflower',
    'Chia Seeds',
    'Sweet Potato, Mashed',
    'Peppers, Sweet, Red', 'Peppers, Sweet, Green', 'Peppers, Sweet, Yellow',
    'Chicken, Drumstick',
  ]
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  
  console.log('🔧 Phase E Step 1: Tiered Popularity System\n');
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN' : '💾 LIVE RUN'}`);
  console.log('=' .repeat(80));
  
  const updates: Array<{ food: string; oldPop: number; newPop: number; tier: string }> = [];
  
  // Get all template foods
  const templateFoods = await prisma.food.findMany({
    where: { source: 'template' },
    select: { id: true, name: true, popularity: true }
  });
  
  console.log(`\nFound ${templateFoods.length} template foods\n`);
  
  for (const food of templateFoods) {
    // Determine tier
    let tier: keyof typeof POPULARITY_TIERS = 'specialty'; // default
    let newPopularity = POPULARITY_TIERS.specialty;
    
    // Check each tier
    if (FOOD_CLASSIFICATIONS.primary.some(name => food.name.includes(name) || name.includes(food.name))) {
      tier = 'primary';
      newPopularity = POPULARITY_TIERS.primary;
    } else if (FOOD_CLASSIFICATIONS.derivative.some(name => food.name.includes(name) || name.includes(food.name))) {
      tier = 'derivative';
      newPopularity = POPULARITY_TIERS.derivative;
    } else if (FOOD_CLASSIFICATIONS.condiment.some(name => food.name.includes(name) || name.includes(food.name))) {
      tier = 'condiment';
      newPopularity = POPULARITY_TIERS.condiment;
    }
    
    const oldPopularity = food.popularity || 0;
    
    // Only update if changed
    if (oldPopularity !== newPopularity) {
      updates.push({
        food: food.name,
        oldPop: oldPopularity,
        newPop: newPopularity,
        tier
      });
      
      if (!dryRun) {
        await prisma.food.update({
          where: { id: food.id },
          data: { popularity: newPopularity }
        });
      }
    }
  }
  
  // Print summary by tier
  console.log('\n📊 Popularity Changes by Tier:\n');
  
  const tiers = ['primary', 'derivative', 'condiment', 'specialty'] as const;
  for (const tier of tiers) {
    const tierUpdates = updates.filter(u => u.tier === tier);
    if (tierUpdates.length === 0) continue;
    
    console.log(`\n${tier.toUpperCase()} (${POPULARITY_TIERS[tier]}):`);
    console.log('-'.repeat(60));
    for (const update of tierUpdates) {
      console.log(`  ${update.food}`);
      console.log(`    ${update.oldPop} → ${update.newPop}`);
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 Summary:');
  console.log(`   Total updates: ${updates.length}`);
  console.log(`   Primary (1000): ${updates.filter(u => u.tier === 'primary').length}`);
  console.log(`   Derivative (500): ${updates.filter(u => u.tier === 'derivative').length}`);
  console.log(`   Condiment (100): ${updates.filter(u => u.tier === 'condiment').length}`);
  console.log(`   Specialty (50): ${updates.filter(u => u.tier === 'specialty').length}`);
  
  if (dryRun) {
    console.log('\n💡 Run without --dry-run to apply changes');
  } else {
    console.log('\n✅ Popularity tiers applied!');
    console.log('\n🧪 Expected Impact:');
    console.log('   - Ketchup will no longer outrank tomatoes');
    console.log('   - Coconut milk will no longer outrank regular milk');
    console.log('   - Primary whole foods will rank first');
    console.log('   - Expected: +2-3pp improvement (82.3% → 84-85%)');
    console.log('\n   Run: npm run eval');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

