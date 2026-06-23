const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function upsertFood(args) {
  return prisma.food.upsert({
    where: { id: args.id },
    update: args,
    create: args,
  });
}

async function main() {
  console.log('🌱 Seeding top staples...');

  // OILS
  await upsertFood({
    id: 'seed_olive_oil',
    name: 'Olive Oil',
    brand: null,
    categoryId: 'oil',
    source: 'template',
    verification: 'verified',
    densityGml: 0.91,
    kcal100: 884, protein100: 0, carbs100: 0, fat100: 100, fiber100: 0, sugar100: 0,
    popularity: 100,
    units: { create: [{ label: '1 tbsp', grams: 13.6 }] },
  });

  await upsertFood({
    id: 'seed_avocado_oil',
    name: 'Avocado Oil',
    categoryId: 'oil',
    source: 'template',
    verification: 'verified',
    densityGml: 0.92,
    kcal100: 884, protein100: 0, carbs100: 0, fat100: 100, fiber100: 0, sugar100: 0,
    popularity: 80,
    units: { create: [{ label: '1 tbsp', grams: 13.8 }] },
  });

  await upsertFood({
    id: 'seed_canola_oil',
    name: 'Canola Oil',
    categoryId: 'oil',
    source: 'template',
    verification: 'verified',
    densityGml: 0.92,
    kcal100: 884, protein100: 0, carbs100: 0, fat100: 100, fiber100: 0, sugar100: 0,
    popularity: 70,
    units: { create: [{ label: '1 tbsp', grams: 13.8 }] },
  });

  await upsertFood({
    id: 'seed_butter',
    name: 'Butter',
    categoryId: 'oil',
    source: 'template',
    verification: 'verified',
    densityGml: 0.91,
    kcal100: 717, protein100: 0.9, carbs100: 0.1, fat100: 81, fiber100: 0, sugar100: 0.1,
    popularity: 90,
    units: { create: [{ label: '1 tbsp', grams: 14.2 }] },
  });

  await upsertFood({
    id: 'seed_ghee',
    name: 'Ghee',
    categoryId: 'oil',
    source: 'template',
    verification: 'verified',
    densityGml: 0.91,
    kcal100: 900, protein100: 0, carbs100: 0, fat100: 100, fiber100: 0, sugar100: 0,
    popularity: 60,
    units: { create: [{ label: '1 tbsp', grams: 13.6 }] },
  });

  // FLOURS/STARCHES
  await upsertFood({
    id: 'seed_ap_flour',
    name: 'All-Purpose Flour',
    categoryId: 'flour',
    source: 'template',
    verification: 'verified',
    densityGml: 0.53,
    kcal100: 364, protein100: 10, carbs100: 76, fat100: 1,
    fiber100: 3, sugar100: 1,
    popularity: 80,
    units: { create: [{ label: '1 cup', grams: 120 }] },
  });

  await upsertFood({
    id: 'seed_whole_wheat_flour',
    name: 'Whole Wheat Flour',
    categoryId: 'flour',
    source: 'template',
    verification: 'verified',
    densityGml: 0.55,
    kcal100: 340, protein100: 13, carbs100: 72, fat100: 2,
    fiber100: 10, sugar100: 0.4,
    popularity: 70,
    units: { create: [{ label: '1 cup', grams: 120 }] },
  });

  await upsertFood({
    id: 'seed_almond_flour',
    name: 'Almond Flour',
    categoryId: 'flour',
    source: 'template',
    verification: 'verified',
    densityGml: 0.45,
    kcal100: 600, protein100: 21, carbs100: 20, fat100: 54,
    fiber100: 12, sugar100: 4,
    popularity: 60,
    units: { create: [{ label: '1 cup', grams: 96 }] },
  });

  await upsertFood({
    id: 'seed_oat_flour',
    name: 'Oat Flour',
    categoryId: 'flour',
    source: 'template',
    verification: 'verified',
    densityGml: 0.50,
    kcal100: 404, protein100: 15, carbs100: 66, fat100: 9,
    fiber100: 6, sugar100: 1,
    popularity: 50,
    units: { create: [{ label: '1 cup', grams: 90 }] },
  });

  await upsertFood({
    id: 'seed_corn_starch',
    name: 'Corn Starch',
    categoryId: 'starch',
    source: 'template',
    verification: 'verified',
    densityGml: 0.60,
    kcal100: 381, protein100: 0.3, carbs100: 91, fat100: 0.1,
    fiber100: 0.9, sugar100: 0,
    popularity: 40,
    units: { create: [{ label: '1 tbsp', grams: 8 }] },
  });

  // PROTEINS
  await upsertFood({
    id: 'seed_chicken_breast',
    name: 'Chicken Breast',
    categoryId: 'protein',
    source: 'template',
    verification: 'verified',
    densityGml: 1.05,
    kcal100: 165, protein100: 31, carbs100: 0, fat100: 3.6,
    fiber100: 0, sugar100: 0,
    popularity: 95,
    units: { create: [{ label: '4 oz', grams: 113 }] },
  });

  await upsertFood({
    id: 'seed_chicken_thigh',
    name: 'Chicken Thigh',
    categoryId: 'protein',
    source: 'template',
    verification: 'verified',
    densityGml: 1.05,
    kcal100: 209, protein100: 26, carbs100: 0, fat100: 10,
    fiber100: 0, sugar100: 0,
    popularity: 80,
    units: { create: [{ label: '4 oz', grams: 113 }] },
  });

  await upsertFood({
    id: 'seed_beef_90_10',
    name: 'Ground Beef 90/10',
    categoryId: 'protein',
    source: 'template',
    verification: 'verified',
    densityGml: 1.05,
    kcal100: 176, protein100: 20, carbs100: 0, fat100: 10,
    fiber100: 0, sugar100: 0,
    popularity: 85,
    units: { create: [{ label: '4 oz', grams: 113 }] },
  });

  await upsertFood({
    id: 'seed_salmon',
    name: 'Salmon',
    categoryId: 'protein',
    source: 'template',
    verification: 'verified',
    densityGml: 1.05,
    kcal100: 208, protein100: 25, carbs100: 0, fat100: 12,
    fiber100: 0, sugar100: 0,
    popularity: 90,
    units: { create: [{ label: '4 oz', grams: 113 }] },
  });

  await upsertFood({
    id: 'seed_egg',
    name: 'Egg',
    categoryId: 'protein',
    source: 'template',
    verification: 'verified',
    densityGml: 1.03,
    kcal100: 155, protein100: 13, carbs100: 1.1, fat100: 11,
    fiber100: 0, sugar100: 1.1,
    popularity: 95,
    units: { create: [{ label: '1 large', grams: 50 }] },
  });

  await upsertFood({
    id: 'seed_egg_white',
    name: 'Egg White',
    categoryId: 'protein',
    source: 'template',
    verification: 'verified',
    densityGml: 1.03,
    kcal100: 52, protein100: 11, carbs100: 0.7, fat100: 0.2,
    fiber100: 0, sugar100: 0.7,
    popularity: 80,
    units: { create: [{ label: '1 large', grams: 33 }] },
  });

  await upsertFood({
    id: 'seed_greek_yogurt_0',
    name: 'Greek Yogurt 0%',
    categoryId: 'dairy',
    source: 'template',
    verification: 'verified',
    densityGml: 1.05,
    kcal100: 59, protein100: 10, carbs100: 3.6, fat100: 0.4,
    fiber100: 0, sugar100: 3.6,
    popularity: 90,
    units: { create: [{ label: '1 cup', grams: 170 }] },
  });

  // DAIRY/ALT
  await upsertFood({
    id: 'seed_nonfat_milk',
    name: 'Milk, Nonfat',
    categoryId: 'liquid',
    source: 'template',
    verification: 'verified',
    densityGml: 1.03,
    kcal100: 34, protein100: 3.4, carbs100: 5, fat100: 0.1,
    popularity: 60,
    units: { create: [{ label: '1 cup', grams: 245 }] },
  });

  await upsertFood({
    id: 'seed_milk_2',
    name: 'Milk, 2%',
    categoryId: 'liquid',
    source: 'template',
    verification: 'verified',
    densityGml: 1.03,
    kcal100: 50, protein100: 3.3, carbs100: 4.7, fat100: 2,
    popularity: 70,
    units: { create: [{ label: '1 cup', grams: 244 }] },
  });

  await upsertFood({
    id: 'seed_milk_whole',
    name: 'Milk, Whole',
    categoryId: 'liquid',
    source: 'template',
    verification: 'verified',
    densityGml: 1.03,
    kcal100: 61, protein100: 3.2, carbs100: 4.7, fat100: 3.3,
    popularity: 50,
    units: { create: [{ label: '1 cup', grams: 244 }] },
  });

  await upsertFood({
    id: 'seed_almond_milk',
    name: 'Almond Milk, Unsweetened',
    categoryId: 'liquid',
    source: 'template',
    verification: 'verified',
    densityGml: 1.00,
    kcal100: 17, protein100: 0.6, carbs100: 0.6, fat100: 1.1,
    fiber100: 0.4, sugar100: 0.2,
    popularity: 60,
    units: { create: [{ label: '1 cup', grams: 240 }] },
  });

  // GRAINS
  await upsertFood({
    id: 'seed_white_rice',
    name: 'White Rice, Uncooked',
    categoryId: 'grain',
    source: 'template',
    verification: 'verified',
    densityGml: 0.85,
    kcal100: 365, protein100: 7, carbs100: 80, fat100: 0.6,
    fiber100: 1.3, sugar100: 0,
    popularity: 85,
    units: { create: [{ label: '1 cup', grams: 185 }] },
  });

  await upsertFood({
    id: 'seed_brown_rice',
    name: 'Brown Rice, Uncooked',
    categoryId: 'grain',
    source: 'template',
    verification: 'verified',
    densityGml: 0.85,
    kcal100: 370, protein100: 7.9, carbs100: 77, fat100: 2.9,
    fiber100: 3.5, sugar100: 0.7,
    popularity: 80,
    units: { create: [{ label: '1 cup', grams: 185 }] },
  });

  await upsertFood({
    id: 'seed_oats_dry',
    name: 'Oats, Dry',
    categoryId: 'grain',
    source: 'template',
    verification: 'verified',
    densityGml: 0.36,
    kcal100: 389, protein100: 17, carbs100: 66, fat100: 7,
    fiber100: 11, sugar100: 1,
    popularity: 90,
    units: { create: [{ label: '1 cup', grams: 90 }] },
  });

  await upsertFood({
    id: 'seed_quinoa',
    name: 'Quinoa, Uncooked',
    categoryId: 'grain',
    source: 'template',
    verification: 'verified',
    densityGml: 0.80,
    kcal100: 368, protein100: 14, carbs100: 64, fat100: 6,
    fiber100: 7, sugar100: 0,
    popularity: 70,
    units: { create: [{ label: '1 cup', grams: 170 }] },
  });

  // LEGUMES
  await upsertFood({
    id: 'seed_black_beans',
    name: 'Black Beans, Cooked',
    categoryId: 'legume',
    source: 'template',
    verification: 'verified',
    densityGml: 1.05,
    kcal100: 132, protein100: 8.9, carbs100: 24, fat100: 0.5,
    fiber100: 8.7, sugar100: 0.3,
    popularity: 80,
    units: { create: [{ label: '1 cup', grams: 172 }] },
  });

  await upsertFood({
    id: 'seed_chickpeas',
    name: 'Chickpeas, Cooked',
    categoryId: 'legume',
    source: 'template',
    verification: 'verified',
    densityGml: 1.05,
    kcal100: 164, protein100: 8.9, carbs100: 27, fat100: 2.6,
    fiber100: 7.6, sugar100: 4.8,
    popularity: 75,
    units: { create: [{ label: '1 cup', grams: 164 }] },
  });

  await upsertFood({
    id: 'seed_lentils',
    name: 'Lentils, Cooked',
    categoryId: 'legume',
    source: 'template',
    verification: 'verified',
    densityGml: 1.05,
    kcal100: 116, protein100: 9, carbs100: 20, fat100: 0.4,
    fiber100: 7.9, sugar100: 1.8,
    popularity: 70,
    units: { create: [{ label: '1 cup', grams: 198 }] },
  });

  await upsertFood({
    id: 'seed_tofu_firm',
    name: 'Tofu, Firm',
    categoryId: 'legume',
    source: 'template',
    verification: 'verified',
    densityGml: 1.05,
    kcal100: 144, protein100: 15, carbs100: 4.3, fat100: 8.7,
    fiber100: 2.3, sugar100: 0.7,
    popularity: 60,
    units: { create: [{ label: '1 cup', grams: 126 }] },
  });

  // FRUITS/VEG
  await upsertFood({
    id: 'seed_banana',
    name: 'Banana',
    categoryId: 'fruit',
    source: 'template',
    verification: 'verified',
    densityGml: 1.00,
    kcal100: 89, protein100: 1.1, carbs100: 23, fat100: 0.3,
    fiber100: 2.6, sugar100: 12,
    popularity: 95,
    units: { create: [{ label: '1 medium', grams: 118 }] },
  });

  await upsertFood({
    id: 'seed_apple',
    name: 'Apple',
    categoryId: 'fruit',
    source: 'template',
    verification: 'verified',
    densityGml: 1.00,
    kcal100: 52, protein100: 0.3, carbs100: 14, fat100: 0.2,
    fiber100: 2.4, sugar100: 10,
    popularity: 90,
    units: { create: [{ label: '1 medium', grams: 182 }] },
  });

  await upsertFood({
    id: 'seed_blueberries',
    name: 'Blueberries',
    categoryId: 'fruit',
    source: 'template',
    verification: 'verified',
    densityGml: 1.00,
    kcal100: 57, protein100: 0.7, carbs100: 14, fat100: 0.3,
    fiber100: 2.4, sugar100: 10,
    popularity: 80,
    units: { create: [{ label: '1 cup', grams: 148 }] },
  });

  await upsertFood({
    id: 'seed_avocado',
    name: 'Avocado',
    categoryId: 'fruit',
    source: 'template',
    verification: 'verified',
    densityGml: 1.00,
    kcal100: 160, protein100: 2, carbs100: 9, fat100: 15,
    fiber100: 7, sugar100: 0.7,
    popularity: 85,
    units: { create: [{ label: '1 medium', grams: 150 }] },
  });

  await upsertFood({
    id: 'seed_spinach',
    name: 'Spinach, Raw',
    categoryId: 'vegetable',
    source: 'template',
    verification: 'verified',
    densityGml: 1.00,
    kcal100: 23, protein100: 2.9, carbs100: 3.6, fat100: 0.4,
    fiber100: 2.2, sugar100: 0.4,
    popularity: 75,
    units: { create: [{ label: '1 cup', grams: 30 }] },
  });

  await upsertFood({
    id: 'seed_broccoli',
    name: 'Broccoli, Raw',
    categoryId: 'vegetable',
    source: 'template',
    verification: 'verified',
    densityGml: 1.00,
    kcal100: 34, protein100: 2.8, carbs100: 7, fat100: 0.4,
    fiber100: 2.6, sugar100: 1.5,
    popularity: 80,
    units: { create: [{ label: '1 cup', grams: 91 }] },
  });

  // NUTS/SEEDS
  await upsertFood({
    id: 'seed_peanut_butter',
    name: 'Peanut Butter',
    categoryId: 'nut',
    source: 'template',
    verification: 'verified',
    densityGml: 1.00,
    kcal100: 588, protein100: 25, carbs100: 20, fat100: 50,
    fiber100: 8.5, sugar100: 9.2,
    popularity: 90,
    units: { create: [{ label: '2 tbsp', grams: 32 }] },
  });

  await upsertFood({
    id: 'seed_almonds',
    name: 'Almonds',
    categoryId: 'nut',
    source: 'template',
    verification: 'verified',
    densityGml: 1.00,
    kcal100: 579, protein100: 21, carbs100: 22, fat100: 50,
    fiber100: 12, sugar100: 4.4,
    popularity: 85,
    units: { create: [{ label: '1 oz', grams: 28 }] },
  });

  await upsertFood({
    id: 'seed_chia_seeds',
    name: 'Chia Seeds',
    categoryId: 'seed',
    source: 'template',
    verification: 'verified',
    densityGml: 1.00,
    kcal100: 486, protein100: 17, carbs100: 42, fat100: 31,
    fiber100: 34, sugar100: 0,
    popularity: 70,
    units: { create: [{ label: '1 tbsp', grams: 12 }] },
  });

  // PROTEIN POWDERS
  await upsertFood({
    id: 'seed_whey_isolate',
    name: 'Whey Protein Isolate (Generic)',
    categoryId: 'whey',
    source: 'template',
    verification: 'verified',
    densityGml: 0.5,
    kcal100: 380, protein100: 85, carbs100: 5, fat100: 2,
    popularity: 120,
    units: { create: [{ label: '1 scoop', grams: 32 }] },
  });

  await upsertFood({
    id: 'seed_whey_concentrate',
    name: 'Whey Protein Concentrate (Generic)',
    categoryId: 'whey',
    source: 'template',
    verification: 'verified',
    densityGml: 0.5,
    kcal100: 370, protein100: 80, carbs100: 8, fat100: 3,
    popularity: 100,
    units: { create: [{ label: '1 scoop', grams: 32 }] },
  });

  console.log('✅ Seeded 50+ top staples');
}

main().finally(async () => {
  await prisma.$disconnect();
});
