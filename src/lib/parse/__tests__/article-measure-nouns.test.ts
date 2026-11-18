/**
 * s462 SMIDGE: `a <measure noun> of X` parses exactly as its digit twin `1 <measure noun> of X`.
 * Before: the article path is gated on normalizeUnitToken() and these words are not units there, so the whole phrase stayed the
 * name and the bare cascade billed a whole serving or package (`a smidge of tamarind chutney` 226.8 g, deploy 49 cold) while the
 * twin read unit `smidge` and billed a per-food estimate (3 g, count_unit_ai). The rewrite adds no gram number.
 */
import { parseIngredientLine } from '../ingredient-line';
import { resolveArticleMeasureNouns } from '../loose-measures';
import { getDefaultCountServing } from '../../servings/default-count-grams';

const WORDS = ['smidge', 'smidgen', 'dab', 'pat', 'squeeze'];

describe('article-led measure noun = its digit twin', () => {
  test.each(WORDS)('a %s of tamarind chutney', (w) => {
    const p = parseIngredientLine(`a ${w} of tamarind chutney`);
    expect(p).not.toBeNull();
    expect(p!.qty).toBe(1);
    expect(p!.unit).toBe(w);
    expect(p!.name).toBe('tamarind chutney');
    expect(p).toEqual(parseIngredientLine(`1 ${w} of tamarind chutney`));
  });

  test.each([
    ['A Dab Of Mayo', '1 dab of Mayo'],
    ['an smidgen of salt', '1 smidgen of salt'],
    ['a dab of 2% greek yogurt', '1 dab of 2% greek yogurt'],
    ['a squeeze of lemon juice', '1 squeeze of lemon juice'],
  ])('%s', (line, twin) => {
    expect(parseIngredientLine(line)).toEqual(parseIngredientLine(twin));
  });
});

describe('declines (byte-identical line)', () => {
  test.each([
    'a pat lafrieda burger',     // no partitive `of`: a brand, not a measure
    'a sprinkle donut',
    'a sprinkles donut',
    'a squeeze bottle of honey', // the measure word is not followed by `of`
    'a dabs of butter',          // plural after an article is not English
    'a dab of',                  // nothing after `of`
    'a smidge',
    'rainbow sprinkles',
    'toast with a smear of butter', // not leading
    '2 dollops of sour cream',   // already a count
    'a pinch of salt',           // already a unit
    'a dash of hot sauce',
    'a squirt of ketchup',
    'a bit of avocado oil',      // amount hedge, owned by amount-hedge.ts
    'a little caesars pizza',
    'a touch of honey',
    'a dollop of sour cream',    // the tablespoon words are held: the bare serving is usually already a tablespoon
    'a spoonful of nutella',
    'a knob of butter',
    'a smear of cream cheese',
    'a swirl of caramel',
    'a sprinkle of parmesan',    // sprinkle is held: the FDC lane bills a parsed `sprinkle` at a 0.2 g spice constant
    'a spoonful of jam on toast', // a second food: the route splits first; the whole line keeps its base parse
    'a sprinkle of parmesan on spaghetti',
    'a smear of cream cheese on a bagel',
    'a dollop of sour cream with chives',
    'a pat of butter and toast',
    'a dab of butter, toast',
    'a pat of butter on toast',
    'a smidge of cream cheese on a bagel',
    'a squeeze of lemon in my water',
    'a dollop of mac & cheese',
    'a spoonful of rice + beans',
    'a dollop of sour cream in my chili',
    'a pat of butter w/ toast',    // rf-smidge mrep B01: rewritten, it mapped French Toast with Butter
    'a pat of butter for my toast', // B02: rewritten, it mapped Nuts for butter
    'a squeeze of lime; tortilla chips',
    'a pat of butter plus toast',
  ])('%s', (line) => {
    expect(resolveArticleMeasureNouns(line)).toBe(line);
  });

  test('keeps leading whitespace and lowercases only the measure word', () => {
    expect(resolveArticleMeasureNouns('  A Smidge of Tamarind Chutney')).toBe('  1 smidge of Tamarind Chutney');
  });
});

describe('a small-amount measure never takes the whole-item seed its food name matches', () => {
  // rf-smidge (deploy 49 cold): `1 smidge of pepper` -> Black Pepper 164 g / 418 kcal (the bell-pepper seed), `1 smidge of avocado` 201 g.
  test.each(['smidge', 'smidgen', 'dab', 'pat', 'squeeze', 'squeezes', 'pats'])('%s', (u) => {
    for (const food of ['Black Pepper', 'avocado', 'lemon', 'lime', 'orange', 'egg', 'tomato', 'cilantro']) {
      expect(getDefaultCountServing(food, u)).toBeNull();
    }
  });
  test('an exact <name> <unit> seed still answers, and the count seeds are untouched', () => {
    expect(getDefaultCountServing('butter', 'pat')?.grams).toBe(5);
    expect(getDefaultCountServing('lemon', 'each')?.grams).toBe(58);
    expect(getDefaultCountServing('avocado', 'each')?.grams).toBe(201);
  });
});
