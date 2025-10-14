import { prisma } from '../db';
import { FoodSource } from '@prisma/client';

const initialFoods = [
  // Proteins
  {
    name: 'Chicken Breast',
    brand: null,
    source: FoodSource.SEED,
    calories: 165,
    proteinG: 31,
    carbsG: 0,
    fatG: 3.6,
    fiberG: 0,
    sugarG: 0
  },
  {
    name: 'Ground Turkey',
    brand: null,
    source: FoodSource.SEED,
    calories: 189,
    proteinG: 27.4,
    carbsG: 0,
    fatG: 8.2,
    fiberG: 0,
    sugarG: 0
  },
  {
    name: 'Salmon',
    brand: null,
    source: FoodSource.SEED,
    calories: 208,
    proteinG: 25.4,
    carbsG: 0,
    fatG: 12.4,
    fiberG: 0,
    sugarG: 0
  },
  {
    name: 'Eggs',
    brand: null,
    source: FoodSource.SEED,
    calories: 155,
    proteinG: 13,
    carbsG: 1.1,
    fatG: 11,
    fiberG: 0,
    sugarG: 1.1
  },
  {
    name: 'Greek Yogurt',
    brand: null,
    source: FoodSource.SEED,
    calories: 59,
    proteinG: 10,
    carbsG: 3.6,
    fatG: 0.4,
    fiberG: 0,
    sugarG: 3.6
  },
  {
    name: 'Cottage Cheese',
    brand: null,
    source: FoodSource.SEED,
    calories: 98,
    proteinG: 11,
    carbsG: 3.4,
    fatG: 4.3,
    fiberG: 0,
    sugarG: 2.7
  },
  {
    name: 'Whey Protein Isolate',
    brand: null,
    source: FoodSource.SEED,
    calories: 370,
    proteinG: 90,
    carbsG: 1,
    fatG: 1,
    fiberG: 0,
    sugarG: 1
  },

  // Carbs
  {
    name: 'Oats',
    brand: null,
    source: FoodSource.SEED,
    calories: 389,
    proteinG: 16.9,
    carbsG: 66.3,
    fatG: 6.9,
    fiberG: 10.6,
    sugarG: 0
  },
  {
    name: 'Brown Rice',
    brand: null,
    source: FoodSource.SEED,
    calories: 111,
    proteinG: 2.6,
    carbsG: 23,
    fatG: 0.9,
    fiberG: 1.8,
    sugarG: 0.4
  },
  {
    name: 'White Rice',
    brand: null,
    source: FoodSource.SEED,
    calories: 130,
    proteinG: 2.7,
    carbsG: 28,
    fatG: 0.3,
    fiberG: 0.4,
    sugarG: 0.1
  },
  {
    name: 'Sweet Potato',
    brand: null,
    source: FoodSource.SEED,
    calories: 86,
    proteinG: 1.6,
    carbsG: 20.1,
    fatG: 0.1,
    fiberG: 3,
    sugarG: 4.2
  },
  {
    name: 'Quinoa',
    brand: null,
    source: FoodSource.SEED,
    calories: 120,
    proteinG: 4.4,
    carbsG: 22,
    fatG: 1.9,
    fiberG: 2.8,
    sugarG: 0.9
  },
  {
    name: 'Banana',
    brand: null,
    source: FoodSource.SEED,
    calories: 89,
    proteinG: 1.1,
    carbsG: 23,
    fatG: 0.3,
    fiberG: 2.6,
    sugarG: 12.2
  },

  // Fats
  {
    name: 'Avocado',
    brand: null,
    source: FoodSource.SEED,
    calories: 160,
    proteinG: 2,
    carbsG: 8.5,
    fatG: 14.7,
    fiberG: 6.7,
    sugarG: 0.7
  },
  {
    name: 'Almonds',
    brand: null,
    source: FoodSource.SEED,
    calories: 579,
    proteinG: 21.2,
    carbsG: 21.6,
    fatG: 49.9,
    fiberG: 12.5,
    sugarG: 4.4
  },
  {
    name: 'Olive Oil',
    brand: null,
    source: FoodSource.SEED,
    calories: 884,
    proteinG: 0,
    carbsG: 0,
    fatG: 100,
    fiberG: 0,
    sugarG: 0
  },
  {
    name: 'Coconut Oil',
    brand: null,
    source: FoodSource.SEED,
    calories: 862,
    proteinG: 0,
    carbsG: 0,
    fatG: 100,
    fiberG: 0,
    sugarG: 0
  },

  // Vegetables
  {
    name: 'Broccoli',
    brand: null,
    source: FoodSource.SEED,
    calories: 34,
    proteinG: 2.8,
    carbsG: 6.6,
    fatG: 0.4,
    fiberG: 2.6,
    sugarG: 1.5
  },
  {
    name: 'Spinach',
    brand: null,
    source: FoodSource.SEED,
    calories: 23,
    proteinG: 2.9,
    carbsG: 3.6,
    fatG: 0.4,
    fiberG: 2.2,
    sugarG: 0.4
  },
  {
    name: 'Carrots',
    brand: null,
    source: FoodSource.SEED,
    calories: 41,
    proteinG: 0.9,
    carbsG: 9.6,
    fatG: 0.2,
    fiberG: 2.8,
    sugarG: 4.7
  },

  // Dairy
  {
    name: 'Milk',
    brand: null,
    source: FoodSource.SEED,
    calories: 42,
    proteinG: 3.4,
    carbsG: 5,
    fatG: 1,
    fiberG: 0,
    sugarG: 5
  },
  {
    name: 'Cheddar Cheese',
    brand: null,
    source: FoodSource.SEED,
    calories: 403,
    proteinG: 25,
    carbsG: 1.3,
    fatG: 33,
    fiberG: 0,
    sugarG: 0.5
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
