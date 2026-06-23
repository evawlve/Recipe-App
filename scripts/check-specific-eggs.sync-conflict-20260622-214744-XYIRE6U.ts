import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Searching for specific problematic egg foods...\n');

  // Search for the foods mentioned by the user
  const searches = [
    'Eggs, Grade A, Large, egg whole',
    'Egg, yolk, raw, frozen, pasteurized',
    'egg, yolk only, raw',
  ];

  for (const search of searches) {
    const foods = await prisma.food.findMany({
      where: {
        name: {
          contains: search,
          mode: 'insensitive',
        },
      },
      include: {
        units: true,
        aliases: true,
      },
    });

    console.log(`\n📝 "${search}":`);
    if (foods.length === 0) {
      console.log('   ❌ Not found');
    } else {
      for (const food of foods) {
        console.log(`\n   Name: ${food.name}`);
        console.log(`   ID: ${food.id}`);
        console.log(`   Calories: ${food.kcal100} kcal/100g`);
        console.log(`   Protein: ${food.protein100}g/100g`);
        console.log(`   Fat: ${food.fat100}g/100g`);
        console.log(`   Carbs: ${food.carbs100}g/100g`);
        console.log(`   Verification: ${food.verification}`);
        console.log(`   Source: ${food.source}`);
        console.log(`   Units: ${food.units.length > 0 ? food.units.map(u => `${u.label} (${u.grams}g)`).join(', ') : 'None'}`);
        console.log(`   Aliases: ${food.aliases.length > 0 ? food.aliases.map(a => a.alias).join(', ') : 'None'}`);
        
        // Calculate calories per large egg (50g)
        const kcalPerLargeEgg = (food.kcal100 * 50) / 100;
        console.log(`   📊 Per large egg (50g): ${kcalPerLargeEgg.toFixed(0)} kcal`);
      }
    }
  }

  // Also search more broadly
  console.log('\n\n🔍 All "whole egg" foods with high calories (>200 kcal/100g):\n');
  const problematicEggs = await prisma.food.findMany({
    where: {
      AND: [
        {
          OR: [
            { name: { contains: 'egg whole', mode: 'insensitive' } },
            { name: { contains: 'whole egg', mode: 'insensitive' } },
          ],
        },
        { kcal100: { gt: 200 } },
      ],
    },
    include: {
      units: true,
    },
  });

  for (const food of problematicEggs) {
    const kcalPerLargeEgg = (food.kcal100 * 50) / 100;
    console.log(`   ${food.name}`);
    console.log(`   → ${food.kcal100} kcal/100g (${kcalPerLargeEgg.toFixed(0)} kcal per large egg)`);
    console.log(`   → ID: ${food.id}, Verification: ${food.verification}\n`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);

