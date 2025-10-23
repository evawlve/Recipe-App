import { rankCandidates } from '../rank';

test('nonfat cheddar ranks ahead of unrelated', () => {
  const res = rankCandidates([
    { 
      food: { 
        id: 'x', 
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
      aliases: []
    },
    { 
      food: { 
        id: 'y', 
        name: 'Cheese, cheddar, nonfat or fat free', 
        categoryId: 'cheese', 
        source: 'usda',
        verification: 'verified',
        kcal100: 280,
        protein100: 25,
        carbs100: 2,
        fat100: 18,
        popularity: 50
      },
      aliases: ['nonfat cheddar']
    }
  ], { query: 'nonfat cheddar' });
  
  expect(res[0].candidate.food.id).toBe('y');
});

test('nonfat milk prefers the milk entry', () => {
  const res = rankCandidates([
    { 
      food: { 
        id: 'a', 
        name: 'Greek Yogurt, nonfat', 
        categoryId: 'dairy', 
        source: 'usda',
        verification: 'verified',
        kcal100: 200,
        protein100: 10,
        carbs100: 5,
        fat100: 15,
        popularity: 50
      },
      aliases: ['nonfat yogurt']
    },
    { 
      food: { 
        id: 'b', 
        name: 'Milk, nonfat', 
        categoryId: 'dairy', 
        source: 'usda',
        verification: 'verified',
        kcal100: 34,
        protein100: 3.4,
        carbs100: 5,
        fat100: 0.2,
        popularity: 50
      },
      aliases: ['nonfat milk']
    }
  ], { query: 'nonfat milk' });
  
  expect(res[0].candidate.food.id).toBe('b');
});
