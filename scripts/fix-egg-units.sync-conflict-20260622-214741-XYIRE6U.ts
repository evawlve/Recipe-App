import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Fix egg units - remove incorrect "1 cup, diced (140g)" and add proper egg units
 */

const EGG_FIXES = [
  {
    searchName: 'Eggs, Grade A, Large, egg whole',
    correctUnits: [
      { label: '1 large', grams: 50 },
      { label: '1 medium', grams: 44 },
      { label: '1 small', grams: 38 },
      { label: '1 extra large', grams: 56 },
      { label: '1 jumbo', grams: 63 },
    ],
  },
  {
    searchName: 'Egg, whole, raw',
    correctUnits: [
      { label: '1 large', grams: 50 },
      { label: '1 medium', grams: 44 },
      { label: '1 small', grams: 38 },
      { label: '1 extra large', grams: 56 },
    ],
  },
  {
    searchName: 'Egg, yolk only, raw',
    correctUnits: [
      { label: '1 large egg yolk', grams: 17 },
      { label: '1 medium egg yolk', grams: 15 },
      { label: '1 small egg yolk', grams: 13 },
    ],
  },
  {
    searchName: 'Egg, yolk, raw, frozen, pasteurized',
    correctUnits: [
      { label: '1 large egg yolk', grams: 17 },
      { label: '1 tbsp', grams: 15 },
    ],
  },
  {
    searchName: 'Egg, white only, raw',
    correctUnits: [
      { label: '1 large egg white', grams: 33 },
      { label: '1 medium egg white', grams: 29 },
      { label: '1 small egg white', grams: 25 },
    ],
  },
];

async function fixEggUnits(dryRun = true) {
  console.log(`${dryRun ? '🔍 DRY RUN:' : '🔧 FIXING:'} Updating egg units...\n`);

  let fixed = 0;
  let marked = 0;

  for (const fix of EGG_FIXES) {
    const foods = await prisma.food.findMany({
      where: {
        name: {
          equals: fix.searchName,
          mode: 'insensitive',
        },
      },
      include: {
        units: true,
      },
    });

    for (const food of foods) {
      console.log(`\n📝 ${food.name}`);
      console.log(`   Current units: ${food.units.map(u => `${u.label} (${u.grams}g)`).join(', ')}`);
      console.log(`   New units: ${fix.correctUnits.map(u => `${u.label} (${u.grams}g)`).join(', ')}`);

      if (!dryRun) {
        // Delete all existing units
        await prisma.foodUnit.deleteMany({
          where: { foodId: food.id },
        });

        // Add correct units
        await prisma.foodUnit.createMany({
          data: fix.correctUnits.map(unit => ({
            foodId: food.id,
            label: unit.label,
            grams: unit.grams,
          })),
        });

        console.log(`   ✅ Updated`);
        fixed++;
      } else {
        console.log(`   ℹ️  Would update`);
      }
    }
  }

  // Also fix all other egg foods with the wrong "1 cup, diced (140g)" unit
  console.log('\n\n📝 Finding other egg foods with "1 cup, diced" units...');
  const eggFoodsWithWrongUnits = await prisma.food.findMany({
    where: {
      AND: [
        {
          OR: [
            { name: { contains: 'egg', mode: 'insensitive' } },
            { name: { contains: 'eggs', mode: 'insensitive' } },
          ],
        },
        {
          units: {
            some: {
              label: {
                contains: 'cup, diced',
                mode: 'insensitive',
              },
            },
          },
        },
      ],
    },
    include: {
      units: true,
    },
  });

  console.log(`\nFound ${eggFoodsWithWrongUnits.length} egg foods with "cup, diced" units:`);
  
  for (const food of eggFoodsWithWrongUnits) {
    const isWholeEgg = /\bwhole\b|^egg,?\s(?!white|yolk)/i.test(food.name);
    const isEggWhite = /white/i.test(food.name);
    const isEggYolk = /yolk/i.test(food.name);
    const isComposite = /with|salad|sandwich|fried|scrambled|omelet/i.test(food.name);

    // Skip composite foods
    if (isComposite) continue;

    console.log(`\n   ${food.name}`);
    console.log(`   Current: ${food.units.map(u => `${u.label} (${u.grams}g)`).join(', ')}`);

    let correctUnits: Array<{ label: string; grams: number }> = [];
    if (isWholeEgg) {
      correctUnits = [
        { label: '1 large', grams: 50 },
        { label: '1 medium', grams: 44 },
        { label: '1 small', grams: 38 },
      ];
    } else if (isEggWhite) {
      correctUnits = [
        { label: '1 large egg white', grams: 33 },
        { label: '1 tbsp', grams: 15 },
      ];
    } else if (isEggYolk) {
      correctUnits = [
        { label: '1 large egg yolk', grams: 17 },
        { label: '1 tbsp', grams: 15 },
      ];
    }

    if (correctUnits.length > 0) {
      console.log(`   New: ${correctUnits.map(u => `${u.label} (${u.grams}g)`).join(', ')}`);
      
      if (!dryRun) {
        // Delete wrong units
        await prisma.foodUnit.deleteMany({
          where: {
            AND: [
              { foodId: food.id },
              { label: { contains: 'cup, diced' } },
            ],
          },
        });

        // Add correct units
        await prisma.foodUnit.createMany({
          data: correctUnits.map(unit => ({
            foodId: food.id,
            label: unit.label,
            grams: unit.grams,
          })),
          skipDuplicates: true,
        });

        fixed++;
      }
    }
  }

  console.log(`\n\n✅ ${dryRun ? 'Would fix' : 'Fixed'} ${fixed} foods`);
  
  if (dryRun) {
    console.log('\n💡 Run with --fix flag to apply changes');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const shouldFix = args.includes('--fix');

  await fixEggUnits(!shouldFix);
  await prisma.$disconnect();
}

main().catch(console.error);

