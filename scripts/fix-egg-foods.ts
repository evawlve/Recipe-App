import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Script to audit and fix egg food data
 * 
 * Issues to fix:
 * 1. Incorrect calorie values (eggs should be ~143 kcal/100g or ~72 kcal per large egg)
 * 2. Prioritize raw/fresh eggs over processed/frozen/pasteurized
 * 3. Mark composite foods (tuna salad with egg, etc.) as suspect
 * 4. Ensure proper units for whole eggs (1 large = ~50g, 1 medium = ~44g, 1 small = ~38g)
 */

interface EggFood {
  id: string;
  name: string;
  brand: string | null;
  kcal100: number;
  protein100: number;
  fat100: number;
  carbs100: number;
  verification: string;
  source: string;
  categoryId: string | null;
  units: Array<{ id: string; label: string; grams: number }>;
  aliases: Array<{ id: string; alias: string }>;
}

const CORRECT_EGG_VALUES = {
  wholeEgg: {
    kcal100: 143,
    protein100: 12.6,
    fat100: 9.5,
    carbs100: 0.7,
  },
  eggWhite: {
    kcal100: 52,
    protein100: 11,
    fat100: 0.2,
    carbs100: 0.7,
  },
  eggYolk: {
    kcal100: 322,
    protein100: 15.9,
    fat100: 26.5,
    carbs100: 3.6,
  },
};

const EGG_UNITS = {
  wholeEgg: [
    { label: '1 large', grams: 50 },
    { label: '1 medium', grams: 44 },
    { label: '1 small', grams: 38 },
    { label: '1 extra large', grams: 56 },
  ],
  eggWhite: [
    { label: '1 large egg white', grams: 33 },
    { label: '1 medium egg white', grams: 29 },
  ],
  eggYolk: [
    { label: '1 large egg yolk', grams: 17 },
    { label: '1 medium egg yolk', grams: 15 },
  ],
};

async function auditEggFoods() {
  console.log('🔍 Auditing egg foods in database...\n');

  const eggFoods = await prisma.food.findMany({
    where: {
      OR: [
        { name: { contains: 'egg', mode: 'insensitive' } },
        { aliases: { some: { alias: { contains: 'egg', mode: 'insensitive' } } } },
      ],
    },
    include: {
      units: true,
      aliases: true,
    },
    orderBy: {
      name: 'asc',
    },
  });

  console.log(`Found ${eggFoods.length} egg-related foods\n`);

  const issues = {
    wrongCalories: [] as EggFood[],
    compositeFoods: [] as EggFood[],
    processedFoods: [] as EggFood[],
    missingUnits: [] as EggFood[],
    goodFoods: [] as EggFood[],
  };

  for (const food of eggFoods) {
    const isComposite = /with|salad|sandwich|omelet|scrambled|fried|prepared|dish/i.test(food.name);
    const isProcessed = /frozen|pasteurized|dried|powder|cooked|braised|boiled|hard-boiled|soft-boiled/i.test(food.name);
    const isWholeEgg = /\bwhole\b|\begg\b(?!.*white)(?!.*yolk)/i.test(food.name) && !/white|yolk/i.test(food.name);
    const isEggWhite = /white/i.test(food.name);
    const isEggYolk = /yolk/i.test(food.name);

    let expectedKcal = 0;
    if (isWholeEgg) expectedKcal = CORRECT_EGG_VALUES.wholeEgg.kcal100;
    else if (isEggWhite) expectedKcal = CORRECT_EGG_VALUES.eggWhite.kcal100;
    else if (isEggYolk) expectedKcal = CORRECT_EGG_VALUES.eggYolk.kcal100;

    // Check for calorie issues (±30% tolerance for cooked variations)
    const calorieDeviation = expectedKcal > 0 ? Math.abs(food.kcal100 - expectedKcal) / expectedKcal : 0;
    const hasWrongCalories = expectedKcal > 0 && calorieDeviation > 0.3;

    if (isComposite) {
      issues.compositeFoods.push(food as EggFood);
    } else if (hasWrongCalories) {
      issues.wrongCalories.push(food as EggFood);
    } else if (isProcessed) {
      issues.processedFoods.push(food as EggFood);
    } else if (food.units.length === 0 && !isComposite) {
      issues.missingUnits.push(food as EggFood);
    } else {
      issues.goodFoods.push(food as EggFood);
    }
  }

  // Print report
  console.log('📊 AUDIT REPORT\n');
  console.log(`✅ Good foods: ${issues.goodFoods.length}`);
  console.log(`❌ Wrong calories: ${issues.wrongCalories.length}`);
  console.log(`⚠️  Composite foods: ${issues.compositeFoods.length}`);
  console.log(`🔧 Processed foods: ${issues.processedFoods.length}`);
  console.log(`📏 Missing units: ${issues.missingUnits.length}`);
  console.log('');

  if (issues.wrongCalories.length > 0) {
    console.log('❌ FOODS WITH WRONG CALORIES:\n');
    for (const food of issues.wrongCalories.slice(0, 10)) {
      console.log(`  ${food.name}`);
      console.log(`    Current: ${food.kcal100} kcal/100g`);
      console.log(`    ID: ${food.id}`);
      console.log('');
    }
  }

  if (issues.compositeFoods.length > 0) {
    console.log('⚠️  COMPOSITE FOODS (should be marked as suspect):\n');
    for (const food of issues.compositeFoods.slice(0, 10)) {
      console.log(`  ${food.name} (${food.kcal100} kcal/100g) - ${food.verification}`);
    }
    console.log('');
  }

  if (issues.processedFoods.length > 0) {
    console.log('🔧 PROCESSED FOODS (de-prioritized in ranking):\n');
    for (const food of issues.processedFoods.slice(0, 10)) {
      console.log(`  ${food.name} (${food.kcal100} kcal/100g) - ${food.verification}`);
    }
    console.log('');
  }

  return issues;
}

