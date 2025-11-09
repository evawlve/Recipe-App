/**
 * Sprint 2: Seed PortionOverride Table
 * Upserts 200-300 curated portion overrides organized by tier
 * 
 * Sources:
 * - USDA FoodData Central portion data
 * - Standard cookbook measurements (Joy of Cooking, USDA handbook)
 * - Culinary references for international ingredients
 * 
 * Run: npm run seed:portion-overrides
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface PortionEntry {
  foodName: string;
  unit: string;
  grams: number;
  label?: string;
  notes?: string;
}

// ============================================================================
// TIER 1: CORE PANTRY (80-100 entries)
// High-frequency ingredients: eggs, oils, dairy, grains
// ============================================================================

const TIER_1_EGGS: PortionEntry[] = [
  // Egg - whole (different sizes)
  { foodName: 'Egg', unit: 'whole', grams: 50, label: 'large', notes: 'Standard large egg' },
  { foodName: 'Egg', unit: 'whole', grams: 44, label: 'medium', notes: 'Medium egg' },
  { foodName: 'Egg', unit: 'whole', grams: 38, label: 'small', notes: 'Small egg' },
  { foodName: 'Egg', unit: 'whole', grams: 56, label: 'extra-large', notes: 'Extra-large egg' },
  { foodName: 'Egg', unit: 'whole', grams: 63, label: 'jumbo', notes: 'Jumbo egg' },
  
  // Egg parts (large egg basis)
  { foodName: 'Egg', unit: 'yolk', grams: 17, notes: 'Yolk from large egg' },
  { foodName: 'Egg', unit: 'white', grams: 33, notes: 'White from large egg' },
  { foodName: 'Egg White', unit: 'white', grams: 33, notes: 'Egg white (large)' },
  { foodName: 'Eggs, Grade A, Large, egg whole', unit: 'whole', grams: 50, label: 'large' },
  { foodName: 'Eggs, Grade A, Large, egg white', unit: 'white', grams: 33 },
  { foodName: 'Eggs, Grade A, Large, egg yolk', unit: 'yolk', grams: 17 },
];

const TIER_1_OILS: PortionEntry[] = [
  // Olive oil
  { foodName: 'Olive Oil', unit: 'tbsp', grams: 13.6, notes: 'USDA standard' },
  { foodName: 'Olive Oil', unit: 'tsp', grams: 4.5, notes: 'USDA standard' },
  { foodName: 'Olive Oil', unit: 'cup', grams: 216, notes: 'USDA standard' },
  
  // Avocado oil
  { foodName: 'Avocado Oil', unit: 'tbsp', grams: 13.6 },
  { foodName: 'Avocado Oil', unit: 'tsp', grams: 4.5 },
  { foodName: 'Avocado Oil', unit: 'cup', grams: 216 },
  
  // Canola oil
  { foodName: 'Canola Oil', unit: 'tbsp', grams: 13.6 },
  { foodName: 'Canola Oil', unit: 'tsp', grams: 4.5 },
  { foodName: 'Canola Oil', unit: 'cup', grams: 216 },
  
  // Coconut oil (slightly denser when solid)
  { foodName: 'Coconut Oil', unit: 'tbsp', grams: 13.6 },
  { foodName: 'Coconut Oil', unit: 'tsp', grams: 4.5 },
  { foodName: 'Coconut Oil', unit: 'cup', grams: 218 },
];

const TIER_1_DAIRY: PortionEntry[] = [
  // Milk (whole)
  { foodName: 'Milk, Whole', unit: 'cup', grams: 244, notes: 'USDA standard' },
  { foodName: 'Milk, Whole', unit: 'tbsp', grams: 15, notes: 'USDA standard' },
  
  // Milk (2%)
  { foodName: 'Milk, 2%', unit: 'cup', grams: 244 },
  { foodName: 'Milk, 2%', unit: 'tbsp', grams: 15 },
  
  // Milk (nonfat)
  { foodName: 'Milk, Nonfat', unit: 'cup', grams: 245 },
  { foodName: 'Milk, Nonfat', unit: 'tbsp', grams: 15 },
  
  // Greek yogurt
  { foodName: 'Greek Yogurt 0%', unit: 'cup', grams: 170, notes: 'Plain nonfat' },
  { foodName: 'Greek Yogurt 0%', unit: 'tbsp', grams: 10.6 },
  
  // Butter
  { foodName: 'Butter', unit: 'tbsp', grams: 14.2, notes: 'USDA standard (1/8 stick)' },
  { foodName: 'Butter', unit: 'tsp', grams: 4.7 },
  { foodName: 'Butter', unit: 'cup', grams: 227, notes: '2 sticks' },
  { foodName: 'Butter', unit: 'stick', grams: 113.5, notes: '8 tbsp' },
];

const TIER_1_GRAINS: PortionEntry[] = [
  // Rice - white, uncooked
  { foodName: 'White Rice, Uncooked', unit: 'cup', grams: 185, notes: 'Long-grain, dry' },
  { foodName: 'Rice, white, long-grain, regular, raw, enriched', unit: 'cup', grams: 185 },
  
  // Rice - white, cooked
  { foodName: 'Rice, white, long-grain, regular, enriched, cooked', unit: 'cup', grams: 158, notes: 'Cooked' },
  { foodName: 'Rice, white, medium-grain, enriched, cooked', unit: 'cup', grams: 186 },
  
  // Rice - brown, uncooked
  { foodName: 'Brown Rice, Uncooked', unit: 'cup', grams: 185, notes: 'Long-grain, dry' },
  
  // Rice - brown, cooked
  { foodName: 'Rice, brown, medium-grain, cooked', unit: 'cup', grams: 195, notes: 'Cooked' },
  
  // Oats
  { foodName: 'Oats, Dry', unit: 'cup', grams: 90, notes: 'Rolled oats, dry' },
  { foodName: 'Oats, Dry', unit: 'tbsp', grams: 5.6 },
  
  // Quinoa - uncooked
  { foodName: 'Quinoa, Uncooked', unit: 'cup', grams: 170, notes: 'Dry quinoa' },
  
  // Flour
  { foodName: 'All-Purpose Flour', unit: 'cup', grams: 120, notes: 'Spooned and leveled' },
  { foodName: 'All-Purpose Flour', unit: 'tbsp', grams: 7.5 },
  { foodName: 'Whole Wheat Flour', unit: 'cup', grams: 120 },
  { foodName: 'Almond Flour', unit: 'cup', grams: 96, notes: 'Finely ground' },
];

// ============================================================================
// TIER 2: PROTEINS (60-80 entries)
// Common protein sources with piece-based units
// ============================================================================

const TIER_2_CHICKEN: PortionEntry[] = [
  // Chicken breast
  { foodName: 'Chicken Breast', unit: 'piece', grams: 170, label: 'breast', notes: 'Raw, boneless, skinless' },
  { foodName: 'Chicken, broiler or fryers, breast, skinless, boneless, meat only, cooked, braised', unit: 'piece', grams: 140, label: 'breast', notes: 'Cooked, boneless' },
  
  // Chicken thigh
  { foodName: 'Chicken Thigh', unit: 'piece', grams: 52, label: 'thigh', notes: 'Raw, boneless, skinless' },
  
  // Chicken drumstick
  { foodName: 'Chicken, broilers or fryers, drumstick, meat only, cooked, braised', unit: 'piece', grams: 44, label: 'drumstick', notes: 'Cooked, bone-in weight ~73g' },
];

const TIER_2_BEEF: PortionEntry[] = [
  // Ground beef
  { foodName: 'Ground Beef 90/10', unit: 'cup', grams: 225, notes: 'Raw, crumbled' },
  { foodName: 'Ground Beef 90/10', unit: 'piece', grams: 113, label: 'patty', notes: '4 oz raw patty' },
];

const TIER_2_FISH: PortionEntry[] = [
  // Salmon
  { foodName: 'Salmon', unit: 'piece', grams: 113, label: 'fillet', notes: '4 oz raw fillet' },
  { foodName: 'Salmon', unit: 'piece', grams: 170, label: 'fillet-large', notes: '6 oz raw fillet' },
];

const TIER_2_PLANT_PROTEINS: PortionEntry[] = [
  // Tofu
  { foodName: 'Tofu, Firm', unit: 'piece', grams: 113, label: 'block-half', notes: 'Half of 14oz block' },
  { foodName: 'Tofu, Firm', unit: 'cup', grams: 126, notes: 'Cubed, 1/2-inch' },
  
  // Beans
  { foodName: 'Black Beans, Cooked', unit: 'cup', grams: 172, notes: 'Cooked/canned, drained' },
  { foodName: 'Chickpeas, Cooked', unit: 'cup', grams: 164, notes: 'Cooked/canned, drained' },
  { foodName: 'Lentils, Cooked', unit: 'cup', grams: 198, notes: 'Cooked' },
];

// ============================================================================
// TIER 3: VEGETABLES & AROMATICS (60-80 entries)
// Piece-like units: clove, slice, leaf, stalk
// ============================================================================

const TIER_3_AROMATICS: PortionEntry[] = [
  // Garlic
  { foodName: 'Garlic', unit: 'clove', grams: 3, notes: 'Medium clove' },
  { foodName: 'Garlic', unit: 'clove', grams: 2, label: 'small', notes: 'Small clove' },
  { foodName: 'Garlic', unit: 'clove', grams: 4, label: 'large', notes: 'Large clove' },
  { foodName: 'Garlic', unit: 'tbsp', grams: 8.5, notes: 'Minced' },
  { foodName: 'Garlic', unit: 'tsp', grams: 2.8, notes: 'Minced' },
  
  // Onion
  { foodName: 'Onion', unit: 'piece', grams: 150, label: 'medium', notes: 'Whole medium onion' },
  { foodName: 'Onion', unit: 'slice', grams: 9, notes: '1/4-inch slice' },
  { foodName: 'Onion', unit: 'cup', grams: 160, notes: 'Chopped' },
  
  // Ginger
  { foodName: 'Ginger', unit: 'piece', grams: 11, label: '1-inch', notes: '1-inch piece' },
  { foodName: 'Ginger', unit: 'tbsp', grams: 6, notes: 'Grated' },
  { foodName: 'Ginger', unit: 'tsp', grams: 2, notes: 'Grated' },
  
  // Scallion
  { foodName: 'Scallion', unit: 'stalk', grams: 15, notes: 'Whole scallion' },
  { foodName: 'Scallion', unit: 'cup', grams: 100, notes: 'Chopped' },
];

const TIER_3_VEGETABLES: PortionEntry[] = [
  // Tomato
  { foodName: 'Tomato', unit: 'piece', grams: 123, label: 'medium', notes: 'Whole medium tomato' },
  { foodName: 'Tomato', unit: 'slice', grams: 15, notes: '1/4-inch slice' },
  { foodName: 'Tomato', unit: 'cup', grams: 180, notes: 'Chopped/diced' },
  { foodName: 'Tomatoes, red, ripe, cooked', unit: 'cup', grams: 240 },
  { foodName: 'Tomatoes, canned, red, ripe, diced', unit: 'cup', grams: 240, notes: 'Canned, with liquid' },
  
  // Broccoli
  { foodName: 'Broccoli, Raw', unit: 'cup', grams: 91, notes: 'Florets' },
  
  // Spinach
  { foodName: 'Spinach, Raw', unit: 'cup', grams: 30, notes: 'Fresh, loosely packed' },
  { foodName: 'Spinach, Raw', unit: 'leaf', grams: 10, notes: 'Large leaf' },
  
  // Avocado
  { foodName: 'Avocado', unit: 'piece', grams: 136, label: 'medium', notes: 'Whole, without skin/pit' },
  { foodName: 'Avocado', unit: 'piece', grams: 68, label: 'half', notes: 'Half avocado' },
  
  // Apple
  { foodName: 'Apple', unit: 'piece', grams: 182, label: 'medium', notes: 'Whole medium apple' },
  
  // Banana
  { foodName: 'Banana', unit: 'piece', grams: 118, label: 'medium', notes: 'Whole, peeled' },
];

// ============================================================================
// TIER 4: INTERNATIONAL STAPLES (40-60 entries)
// Common international pantry items (volume measurements)
// ============================================================================

const TIER_4_ASIAN: PortionEntry[] = [
  // Japanese
  { foodName: 'Miso', unit: 'tbsp', grams: 17, notes: 'Miso paste' },
  { foodName: 'Miso', unit: 'tsp', grams: 5.6 },
  { foodName: 'Mirin', unit: 'tbsp', grams: 15, notes: 'Sweet rice wine' },
  { foodName: 'Soy Sauce', unit: 'tbsp', grams: 16 },
  { foodName: 'Soy Sauce', unit: 'tsp', grams: 5.3 },
  { foodName: 'Rice Vinegar', unit: 'tbsp', grams: 15 },
  
  // Korean
  { foodName: 'Gochujang', unit: 'tbsp', grams: 17, notes: 'Korean chili paste' },
  { foodName: 'Gochugaru', unit: 'tbsp', grams: 8, notes: 'Korean chili flakes' },
  { foodName: 'Gochugaru', unit: 'tsp', grams: 2.7 },
  
  // Thai
  { foodName: 'Fish Sauce', unit: 'tbsp', grams: 16 },
  { foodName: 'Fish Sauce', unit: 'tsp', grams: 5.3 },
  { foodName: 'Coconut Milk', unit: 'cup', grams: 240, notes: 'Canned, full-fat' },
  { foodName: 'Coconut Milk', unit: 'tbsp', grams: 15 },
  
  // Indian
  { foodName: 'Ghee', unit: 'tbsp', grams: 13.6, notes: 'Clarified butter' },
  { foodName: 'Ghee', unit: 'tsp', grams: 4.5 },
  { foodName: 'Curry Paste', unit: 'tbsp', grams: 15, notes: 'Thai curry paste' },
];

// ============================================================================
// TIER 5: PREPARED/PACKAGED (20-40 entries)
// Convenience ingredients and packaged foods
// ============================================================================

const TIER_5_SPREADS: PortionEntry[] = [
  // Nut butters
  { foodName: 'Peanut Butter', unit: 'tbsp', grams: 16, notes: 'Smooth' },
  { foodName: 'Peanut Butter', unit: 'tsp', grams: 5.3 },
  { foodName: 'Almond Butter', unit: 'tbsp', grams: 16 },
  { foodName: 'Almond Butter', unit: 'tsp', grams: 5.3 },
  
  // Honey & sweeteners
  { foodName: 'Honey', unit: 'tbsp', grams: 21 },
  { foodName: 'Honey', unit: 'tsp', grams: 7 },
];

const TIER_5_PACKAGED: PortionEntry[] = [
  // Bread
  { foodName: 'Bread', unit: 'slice', grams: 29, notes: 'Standard sandwich bread' },
  { foodName: 'Tortilla', unit: 'piece', grams: 49, notes: '8-inch flour tortilla' },
  
  // Pasta (dry)
  { foodName: 'Pasta', unit: 'cup', grams: 85, notes: 'Dry, elbow macaroni' },
  
  // Nuts
  { foodName: 'Almonds', unit: 'cup', grams: 143, notes: 'Whole' },
  { foodName: 'Almonds', unit: 'tbsp', grams: 8.9 },
];

// ============================================================================
// MAIN SEEDING LOGIC
// ============================================================================

async function main() {
  console.log('🌱 Starting PortionOverride seeding...\n');
  console.log('Sprint 2: Tier 1-5 portion overrides\n');
  
  // Combine all tiers
  const allOverrides: PortionEntry[] = [
    ...TIER_1_EGGS,
    ...TIER_1_OILS,
    ...TIER_1_DAIRY,
    ...TIER_1_GRAINS,
    ...TIER_2_CHICKEN,
    ...TIER_2_BEEF,
    ...TIER_2_FISH,
    ...TIER_2_PLANT_PROTEINS,
    ...TIER_3_AROMATICS,
    ...TIER_3_VEGETABLES,
    ...TIER_4_ASIAN,
    ...TIER_5_SPREADS,
    ...TIER_5_PACKAGED,
  ];
  
  console.log(`📊 Total overrides to process: ${allOverrides.length}\n`);
  
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const notFound: string[] = [];
  const errors: Array<{ food: string; error: string }> = [];
  
  for (const override of allOverrides) {
    try {
      // Find food in database (fuzzy match)
      const food = await prisma.food.findFirst({
        where: {
          name: {
            equals: override.foodName,
            mode: 'insensitive'
          }
        }
      });
      
      if (!food) {
        console.log(`⚠️  Not found: "${override.foodName}" → ${override.unit} (${override.grams}g)`);
        notFound.push(override.foodName);
        continue;
      }
      
      // Upsert override
      const result = await prisma.portionOverride.upsert({
        where: {
          foodId_unit: {
            foodId: food.id,
            unit: override.unit,
          }
        },
        create: {
          foodId: food.id,
          unit: override.unit,
          grams: override.grams,
          label: override.label || null,
        },
        update: {
          grams: override.grams,
          label: override.label || null,
        }
      });
      
      const action = result.createdAt === result.updatedAt ? 'created' : 'updated';
      if (action === 'created') {
        created++;
        console.log(`✅ Created: ${food.name} → ${override.unit} = ${override.grams}g`);
      } else {
        updated++;
        console.log(`🔄 Updated: ${food.name} → ${override.unit} = ${override.grams}g`);
      }
      
    } catch (error: any) {
      console.error(`❌ Error processing "${override.foodName}":`, error.message);
      errors.push({ food: override.foodName, error: error.message });
      skipped++;
    }
  }
  
  // Summary
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 SEEDING SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`✅ Created: ${created}`);
  console.log(`🔄 Updated: ${updated}`);
  console.log(`⚠️  Not found: ${notFound.length}`);
  console.log(`❌ Errors: ${errors.length}`);
  console.log(`📊 Total processed: ${created + updated + notFound.length + errors.length}`);
  
  // Gap list
  if (notFound.length > 0) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📝 GAP LIST (Foods to add in Sprint 5)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Remove duplicates
    const uniqueNotFound = [...new Set(notFound)];
    uniqueNotFound.forEach(name => console.log(`  - ${name}`));
    console.log(`\n📊 Total missing foods: ${uniqueNotFound.length}`);
  }
  
  if (errors.length > 0) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('❌ ERRORS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    errors.forEach(({ food, error }) => console.log(`  ${food}: ${error}`));
  }
  
  console.log('\n✨ Seeding complete!\n');
}

main()
  .catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

