/**
 * A8 row 5 — a brand-led line is a PRODUCT NAME, not a recipe ingredient.
 *
 * Four mechanisms, one principle: every recipe-ingredient heuristic in
 * parseIngredientLine() yields when the lexicon says the line names a product.
 * Populations are measured on the 4,102-line coverage corpus (2026-08-26) and
 * quoted in the source comments; this file pins the behaviour per class.
 */
import { parseIngredientLine } from '../ingredient-line';
import { parseQuantityTokens } from '../quantity';
import { COUNT_NOUN_UNITS } from '../unit';

describe('P1 — the parser stops eating identity tokens on a brand-led line', () => {
  test('a qualifier that is part of the product name survives (44 corpus lines)', () => {
    expect(parseIngredientLine('zaxbys boneless wings')!.name).toBe('zaxbys boneless wings');
    expect(parseIngredientLine('great value shredded cheddar cheese')!.name)
      .toBe('great value shredded cheddar cheese');
    expect(parseIngredientLine('kodiak cakes frozen waffles')!.name).toBe('kodiak cakes frozen waffles');
    // `short` is the product line "Short Cuts", not a cut of meat.
    expect(parseIngredientLine('perdue short cuts grilled chicken breast strips')!.name)
      .toBe('perdue short cuts grilled chicken breast strips');
  });

  test('a qualifier that is part of the BRAND survives — the worst case', () => {
    // Stripping here deleted half the brand: "pure leaf" -> "pure".
    expect(parseIngredientLine('pure leaf sweet tea')!.name).toBe('pure leaf sweet tea');
    expect(parseIngredientLine('amazon fresh almond butter')!.name).toBe('amazon fresh almond butter');
    // The whole brand IS the stripped word plus one: "shredded wheat" -> "wheat".
    expect(parseIngredientLine('shredded wheat')!.name).toBe('shredded wheat');
  });

  test('a unit HINT that is part of the product name survives', () => {
    expect(parseIngredientLine('bumble bee chunk light tuna in water')!.name)
      .toBe('bumble bee chunk light tuna in water');
    expect(parseIngredientLine('mcdonalds 10 piece chicken mcnuggets')!.name)
      .toBe('mcdonalds 10 piece chicken mcnuggets');
    expect(parseIngredientLine('reeses pieces')!.name).toBe('reeses pieces');
  });

  test('P1(c) — a leading produce-anatomy word on a brand-led line is not a measure', () => {
    const r = parseIngredientLine('crown royal');
    expect(r!.unit).toBeNull();
    expect(r!.name).toBe('crown royal');
    // The partitive `of` is the exemption: a real measure says so.
    expect(parseIngredientLine('crown of broccoli')!.unit).toBe('crown');
  });

  test('genuine recipe lines are untouched — no brand, no gate', () => {
    expect(parseIngredientLine('shredded chicken')!.name).toBe('chicken');
    expect(parseIngredientLine('boneless skinless chicken breast')!.name).toBe('chicken breast');
    expect(parseIngredientLine('frozen peas')!.name).toBe('peas');
    expect(parseIngredientLine('2 romaine leaves')!.unitHint).toBe('leaf');
    expect(parseIngredientLine('4 slices of fresh bread')!.qualifiers).toContain('fresh');
  });

  test('the measured false-positive class, pinned so it cannot grow silently', () => {
    // Both fire on a SINGLE-TOKEN junk lexicon entry (`jumbo`, `sprouts`) and
    // both outcomes are benign — the kept word is true of the food. 2 of 30 on
    // the genuine-recipe control set, measured 2026-08-26. If a future lexicon
    // change makes this list longer, that is brand-detector precision work.
    expect(parseIngredientLine('jumbo shrimp')!.name).toBe('jumbo shrimp');
    expect(parseIngredientLine('fresh sprouts')!.name).toBe('fresh sprouts');
  });
});

