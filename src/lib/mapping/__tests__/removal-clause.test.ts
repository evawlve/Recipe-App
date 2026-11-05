/**
 * s445a: parseRemovalClause() grammar table + the admission / save-gate consumers in filter-candidates.ts.
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseRemovalClause } from '../removal-clause';
import { filterCandidatesByTokens, hasCoreTokenMismatch } from '../filter-candidates';

const FIRES: Array<[string, string, string[]]> = [
  [
    "burger king whopper no cheese",
    "burger king whopper",
    [
      "cheese"
    ]
  ],
  [
    "wendy's baconator no mayo",
    "wendy's baconator",
    [
      "mayo"
    ]
  ],
  [
    "taco bell cheesy gordita crunch no sauce",
    "taco bell cheesy gordita crunch",
    [
      "sauce"
    ]
  ],
  [
    "mcdonalds mcdouble with no cheese",
    "mcdonalds mcdouble",
    [
      "cheese"
    ]
  ],
  [
    "mcdonalds double quarter pounder with no cheese",
    "mcdonalds double quarter pounder",
    [
      "cheese"
    ]
  ],
  [
    "mcdonalds quarter pounder without cheese",
    "mcdonalds quarter pounder",
    [
      "cheese"
    ]
  ],
  [
    "crunchwrap supreme without sour cream",
    "crunchwrap supreme",
    [
      "sour",
      "cream"
    ]
  ],
  [
    "burger no onions or pickles",
    "burger",
    [
      "onions",
      "pickles"
    ]
  ],
  [
    "burrito bowl no rice",
    "burrito bowl",
    [
      "rice"
    ]
  ],
  [
    "a latte no cappuccino",
    "a latte",
    [
      "cappuccino"
    ]
  ],
  [
    "a pint of minus the moo",
    "a pint of",
    [
      "moo"
    ]
  ],
  [
    "mcdonalds big mac no mac sauce",
    "mcdonalds big mac",
    [
      "mac",
      "sauce"
    ]
  ]
];
const NOOPS: string[] = ["no sugar added jam", "no bake cookies", "smuckers no sugar added jam", "motts no sugar added applesauce", "trader joes no salt added almonds", "siete no dairy queso", "coke no sugar", "chili without meat", "egg mcmuffin no egg", "cheeseburger no cheese", "combo no. 5", "mcdonalds meal no 1", "loblaws no name peanut butter", "cafe con leche sin azucar", "burger w o cheese", "no onions burger no pickles"];

describe('parseRemovalClause: fires', () => {
  it.each(FIRES)('%s', (line, head, removed) => {
    expect(parseRemovalClause(line)).toEqual({ head, removed });
  });
});

describe('parseRemovalClause: no-ops', () => {
  it.each(NOOPS)('%s', line => {
    expect(parseRemovalClause(line)).toEqual({ head: line, removed: [] });
  });
  it('pizza no cheese with a raw line that said no extra cheese', () => {
    expect(parseRemovalClause('pizza no cheese', 'pizza no extra cheese')).toEqual({ head: 'pizza no cheese', removed: [] });
  });
});

describe('parseRemovalClause: rawLine (F6b)', () => {
  it('fires when the raw line is the name', () => {
    expect(parseRemovalClause('big mac no pickles or onions', 'big mac no pickles or onions')).toEqual({ head: 'big mac', removed: ['pickles', 'onions'] });
  });
  it('fires through punctuation', () => {
    expect(parseRemovalClause('whopper no cheese', 'whopper (no cheese)')).toEqual({ head: 'whopper', removed: ['cheese'] });
  });
});

// The two consumers.
const CANDS: any[] = [{"id":"fs_68444864","source":"fatsecret","name":"Whopper","brandName":"Burger King","score":1.02,"foodType":"Brand","nutrition":{"kcal":248,"protein":11.48,"carbs":20,"fat":14.44,"per100g":true},"servings":[{"description":"1 serving","grams":270,"nutrients":{"calories":670,"carbohydrate":54,"protein":31,"fat":39,"saturatedFat":12,"transFat":0,"cholesterol":85,"sodium":1170,"fiber":3,"sugar":13}},{"description":"100 g","grams":100,"nutrients":{"calories":248,"carbohydrate":20,"protein":11.48,"fat":14.44,"saturatedFat":4.444,"transFat":0,"cholesterol":31,"sodium":433,"fiber":1.1,"sugar":4.82}}],"rawData":{"fsId":"68444864","nutrientsPer100g":{"calories":248,"protein":11.48,"carbs":20,"fat":14.44,"fiber":1.1,"sugars":4.82,"sodium":0.433,"saturatedFat":4.44},"servings":[{"id":"56035804","description":"1 serving","metricServingAmount":270,"metricServingUnit":"g","numberOfUnits":1,"measurementDescription":"serving","servingWeightGrams":null,"calories":670,"carbohydrate":54,"protein":31,"fat":39,"saturatedFat":12,"polyunsaturatedFat":null,"monounsaturatedFat":null,"transFat":0,"cholesterol":85,"sodium":1170,"potassium":null,"fiber":3,"sugar":13},{"id":"0","description":"100 g","metricServingAmount":100,"metricServingUnit":"g","numberOfUnits":100,"measurementDescription":"g","servingWeightGrams":null,"calories":248,"carbohydrate":20,"protein":11.48,"fat":14.44,"saturatedFat":4.444,"polyunsaturatedFat":null,"monounsaturatedFat":null,"transFat":0,"cholesterol":31,"sodium":433,"potassium":null,"fiber":1.1,"sugar":4.82}],"summary":{"id":"68444864","name":"Whopper","brandName":"Burger King","foodType":"Brand","description":null,"country":null,"servings":[{"id":"56035804","description":"1 serving","metricServingAmount":270,"metricServingUnit":"g","numberOfUnits":1,"measurementDescription":"serving","servingWeightGrams":null,"calories":670,"carbohydrate":54,"protein":31,"fat":39,"saturatedFat":12,"polyunsaturatedFat":null,"monounsaturatedFat":null,"transFat":0,"cholesterol":85,"sodium":1170,"potassium":null,"fiber":3,"sugar":13},{"id":"0","description":"100 g","metricServingAmount":100,"metricServingUnit":"g","numberOfUnits":100,"measurementDescription":"g","servingWeightGrams":null,"calories":248,"carbohydrate":20,"protein":11.48,"fat":14.44,"saturatedFat":4.444,"polyunsaturatedFat":null,"monounsaturatedFat":null,"transFat":0,"cholesterol":31,"sodium":433,"potassium":null,"fiber":1.1,"sugar":4.82}]}}},{"id":"fs_72269469","source":"fatsecret","name":"Whopper with Cheese","brandName":"Burger King","score":1.14,"foodType":"Brand","servings":[{"description":"1 serving","grams":null,"nutrients":{"calories":790,"carbohydrate":58,"protein":37,"fat":49,"saturatedFat":15,"transFat":1,"cholesterol":115,"sodium":1660,"fiber":4,"sugar":15}}],"rawData":{"fsId":"72269469","nutrientsPer100g":null,"servings":[{"id":"58889041","description":"1 serving","metricServingAmount":null,"metricServingUnit":null,"numberOfUnits":1,"measurementDescription":"serving","servingWeightGrams":null,"calories":790,"carbohydrate":58,"protein":37,"fat":49,"saturatedFat":15,"polyunsaturatedFat":null,"monounsaturatedFat":null,"transFat":1,"cholesterol":115,"sodium":1660,"potassium":null,"fiber":4,"sugar":15}],"summary":{"id":"72269469","name":"Whopper with Cheese","brandName":"Burger King","foodType":"Brand","description":null,"country":null,"servings":[{"id":"58889041","description":"1 serving","metricServingAmount":null,"metricServingUnit":null,"numberOfUnits":1,"measurementDescription":"serving","servingWeightGrams":null,"calories":790,"carbohydrate":58,"protein":37,"fat":49,"saturatedFat":15,"polyunsaturatedFat":null,"monounsaturatedFat":null,"transFat":1,"cholesterol":115,"sodium":1660,"potassium":null,"fiber":4,"sugar":15}]}}}];

describe('consumers', () => {
  it('F1: filterCandidatesByTokens admits BOTH the base and the with-variant on the strict pass', () => {
    const r = filterCandidatesByTokens(CANDS, 'burger king whopper no cheese', { rawLine: 'burger king whopper no cheese' });
    expect(r.filtered.map(c => c.id).sort()).toEqual(['fs_68444864', 'fs_72269469']);
  });
  it('F4: hasCoreTokenMismatch reads the head in natural order', () => {
    expect(hasCoreTokenMismatch('burger king whopper no cheese', 'Whopper', 'Burger King')).toBe(false);
  });
  it('F3: a token-SORTED cache key is never parsed (unchanged)', () => {
    expect(hasCoreTokenMismatch('burger cheese king no whopper', 'Whopper', 'Burger King')).toBe(true);
  });
});

// F3: the grammar copies are identical to the sibling's.
describe('grammar copies match negated-part-drop.ts', () => {
  const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', '..', 'nlp', f), 'utf8');
  const mine = fs.readFileSync(path.join(__dirname, '..', 'removal-clause.ts'), 'utf8');
  const setWords = (src: string, name: string): string[] => {
    const m = src.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`));
    if (!m) throw new Error('missing ' + name);
    return Array.from(m[1].matchAll(/'([^']+)'/g)).map(x => x[1]);
  };
  const absence = (src: string, name: string): string => {
    const m = src.match(new RegExp(`const ${name} = \\/(.*)\\/;`));
    if (!m) throw new Error('missing ' + name);
    return m[1];
  };
  const sib = read('negated-part-drop.ts');
  it('TAIL_STOP', () => expect(setWords(mine, 'TAIL_STOP')).toEqual(setWords(sib, 'SOLO_TAIL_STOP')));
  it('HEAD_FILLER', () => expect(setWords(mine, 'HEAD_FILLER')).toEqual(setWords(sib, 'SOLO_HEAD_FILLER')));
  it('ABSENCE', () => expect(absence(mine, 'ABSENCE')).toEqual(absence(sib, 'SOLO_ABSENCE')));
});
