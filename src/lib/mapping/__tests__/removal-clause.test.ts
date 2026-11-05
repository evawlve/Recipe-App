/**
 * s445a: parseRemovalClause() grammar table + the admission / save-gate consumers in filter-candidates.ts.
 */
import * as fs from 'fs';
import * as path from 'path';
import { demoteRemovedParts, parseRemovalClause } from '../removal-clause';
import { buildRerankPool, laneMode } from '../rerank-pool';
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

// s448a: records that NAME the removed part yield their window slots to their lane-mates (cold path only).
// Fixture: the 13 admitted candidates of `burger king whopper no cheese`, in admitted order (s445-fc3b snapshot, s448 M17 replay).
const WHOPPER_ADMITTED: any[] = [{"id":"off_9664486401398594432","source":"openfoodfacts","name":"Burger King, Whopper Sandwich","semanticSimilarity":null},{"id":"off_242686422271752995","source":"openfoodfacts","name":"Burger King, Whopper Jr Sandwich","semanticSimilarity":null},{"id":"off_19289483496155943752","source":"openfoodfacts","name":"Burger King, Double Whopper Sandwich","semanticSimilarity":null},{"id":"off_866324187157056986","source":"openfoodfacts","name":"Burger King, BBQ Bacon Whopper Sandwich","semanticSimilarity":null},{"id":"off_0098000005538","source":"openfoodfacts","name":"Whopper Barbecue Bacon - Burger King","semanticSimilarity":null},{"id":"fs_72269469","source":"fatsecret","name":"Whopper with Cheese","semanticSimilarity":null},{"id":"fs_72269470","source":"fatsecret","name":"Whopper with Bacon & Cheese","semanticSimilarity":null},{"id":"fs_72269482","source":"fatsecret","name":"Triple Whopper with Cheese","semanticSimilarity":null},{"id":"fs_72269476","source":"fatsecret","name":"Double Whopper with Cheese","semanticSimilarity":null},{"id":"fs_72269494","source":"fatsecret","name":"Whopper Jr. with Cheese","semanticSimilarity":null},{"id":"fs_68444864","source":"fatsecret","name":"Whopper","semanticSimilarity":null},{"id":"fs_72269484","source":"fatsecret","name":"Triple Whopper with Bacon & Cheese","semanticSimilarity":null},{"id":"fs_72269495","source":"fatsecret","name":"Whopper Jr. with Bacon & Cheese","semanticSimilarity":null}];

