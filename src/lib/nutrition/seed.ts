import { prisma } from '../db';
// import { FoodSource } from '@prisma/client'; // Not needed - source is just a string

const initialFoods = [
  // Proteins
  {
    name: 'Chicken Breast',
    brand: null,
    source: 'seed',
    kcal100: 165,
    protein100: 31,
    carbs100: 0,
    fat100: 3.6,
    fiber100: 0,
    sugar100: 0
  },
  {
    name: 'Ground Turkey',
    brand: null,
    source: 'seed',
    kcal100: 189,
    protein100: 27.4,
    carbs100: 0,
    fat100: 8.2,
    fiber100: 0,
    sugar100: 0
  },
  {
    name: 'Salmon',
    brand: null,
    source: 'seed',
    kcal100: 208,
    protein100: 25.4,
    carbs100: 0,
    fat100: 12.4,
    fiber100: 0,
    sugar100: 0
  },
  {
    name: 'Eggs',
    brand: null,
    source: 'seed',
    kcal100: 155,
    protein100: 13,
    carbs100: 1.1,
    fat100: 11,
    fiber100: 0,
    sugar100: 1.1
  },
  {
    name: 'Greek Yogurt',
    brand: null,
    source: 'seed',
    kcal100: 59,
    protein100: 10,
    carbs100: 3.6,
    fat100: 0.4,
    fiber100: 0,
    sugar100: 3.6
  },
  {
    name: 'Cottage Cheese',
    brand: null,
    source: 'seed',
    kcal100: 98,
    protein100: 11,
    carbs100: 3.4,
    fat100: 4.3,
    fiber100: 0,
    sugar100: 2.7
  },
  {
    name: 'Whey Protein Isolate',
    brand: null,
    source: 'seed',
    kcal100: 370,
    protein100: 90,
    carbs100: 1,
    fat100: 1,
    fiber100: 0,
    sugar100: 1
  },

  // Carbs
  {
    name: 'Oats',
    brand: null,
    source: 'seed',
    kcal100: 389,
    protein100: 16.9,
    carbs100: 66.3,
    fat100: 6.9,
    fiber100: 10.6,
    sugar100: 0
  },
  {
    name: 'Brown Rice',
    brand: null,
    source: 'seed',
    kcal100: 111,
    protein100: 2.6,
    carbs100: 23,
    fat100: 0.9,
    fiber100: 1.8,
    sugar100: 0.4
  },
  {
    name: 'White Rice',
    brand: null,
    source: 'seed',
    kcal100: 130,
    protein100: 2.7,
    carbs100: 28,
    fat100: 0.3,
    fiber100: 0.4,
    sugar100: 0.1
  },
  {
    name: 'Sweet Potato',
    brand: null,
    source: 'seed',
    kcal100: 86,
    protein100: 1.6,
    carbs100: 20.1,
    fat100: 0.1,
    fiber100: 3,
    sugar100: 4.2
  },
  {
    name: 'Quinoa',
    brand: null,
    source: 'seed',
    kcal100: 120,
    protein100: 4.4,
    carbs100: 22,
    fat100: 1.9,
    fiber100: 2.8,
    sugar100: 0.9
  },
  {
    name: 'Banana',
    brand: null,
    source: 'seed',
    kcal100: 89,
    protein100: 1.1,
    carbs100: 23,
    fat100: 0.3,
    fiber100: 2.6,
    sugar100: 12.2
  },

  // Fats
  {
    name: 'Avocado',
    brand: null,
    source: 'seed',
    kcal100: 160,
    protein100: 2,
    carbs100: 8.5,
    fat100: 14.7,
    fiber100: 6.7,
    sugar100: 0.7
  },
  {
    name: 'Almonds',
    brand: null,
    source: 'seed',
    kcal100: 579,
    protein100: 21.2,
    carbs100: 21.6,
    fat100: 49.9,
    fiber100: 12.5,
    sugar100: 4.4
  },
  {
    name: 'Olive Oil',
    brand: null,
    source: 'seed',
    kcal100: 884,
    protein100: 0,
    carbs100: 0,
    fat100: 100,
    fiber100: 0,
    sugar100: 0
  },
  {
    name: 'Coconut Oil',
    brand: null,
    source: 'seed',
    kcal100: 862,
    protein100: 0,
    carbs100: 0,
    fat100: 100,
    fiber100: 0,
    sugar100: 0
  },

  // Vegetables
  {
    name: 'Broccoli',
    brand: null,
    source: 'seed',
    kcal100: 34,
    protein100: 2.8,
    carbs100: 6.6,
    fat100: 0.4,
    fiber100: 2.6,
    sugar100: 1.5
  },
  {
    name: 'Spinach',
    brand: null,
    source: 'seed',
    kcal100: 23,
    protein100: 2.9,
    carbs100: 3.6,
    fat100: 0.4,
    fiber100: 2.2,
    sugar100: 0.4
  },
  {
    name: 'Carrots',
    brand: null,
    source: 'seed',
    kcal100: 41,
    protein100: 0.9,
    carbs100: 9.6,
    fat100: 0.2,
    fiber100: 2.8,
    sugar100: 4.7
  },

  // Dairy
  {
    name: 'Milk',
    brand: null,
    source: 'seed',
    kcal100: 42,
    protein100: 3.4,
    carbs100: 5,
    fat100: 1,
    fiber100: 0,
    sugar100: 5
  },
  {
    name: 'Cheddar Cheese',
    brand: null,
    source: 'seed',
    kcal100: 403,
    protein100: 25,
    carbs100: 1.3,
    fat100: 33,
    fiber100: 0,
    sugar100: 0.5
  }
];

export async function seedFoods() {
  console.log('Seeding foods...');
  
  for (const food of initialFoods) {
    // Check if food already exists
    const existing = await prisma.food.findFirst({
      where: {
        name: food.name,
        brand: food.brand
      }
    });
    
    if (!existing) {
      await prisma.food.create({
        data: food
      });
    }
  }
  
  console.log(`Seeded ${initialFoods.length} foods`);
}

// Add unique constraint for name + brand combination
export async function addFoodConstraints() {
  // This would be handled by the Prisma migration
  // but we can add it here for reference
}
