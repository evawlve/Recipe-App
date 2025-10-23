import { rankCandidates } from '../rank';

test('powder hint boosts whey over unrelated', () => {
  const res = rankCandidates([
    { 
      food: { 
        id: 'a', 
        name: 'Olive Oil', 
        categoryId: 'oil', 
        source: 'usda',
        verification: 'verified',
        kcal100: 884,
        protein100: 0,
        carbs100: 0,
        fat100: 100,
        popularity: 50
      },
      aliases: ['oil', 'cooking oil']
    },
    { 
      food: { 
        id: 'b', 
        name: 'Whey Protein Isolate', 
        categoryId: 'whey', 
        source: 'usda',
        verification: 'verified',
        kcal100: 400,
        protein100: 80,
        carbs100: 10,
        fat100: 5,
        popularity: 50
      },
      aliases: ['whey protein', 'protein powder', 'whey powder']
    }
  ], { query: 'whey protein powder' });
  
  expect(res[0].candidate.food.id).toBe('b');
});

test('cheese hint boosts cheese over composite dish', () => {
  const res = rankCandidates([
    { 
      food: { 
        id: 'a', 
        name: 'Mozzarella cheese, tomato and basil with oil', 
        categoryId: 'prepared_dish', 
        source: 'usda',
        verification: 'verified',
        kcal100: 200,
        protein100: 10,
        carbs100: 5,
        fat100: 15,
        popularity: 50
      },
      aliases: ['mozzarella salad']
    },
    { 
      food: { 
        id: 'b', 
        name: 'Cheese, mozzarella, part skim', 
        categoryId: 'cheese', 
        source: 'usda',
        verification: 'verified',
        kcal100: 280,
        protein100: 25,
        carbs100: 2,
        fat100: 18,
        popularity: 50
      },
      aliases: ['mozzarella', 'mozz', 'cheese', 'mozzarella cheese']
    }
  ], { query: 'mozzarella cheese' });
  
  // The cheese item should rank higher due to category boost and exact alias match
  expect(res[0].candidate.food.id).toBe('b');
});

test('oil hint boosts oil category', () => {
  const res = rankCandidates([
    { 
      food: { 
        id: 'a', 
        name: 'Olive Oil', 
        categoryId: 'oil', 
        source: 'usda',
        verification: 'verified',
        kcal100: 884,
        protein100: 0,
        carbs100: 0,
        fat100: 100,
        popularity: 50
      },
      aliases: ['olive', 'cooking oil']
    },
    { 
      food: { 
        id: 'b', 
        name: 'Chicken Breast', 
        categoryId: 'meat', 
        source: 'usda',
        verification: 'verified',
        kcal100: 165,
        protein100: 31,
        carbs100: 0,
        fat100: 3.6,
        popularity: 50
      },
      aliases: ['chicken', 'breast']
    }
  ], { query: 'cooking oil' });
  
  expect(res[0].candidate.food.id).toBe('a');
});
