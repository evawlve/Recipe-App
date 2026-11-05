/**
 * The generic-component table behind `applyComponentSubtraction()` (s447a, R2 class C).
 *
 * WHAT IT IS. One FatSecret Generic panel and ONE fixed portion per removable
 * component (`a cobb salad without the egg` -> the `egg` row). Panels are per
 * 100 g as calories / protein / carbs / fat / fiber / sugar / sodium, where
 * SODIUM IS GRAMS per 100 g (the wire's unit; no conversion anywhere) and
 * `sugar` is the FatSecret key `sugars`. Read 2026-11-04 from the box's
 * `FatSecretFood` by the s447a refuter (read-only):
 *   SELECT "fsId", name, "nutrientsPer100g"::text FROM "FatSecretFood"
 *   WHERE "fsId" IN ('fs_3094','fs_1517','fs_34194','fs_288333','fs_7112',
 *     'fs_33814','fs_1097','fs_38255','fs_7106','fs_7086','fs_36442','fs_6812',
 *     'fs_6250','fs_39055','fs_33733','fs_6138');
 *
 * CARRIERS. A carrier is a dish whose generic record ALWAYS includes the
 * component (a cobb salad has egg; a waffle record does not have syrup). The
 * subtraction fires only when the dish (the head, or the winner's `foodName`)
 * names a carrier, or when the winner's `foodName` itself names the component.
 * `syrup` and `brown sugar` carry NOTHING on purpose: the measured live winners
 * `a waffle without syrup` -> OFF Waffles and `oatmeal without the brown sugar`
 * -> Rolled Oats are plain foods, and cutting them would be wrong. Carrier lists
 * are a first cut and grow by addendum.
 *
 * KNOWN LIMITS (reasoning, not measurement): `mayo` uses a dressing-like Generic
 * panel (57 kcal per tbsp), so it UNDER-subtracts against a restaurant sandwich;
 * `hollandaise` has no FatSecret row and is deliberately absent (a not-in-table
 * skip); `sauce`, `dressing`, `rice`, `chicken`, `meat`, `bread`, `cream` are
 * absent by design. A component outside the table keeps today's behaviour.
 */

export type ComponentPanel = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  /** grams per 100 g */
  sodium: number;
};

export type ComponentRow = {
  fsId: string;
  name: string;
  portionLabel: string;
  /** grams of ONE portion */
  grams: number;
  carriers: string[];
  per100g: ComponentPanel;
};

const p = (
  calories: number, protein: number, carbs: number, fat: number,
  fiber: number, sugar: number, sodium: number,
): ComponentPanel => ({ calories, protein, carbs, fat, fiber, sugar, sodium });

