#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

/**
 * Sprint 7 Phase 2: Add Missing Nuts as Template Foods
 * 
 * Creating template nuts with accurate USDA nutrition data
 * Source: USDA SR Legacy database (verified nutrition facts)
 */

type NutTemplate = {
  name: string;
  aliases: string[];
  kcal100: number;
  protein100: number;
  carbs100: number;
  fat100: number;
  fiber100: number;
  sugar100: number;
};

const NUTS: NutTemplate[] = [
  {
    name: "Hazelnuts, Raw",
    aliases: ["hazelnuts", "filberts", "hazel nuts"],
    kcal100: 628,
    protein100: 15,
    carbs100: 16.7,
    fat100: 60.8,
    fiber100: 9.7,
    sugar100: 4.3,
  },
  {
    name: "Pine Nuts, Raw",
    aliases: ["pine nuts", "pignoli", "pinon nuts"],
    kcal100: 673,
    protein100: 13.7,
    carbs100: 13.1,
    fat100: 68.4,
    fiber100: 3.7,
    sugar100: 3.6,
  },
  {
    name: "Macadamia Nuts, Raw",
    aliases: ["macadamia nuts", "macadamias"],
    kcal100: 718,
    protein100: 7.9,
    carbs100: 13.8,
    fat100: 75.8,
    fiber100: 8.6,
    sugar100: 4.6,
  },
  {
    name: "Brazil Nuts, Raw",
    aliases: ["brazil nuts", "brazilnuts"],
    kcal100: 656,
    protein100: 14.3,
    carbs100: 12.3,
    fat100: 66.4,
    fiber100: 7.5,
    sugar100: 2.3,
  },
  {
    name: "Pistachios, Raw",
    aliases: ["pistachios", "pistachio nuts"],
    kcal100: 560,
    protein100: 20.2,
    carbs100: 27.2,
    fat100: 45.3,
    fiber100: 10.6,
    sugar100: 7.7,
  },
  {
    name: "Pecans, Raw",
    aliases: ["pecans", "pecan nuts", "pecan halves"],
    kcal100: 691,
    protein100: 9.2,
    carbs100: 13.9,
    fat100: 72,
    fiber100: 9.6,
    sugar100: 4,
  },
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  
  console.log('🌰 Sprint 7 Phase 2: Add Missing Nuts (Template Foods)\n');
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN' : '💾 LIVE RUN'}`);
  console.log('=' .repeat(80));
  
  let created = 0;
  let skipped = 0;
  let aliasesCreated = 0;
  let unitsCreated = 0;
  
  for (const nut of NUTS) {
    console.log(`\n📝 ${nut.name}`);
    
    // Check if exists
    const existing = await prisma.food.findFirst({
      where: {
        name: { equals: nut.name, mode: 'insensitive' },
      },
    });
    
    if (existing) {
      console.log(`   ⏭️  Already exists: ${existing.id}`);
      skipped++;
      continue;
    }
    
    console.log(`   📊 ${nut.kcal100} kcal, ${nut.protein100}g protein, ${nut.fat100}g fat`);
    console.log(`   🔗 Aliases: ${nut.aliases.join(', ')}`);
    
    if (!dryRun) {
      // Create food
      const food = await prisma.food.create({
        data: {
          name: nut.name,
          source: 'template',
          categoryId: 'legume', // Nuts category
          kcal100: nut.kcal100,
          protein100: nut.protein100,
          carbs100: nut.carbs100,
          fat100: nut.fat100,
          fiber100: nut.fiber100,
          sugar100: nut.sugar100,
          densityGml: null, // Nuts don't have liquid density
        },
      });
      
      console.log(`   ✅ Created: ${food.id}`);
      created++;
      
      // Add aliases
      for (const alias of nut.aliases) {
        if (alias.toLowerCase() !== food.name.toLowerCase()) {
          await prisma.foodAlias.create({
            data: {
              foodId: food.id,
              alias: alias,
            },
          });
          aliasesCreated++;
        }
      }
      
      // Add standard cup portion (typical: 120-135g for nuts)
      await prisma.foodUnit.create({
        data: {
          foodId: food.id,
          label: 'cup',
          grams: 130, // Standard cup of nuts
        },
      });
      unitsCreated++;
      
      console.log(`   🔗 Added ${nut.aliases.length} aliases, 1 unit (cup)`);
    } else {
      console.log(`   🔍 Would create (dry run)`);
      created++;
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 Summary:');
  console.log(`   ✅ Created: ${created} foods`);
  console.log(`   ⏭️  Skipped: ${skipped} foods (already exist)`);
  console.log(`   🔗 Aliases: ${aliasesCreated}`);
  console.log(`   📦 Units: ${unitsCreated}`);
  
  if (dryRun) {
    console.log('\n💡 Run without --dry-run to create foods');
  } else {
    console.log('\n✅ Done!');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