describe('P2 — a word-number that opens a brand is not a quantity', () => {
  test('the three brands, all 11 corpus lines share these shapes', () => {
    for (const line of ['five guys little cheeseburger', 'two good vanilla yogurt', 'six star whey protein']) {
      const r = parseIngredientLine(line);
      expect(r!.qty).toBe(1);
      expect(r!.name).toBe(line);
    }
  });

  test('a single-token brand is excluded by construction — n-brand-02 keeps counting', () => {
    const r = parseIngredientLine('one bar birthday cake');
    expect(r!.qty).toBe(1);
    expect(r!.unit).toBe('bar');
    expect(r!.name).toBe('birthday cake');
  });

  test('genuine counts are untouched', () => {
    expect(parseIngredientLine('two eggs')!.qty).toBe(2);
    expect(parseIngredientLine('three slices of bacon')!.qty).toBe(3);
    expect(parseIngredientLine('three slices of bacon')!.name).toBe('bacon');
    // An explicit count BEFORE the brand still counts: the brand no longer
    // sits at the quantity position (the digit-guard's own rule).
    expect(parseIngredientLine('2 five guys cheeseburger')!.qty).toBe(2);
  });

  test('the guard fires on exactly the tokens parseQuantityTokens would consume', () => {
    // The two lists being separate is the bug this guard patches, so assert the
    // intersection directly rather than trusting them to drift together.
    for (const w of ['one', 'two', 'three', 'four', 'five', 'six', 'seven',
      'eight', 'nine', 'ten', 'eleven', 'twelve', 'dozen', 'couple']) {
      expect(parseQuantityTokens([w, 'widgets'])).not.toBeNull();
    }
  });
});

describe('the same-unit fractional connector', () => {
  test('"a scoop and a half of X" is 1.5 scoops, and the connector leaves the name', () => {
    const r = parseIngredientLine('a scoop and a half of whey protein');
    expect(r!.qty).toBe(1.5);
    expect(r!.unit).toBe('scoop');
    expect(r!.name).toBe('whey protein');
  });

  test('quarter and third, with and without the article', () => {
    expect(parseIngredientLine('a cup and a quarter of rice')!.qty).toBe(1.25);
    expect(parseIngredientLine('1 cup and half of milk')!.qty).toBe(1.5);
  });

  test('it declines on a genuine second ingredient, leaving the compound branch alone', () => {
    // `banana` is not a fraction word, so the mixed-unit compound branch runs
    // unchanged and this stays one ingredient named by the whole phrase.
    const r = parseIngredientLine('1 cup rice and a banana');
    expect(r!.qty).toBe(1);
    expect(r!.unit).toBe('cup');
    // The mixed-unit compound still converts: 0.25 cup + 1 tbsp.
    expect(parseIngredientLine('0.25 cup and 1 tbsp olive oil')!.qty).toBeCloseTo(0.3116, 4);
  });
});

describe('count nouns and the serving seeds', () => {
  test('a count noun is NOT a parser unit — measured, not assumed', () => {
    // Making them units bought zero winner improvements and regressed two arms;
    // see the COUNT_NOUN_UNITS comment in ../unit.ts. `3 tortillas` still bills
    // correctly without it, through the `tortilla` seed on the NAME.
    expect(parseIngredientLine('3 tortillas')!.unit).toBeNull();
    expect(parseIngredientLine('13 tortilla chips')!.name).toBe('tortilla chips');
    expect(parseIngredientLine('3 chicken wings')!.name).toBe('chicken wings');
    expect(parseIngredientLine('biscuits and gravy')!.name).toBe('biscuits and gravy');
  });

  test('COUNT_NOUN_UNITS scopes the serving singular-fallback, nothing else', () => {
    // getDefaultCountServing() singularizes a last word only inside this set,
    // because unscoped it collided across foods (`skins` -> the chicken-skin
    // seed, `mints` -> the mint HERB seed at 30 g).
    expect(COUNT_NOUN_UNITS.has('wings')).toBe(true);
    expect(COUNT_NOUN_UNITS.has('skins')).toBe(false);
    expect(COUNT_NOUN_UNITS.has('mints')).toBe(false);
  });
});