export const COMPONENT_TABLE: Record<string, ComponentRow> = {
  egg: {
    fsId: 'fs_3094', name: 'Boiled Egg', portionLabel: '1 large', grams: 50,
    carriers: ['cobb', 'benedict', 'mcmuffin'],
    per100g: p(154, 12.53, 1.12, 10.57, 0, 1.12, 0.278),
  },
  bacon: {
    fsId: 'fs_1517', name: 'Bacon', portionLabel: '2 medium slices', grams: 16,
    carriers: ['club', 'blt', 'cobb'],
    per100g: p(541, 37.04, 1.43, 41.78, 0, 0, 2.31),
  },
  mayo: {
    fsId: 'fs_34194', name: 'Mayonnaise', portionLabel: '1 tbsp', grams: 14.7,
    carriers: ['sub', 'club', 'sandwich', 'burger', 'wrap', 'blt', 'tuna', 'chicken salad'],
    per100g: p(390, 0.9, 23.9, 33.4, 0, 6.4, 0.711),
  },
  cheese: {
    fsId: 'fs_288333', name: 'American Cheese', portionLabel: '1 slice', grams: 21,
    carriers: ['cheeseburger', 'quesadilla', 'melt', 'cheesesteak', 'nachos'],
    per100g: p(337, 18.94, 6.94, 26.05, 0, 6.44, 1.297),
  },
  syrup: {
    fsId: 'fs_7112', name: 'Pancake Syrup', portionLabel: '2 tbsp', grams: 40,
    // Carries nothing: a waffle / pancake record is the plain food.
    carriers: [],
    per100g: p(265, 0, 69.6, 0.1, 0, 42, 0.061),
  },
  butter: {
    fsId: 'fs_33814', name: 'Butter', portionLabel: '1 pat', grams: 5,
    carriers: ['mcmuffin'],
    per100g: p(717, 0.85, 0.06, 81.11, 0, 0.06, 0.011),
  },
  'sour cream': {
    fsId: 'fs_1097', name: 'Sour Cream', portionLabel: '2 tbsp', grams: 29,
    carriers: ['burrito', 'taco', 'nachos', 'baked potato', 'bowl', 'quesadilla'],
    per100g: p(214, 3.16, 4.27, 20.96, 0, 0.16, 0.053),
  },
  bean: {
    fsId: 'fs_38255', name: 'Pinto Beans (Mature Seeds, Canned)', portionLabel: '1/4 cup', grams: 43,
    // NOT chili: a chili record is its own recipe.
    carriers: ['burrito', 'bowl', 'nachos', 'tostada'],
    per100g: p(86, 4.86, 15.25, 0.81, 4.6, 0.22, 0.294),
  },
  'brown sugar': {
    fsId: 'fs_7106', name: 'Brown Sugar', portionLabel: '1 tbsp', grams: 14,
    // Carries nothing: Rolled Oats never had the sugar.
    carriers: [],
    per100g: p(377, 0, 97.33, 0, 0, 96.21, 0.039),
  },
  spread: {
    fsId: 'fs_7086', name: 'Thousand Island Dressing', portionLabel: '1 tbsp', grams: 15.6,
    carriers: ['burger', 'cheeseburger', 'double double', 'animal style'],
    per100g: p(370, 1.09, 14.64, 35.06, 0.8, 15.18, 0.863),
  },
  onion: {
    fsId: 'fs_36442', name: 'Onions', portionLabel: '1 slice', grams: 14,
    carriers: ['burger', 'cheeseburger', 'hamburger', 'sandwich', 'sub', 'hot dog', 'taco', 'salad'],
    per100g: p(42, 0.92, 10.11, 0.08, 1.4, 4.28, 0.003),
  },
  pickle: {
    fsId: 'fs_6812', name: 'Pickles', portionLabel: '2 chips', grams: 8,
    carriers: ['burger', 'cheeseburger', 'hamburger', 'sandwich', 'sub'],
    per100g: p(18, 0.62, 4.12, 0.19, 1.2, 3.51, 1.282),
  },
  lettuce: {
    fsId: 'fs_6250', name: 'Lettuce', portionLabel: '1 large leaf', grams: 15,
    carriers: ['burger', 'cheeseburger', 'hamburger', 'sandwich', 'sub', 'wrap', 'taco'],
    per100g: p(14, 0.9, 2.97, 0.14, 1.2, 1.76, 0.01),
  },
  bun: {
    fsId: 'fs_39055', name: 'Hamburger or Hotdog Rolls', portionLabel: '1 bun', grams: 43,
    carriers: ['hot dog', 'hamburger', 'burger', 'cheeseburger', 'sausage'],
    per100g: p(279, 9.5, 49.45, 4.33, 2.1, 6.25, 0.479),
  },
  'whipped cream': {
    fsId: 'fs_33733', name: 'Whipped Cream', portionLabel: '2 tbsp', grams: 10,
    carriers: ['frappuccino', 'sundae', 'hot chocolate', 'mocha'],
    per100g: p(257, 3.2, 12.49, 22.22, 0, 8, 0.13),
  },
  tomato: {
    fsId: 'fs_6138', name: 'Tomatoes', portionLabel: '1 slice', grams: 20,
    carriers: ['burger', 'cheeseburger', 'hamburger', 'sandwich', 'sub', 'blt', 'wrap', 'salad'],
    per100g: p(18, 0.88, 3.92, 0.2, 1.2, 2.63, 0.005),
  },
};

export const ALIASES: Record<string, string> = {
  eggs: 'egg',
  mayonnaise: 'mayo',
  beans: 'bean',
  onions: 'onion',
  pickles: 'pickle',
  whip: 'whipped cream',
  tomatoes: 'tomato',
  buns: 'bun',
  'american cheese': 'cheese',
  cheddar: 'cheese',
  swiss: 'cheese',
};