describe('demoteRemovedParts', () => {
  const ids = (l: any[]) => l.map(c => c.id);
  const mk = (name: string, source = 'fatsecret', semanticSimilarity: number | null = null) => ({ id: name, name, source, semanticSimilarity });

  it('(1) removed: [] returns the same reference; so does an empty list', () => {
    expect(demoteRemovedParts(WHOPPER_ADMITTED, [])).toBe(WHOPPER_ADMITTED);
    const empty: any[] = [];
    expect(demoteRemovedParts(empty, ['cheese'])).toBe(empty);
  });

  it('(2) whopper: the plain Whopper enters the 10-record window and the last cheese variant leaves it', () => {
    const before = ids(buildRerankPool(WHOPPER_ADMITTED));
    const after = ids(buildRerankPool(demoteRemovedParts(WHOPPER_ADMITTED, ['cheese'], 'burger king whopper')));
    expect(before).toContain('fs_72269494');
    expect(before).not.toContain('fs_68444864');
    expect(after).toContain('fs_68444864');
    expect(after).not.toContain('fs_72269494');
  });

  it('(3) an fdc record naming the part keeps its index', () => {
    const l = [mk('Cheese Pizza', 'fdc'), mk('Cheese Burger'), mk('Plain Burger'), mk('Burger')];
    const out = demoteRemovedParts(l, ['cheese']);
    expect(out[0]).toBe(l[0]);
    expect(ids(out)).toEqual(['Cheese Pizza', 'Plain Burger', 'Burger', 'Cheese Burger']);
  });

  it('(4) `w/ No Cheese` does not name cheese', () => {
    const l = [mk('Deluxe Sandwich w/ No Cheese'), mk('Deluxe Sandwich')];
    expect(demoteRemovedParts(l, ['cheese'])).toBe(l);
  });

  it('(5) slot property: every lane keeps its index set and multiset', () => {
    const out = demoteRemovedParts(WHOPPER_ADMITTED, ['cheese'], 'burger king whopper');
    expect(out).not.toBe(WHOPPER_ADMITTED);
    const lanes = (l: any[]) => {
      const m = new Map<string, { at: number[]; ids: string[] }>();
      l.forEach((c, i) => {
        const k = `${c.source}|${laneMode(c)}`;
        const e = m.get(k) ?? { at: [], ids: [] };
        e.at.push(i);
        e.ids.push(c.id);
        m.set(k, e);
      });
      return m;
    };
    const a = lanes(WHOPPER_ADMITTED);
    const b = lanes(out);
    expect(Array.from(b.keys()).sort()).toEqual(Array.from(a.keys()).sort());
    for (const [k, e] of a) {
      expect(b.get(k)!.at).toEqual(e.at);
      expect(b.get(k)!.ids.slice().sort()).toEqual(e.ids.slice().sort());
    }
  });

  it('(6/F10) a non-removal query hands back what demoteRemovedParts(x, []) would: filtered in candidate order, same reference on re-demotion', () => {
    const r = filterCandidatesByTokens(CANDS, 'burger king whopper', { rawLine: 'burger king whopper' });
    expect(demoteRemovedParts(r.filtered, [])).toBe(r.filtered);
    const order = CANDS.map(c => c.id);
    const got = r.filtered.map(c => c.id);
    expect(got).toEqual(order.filter(i => got.includes(i)));
  });

  it('F1: plural form sets meet in both directions', () => {
    expect(ids(demoteRemovedParts([mk('Burger with Pickle'), mk('Plain Burger')], ['pickles']))).toEqual(['Plain Burger', 'Burger with Pickle']);
    expect(ids(demoteRemovedParts([mk('Pasta with Sauces'), mk('Plain Pasta')], ['sauce']))).toEqual(['Plain Pasta', 'Pasta with Sauces']);
    expect(ids(demoteRemovedParts([mk('Mixed Cheeses'), mk('Plain Melt')], ['cheese']))).toEqual(['Plain Melt', 'Mixed Cheeses']);
  });

  it('F2: a removed token that names the head is ignored', () => {
    const l = ['Big Mac', 'McDouble', 'Quarter Pounder', 'Big Mac Meal', 'Big Mac Sauce'].map(n => mk(n));
    // Only `Big Mac Sauce` (already last) is demoted; every "Big Mac" record keeps its place.
    expect(ids(demoteRemovedParts(l, ['mac', 'sauce'], 'mcdonalds big mac'))).toEqual(ids(l));
    expect(demoteRemovedParts(l.slice(0, 4), ['mac'], 'mcdonalds big mac')).toEqual(l.slice(0, 4));
    const sauceMid = ['Big Mac', 'Big Mac Sauce', 'McDouble'].map(n => mk(n));
    expect(ids(demoteRemovedParts(sauceMid, ['mac', 'sauce'], 'mcdonalds big mac'))).toEqual(['Big Mac', 'McDouble', 'Big Mac Sauce']);
    expect(demoteRemovedParts(sauceMid, ['mac'], 'mcdonalds big mac')).toBe(sauceMid);
  });

  it('F3: `instead of X`, `no X`, `X free` are not mentions', () => {
    const a = [mk('Cheeseburger with Onion (Mustard & Ketchup Instead of Spread)'), mk('Cheeseburger with Spread')];
    expect(ids(demoteRemovedParts(a, ['spread']))).toEqual([a[0].id, a[1].id]);
    const b = [mk('Cheese Free Pizza'), mk('Cheese Pizza'), mk('Plain Pizza')];
    expect(ids(demoteRemovedParts(b, ['cheese']))).toEqual(['Cheese Free Pizza', 'Plain Pizza', 'Cheese Pizza']);
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