async function fixEggFoods(dryRun = true) {
  console.log(`\n🔧 ${dryRun ? 'DRY RUN:' : ''} Fixing egg foods...\n`);

  const issues = await auditEggFoods();
  let fixed = 0;
  let marked = 0;

  // 1. Mark composite foods as suspect
  if (issues.compositeFoods.length > 0) {
    console.log(`\n📝 Marking ${issues.compositeFoods.length} composite foods as suspect...`);
    for (const food of issues.compositeFoods) {
      if (!dryRun) {
        await prisma.food.update({
          where: { id: food.id },
          data: { verification: 'suspect' },
        });
      }
      marked++;
    }
  }

  // 2. Fix obviously wrong calorie values (like 414 kcal for eggs)
  if (issues.wrongCalories.length > 0) {
    console.log(`\n📝 Found ${issues.wrongCalories.length} foods with incorrect calories.`);
    console.log('   Manual review recommended - marking as suspect for now...');
    for (const food of issues.wrongCalories) {
      if (!dryRun) {
        await prisma.food.update({
          where: { id: food.id },
          data: { verification: 'suspect' },
        });
      }
      marked++;
    }
  }

  // 3. Add missing units to whole eggs, egg whites, and egg yolks
  if (issues.missingUnits.length > 0) {
    console.log(`\n📏 Adding units to ${issues.missingUnits.length} foods...`);
    for (const food of issues.missingUnits) {
      const isWholeEgg = /\bwhole\b|\begg\b(?!.*white)(?!.*yolk)/i.test(food.name) && !/white|yolk/i.test(food.name);
      const isEggWhite = /white/i.test(food.name);
      const isEggYolk = /yolk/i.test(food.name);

      let unitsToAdd: Array<{ label: string; grams: number }> = [];
      if (isWholeEgg) unitsToAdd = EGG_UNITS.wholeEgg;
      else if (isEggWhite) unitsToAdd = EGG_UNITS.eggWhite;
      else if (isEggYolk) unitsToAdd = EGG_UNITS.eggYolk;

      if (unitsToAdd.length > 0 && !dryRun) {
        await prisma.foodUnit.createMany({
          data: unitsToAdd.map(unit => ({
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

  // 4. Ensure good egg foods have proper aliases
  const goodEggFoods = issues.goodFoods.filter(f => 
    /^egg/i.test(f.name) && !/white|yolk/i.test(f.name)
  );
  
  if (goodEggFoods.length > 0) {
    console.log(`\n🏷️  Adding aliases to ${goodEggFoods.length} good egg foods...`);
    for (const food of goodEggFoods) {
      const aliasesToAdd = [
        'whole egg',
        'eggs',
        'egg',
      ].filter(alias => 
        !food.aliases.some(a => a.alias.toLowerCase() === alias.toLowerCase())
      );

      if (aliasesToAdd.length > 0 && !dryRun) {
        await prisma.foodAlias.createMany({
          data: aliasesToAdd.map(alias => ({
            foodId: food.id,
            alias,
          })),
          skipDuplicates: true,
        });
        fixed++;
      }
    }
  }

  console.log(`\n✅ ${dryRun ? 'Would have' : 'Successfully'} fixed ${fixed} foods`);
  console.log(`✅ ${dryRun ? 'Would have' : 'Successfully'} marked ${marked} foods as suspect`);
  
  if (dryRun) {
    console.log('\n💡 Run with --fix flag to apply changes');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const shouldFix = args.includes('--fix');
  const dryRun = !shouldFix;

  if (dryRun) {
    console.log('🔍 Running in DRY RUN mode (no changes will be made)\n');
  } else {
    console.log('⚠️  LIVE MODE: Changes will be written to database\n');
  }

  await fixEggFoods(dryRun);

  await prisma.$disconnect();
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

