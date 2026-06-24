import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const foods = await prisma.openFoodFactsCache.findMany({
    select: {
      id: true,
      name: true,
      brandName: true,
      nutrientsPer100g: true,
    }
  });

  console.log(`Found ${foods.length} OFF foods to verify macros for.`);
  
  let validCount = 0;
  let missingMacros = 0;
  let invalidCaloriesCount = 0;
  const anomalies: any[] = [];

  for (const food of foods) {
      if (!food.nutrientsPer100g) {
          missingMacros++;
          continue;
      }
      
      const n: any = food.nutrientsPer100g;
      const cals = Number(n.calories) || 0;
      const protein = Number(n.protein) || 0;
      const carbs = Number(n.carbs) || 0;
      const fat = Number(n.fat) || 0;
      
      // Skip if completely 0 (water, zero cal drinks)
      if (cals === 0 && protein === 0 && carbs === 0 && fat === 0) {
          validCount++;
          continue;
      }
      
      // Calculate expected calories (Atwater general factor system)
      const expectedCals = (protein * 4) + (carbs * 4) + (fat * 9);
      
      // Calculate acceptable delta (e.g., 20% margin of error, plus a flat 20 cals buffer for low-cal foods)
      const diff = Math.abs(cals - expectedCals);
      const isPlausible = diff <= (expectedCals * 0.20) + 20;
      
      if (!isPlausible && cals > 0) {
          invalidCaloriesCount++;
          if (invalidCaloriesCount <= 20) {
             anomalies.push({
                 name: food.name,
                 brand: food.brandName,
                 statedCalories: cals,
                 expectedCalories: expectedCals,
                 macros: `P: ${protein}g, C: ${carbs}g, F: ${fat}g`
             });
          }
      } else {
          validCount++;
      }
  }
  
  console.log(`\n=== Macro Mathematical Verification Summary ===`);
  console.log(`Total checked: ${foods.length}`);
  console.log(`Valid/Plausible Macros: ${validCount}`);
  console.log(`Missing Macros: ${missingMacros}`);
  console.log(`Mathematically Impossible Macros (outside 20% error margin): ${invalidCaloriesCount}`);
  
  if (anomalies.length > 0) {
      console.log(`\nTop anomalies found:`);
      for (const a of anomalies) {
          console.log(`[${a.brand || 'No Brand'}] ${a.name} -> Stated Cals: ${a.statedCalories}, Expected based on macros: ~${a.expectedCalories.toFixed(0)} (${a.macros})`);
      }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
