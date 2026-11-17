/**
 * A FRACTION OF ONE ITEM BILLS A FRACTION OF THE WHOLE ITEM (s461 WHOLE-ONE).
 *
 * `half a rotisserie chicken` parses qty 0.5 with no unit, and buildOffResult()'s
 * count branch needs qty >= 1, so the line bills 0.5 x the record's "one": its label
 * serving, or the fabricated 100 g floor. That "one" is a WHOLE item on about half the winners (`1 muffin`,
 * `1 medium`, `1/8 pie`, a chain `1 serving`) and a PORTION on the rest (`3 oz`,
 * `100 g`, `1 portion (85 g)`, `1 | (123 g)`, no label at all), and the serving
 * tier cannot tell them apart (`label_serving_default` holds a 320 g burrito and a
 * 123 g pizza slice). MEASURED cold, deploy 46 (s461 pd-whole): `half a rotisserie
 * chicken` 50 g (no label), `half a sandwich` 18.5 g (`37.0g`), `quarter of a digiorno
 * pepperoni pizza` 30.75 g (`1 | (123 g)`). The `whole` unit already reaches whole-item
 * weights through `getOrCreateAmbiguousServing(..., 'whole')` (`1/2 whole rotisserie
 * chicken` 600 g), and that is the rung this rule takes.
 *
 * The rule, four predicates, all of which must hold:
 *   1. the LINE asks for a fraction of ONE item: no unit, 0 < qty < 1, and the raw
 *      text says so with an indefinite article (`half a`, `half an`, `a quarter of
 *      a`, `1/2 a`). The article is the item signal: `1/2 spaghetti`, `half the
 *      cream cheese`, `the remaining half of the lasagna`, `half sweet tea` and
 *      `1/2 dressing on the side` are fractions of a portion or of a container,
 *      and the `whole` estimate for those is a package. An `X of Y` item (`half a
 *      glass of milk`, `half an order of fries`) is declined too: the item is the
 *      container X and the record is Y, so the record's whole is not what was asked;
 *   2. the record's "one" is PORTION-shaped (`fractionOneShape()`): no label, a bare
 *      mass (`3 oz`, `177 g`), a generic portion word (`portion`, `serving`), no word
 *      at all (`1 | (123 g)`). A label naming the item or a size (`1 muffin`,
 *      `1 medium`, `1/8 pie`) is already a whole item and keeps today's bill; so does
 *      any other word, `slice` and `piece` included (a slice of cheese, a piece of
 *      cake: the record cannot say whether its slice is the item or a share of it).
 *      A VOLUME label (`1 cup`, `240 ml`) is a drink or a spoonable and keeps it too;
 *   3. RAISE-ONLY: the whole weight must exceed the portion it replaces. A whole
 *      item never weighs less than one portion of it, so a smaller answer is a bad
 *      estimate (`Cantaloupe` 1 whole = 69 g against a `177 g` label, measured) and
 *      today's bill stands;
 *   4. the RECORD is the item (`recordIsTheItem()`): the record and the line share
 *      their head word, so `Avocado Oil` for `half an avocado`, `Muffin mix`, `85% Lean
 *      Ground Beef` for `half a hamburger` and `Brisket` for `half a brisket plate` are
 *      never asked for a `whole` (the model answers the bottle, box, pack or cut).
 *      Checked before the estimate: a declined record costs no model call, writes no row.
 *
 * r2 (s461 pd-whole2): four classes the four predicates cannot see made held-out lines
 * WORSE (rf-whole: 576 twins of real one-item logs, 28 worse of 153 movers). Each guard
 * below is a class with a mechanism, and every decline keeps today's bill:
 *   5. PANEL (`fractionWholeDecline()`, before the estimate): a whole-item weight is a
 *      PREPARED, water-rich item (a sandwich, a bowl, a drink, a bird, a fruit), so it is
 *      billed only on a panel that can be that item. Declined: a panel above
 *      FRACTION_WHOLE_MAX_KCAL_PER_100G (300; a dry mix, a powder, a spread, an oil, a
 *      baked good, where the label portion is what is eaten or the panel is not the
 *      prepared item: `London Fog` 467, `Cafe Au Lait` 438, `Ranch` 467, `Olive oil` 900),
 *      and any panel the rank-time plausibility rules already call implausible for the
 *      item (assessRankTimePlausibility() `impossible` or `floorHit`: the prepared / brewed /
 *      diet / poured / made-drink ceilings, `Vietnamese iced coffee` at 220, AND every
 *      deterministic produce / protein floor, which also declines a few real items: s461
 *      pd-whole2 Q013 Chobani strawberry yogurt on `produce_protein_15_over_6`);
 *   6. SIZE (before the estimate): an item that names its size is not the generic whole.
 *      `small` / `medium` / `large` are units the estimator already answers per record
 *      (`1 small fries` bills its `small` row), so the fraction asks THAT unit; a
 *      below-standard size (`kid size`, `mini`, `little`, `snack size`, `fun size`) has
 *      no unit to ask and is declined;
 *   7. PACKAGE (before the estimate): a line naming a package (`container`, `jar`, `bag`,
 *      `box`, ...) or a bottle-sold pour (spirits, wine: ALCOHOL_PATTERN's pour subset)
 *      asks for a share of a package, and the `whole` of those is the package
 *      (`half a vodka` -> 375 g of a 750 ml bottle);
 *   8. MARGIN and CAP (after the estimate): a BARE MASS label (`173.0g`, `50.0g`, no word)
 *      may itself be one whole item (`Baked potato` 173 g), and the estimator's `whole`
 *      repeats within 1.5x on 170 of 186 records drawn twice (rf-whole), so a whole within
 *      BARE_MASS_WHOLE_MARGIN (1.5x) of a bare-mass label cannot be told from "the label is
 *      the item" and the label stands. A `portion` / `serving` word says the label is a
 *      share, so no margin there. Any whole above FRACTION_WHOLE_MAX_GRAMS (2,000 g; a
 *      roast, a holiday bird, a multipack: prod holds `Roast Turkey` whole = 3,000 g) is
 *      not one item a person logs a fraction of, and is declined.
 *      The cap and the margin bound THIS rule's bill, not the saved row: getOrCreateAmbiguousServing()
 *      persists a model or sibling answer (OffServing `whole` / `small` / `medium` / `large`; nosave=1 refuses it)
 *      BEFORE wholeAccepted() reads it, so a refused or over-cap answer is saved too, and `whole` has no
 *      getAmbiguousUnitBounds() entry to reject it later. Seed answers are never saved. A bad row is
 *      removed by deleting that one OffServing row; the kill switch leaves saved rows in place.
 * Kill switch: SERVING_FRACTION_WHOLE="0" restores today's bill (no build needed).
 */
import { extractLabelServingUnit, labelPieceMatchesItem, singularizeUnit } from '../count-label';
import { assessRankTimePlausibility } from '../macro-plausibility';
import type { ParsedIngredient } from '../../parse/ingredient-line';

/** A fraction of ONE item, said with an indefinite article (predicate 1). */
const FRACTION_OF_AN_ITEM_RE = new RegExp(
    String.raw`^\s*(?:about |maybe |like |around |roughly |approx\.? )?`
    + String.raw`(?:(?:a |one )?half|(?:a |one )?quarter|(?:a |one )?third|(?:two|three) (?:thirds|quarters)`
    + String.raw`|\d+\s*\/\s*\d+|\d*\.\d+|[½¼¾⅓⅔])`
    + String.raw`\s+(?:of\s+)?(?:a|an)\s+\S`,
    'i',
);

const MASS_WORDS = new Set(['g', 'gr', 'gram', 'grams', 'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds', 'kg', 'mg']);
const VOLUME_WORDS = new Set([
    'ml', 'l', 'cl', 'dl', 'liter', 'litre', 'fl', 'floz', 'cup', 'cups', 'tbsp', 'tablespoon', 'tsp', 'teaspoon',
    'pint', 'quart', 'gallon',
]);
/** Words that name a share of the food, never the whole item. */
const PORTION_WORDS = new Set(['portion', 'serving', 'servings', 'svg', 'porcion', 'porción']);

export type FractionOneShape = 'whole' | 'portion' | 'volume';

/**
 * What the record's "one" is, read from the serving label that would bill it.
 * `description` null = no label (the fabricated 100 g floor) = a portion.
 */
export function fractionOneShape(description: string | null | undefined, itemName: string): FractionOneShape {
    if (!description || !description.trim()) return 'portion';
    const word = extractLabelServingUnit(description);
    if (word == null) return 'portion';
    if (MASS_WORDS.has(word)) return 'portion';
    if (VOLUME_WORDS.has(word)) return 'volume';
    if (labelPieceMatchesItem(word, itemName)) return 'whole';
    if (PORTION_WORDS.has(word)) return 'portion';
    return 'whole';
}

/** Predicate 1: a unit-less fraction 0 < q < 1 of one item, said with `a`/`an`. */
export function isFractionOfAnItem(parsed: ParsedIngredient | null, rawLine: string): boolean {
    if (!parsed || parsed.unit) return false;
    const q = parsed.qty * (parsed.multiplier ?? 1);
    if (!(q > 0 && q < 1)) return false;
    if (!FRACTION_OF_AN_ITEM_RE.test(rawLine ?? '')) return false;
    // `half a glass of milk`, `half an order of fries`, `half a 2 liter of mountain dew`:
    // the item is the CONTAINER, and the record is what is in it, so the record's
    // whole is not the item asked for (a whole `Milk` is a gallon). Declined.
    const item = (parsed.name ?? '').replace(/^\s*(?:of\s+)?(?:a|an|the)\s+/i, '');
    return !/\bof\b/i.test(item);
}

/**
 * Predicate 4 (s461 rf-whole): the RECORD is the item. The `whole` estimate is asked of
 * the record's own name, so when the winner is a product MADE FROM the item, or the item
 * is a dish built on the record, the model answers a bottle, a box, a pack or a whole cut:
 * replay (MEASURED, rf-whole) `half an avocado` on `Avocado Oil` 7.5 -> 250 g / 2,000 kcal,
 * `half a muffin` on `Muffin mix` 225 g, `half a hamburger` on `85% Lean Ground Beef`
 * 56 -> 250 g (a 1 lb pack), `half a brisket plate` on `Brisket` 42.5 -> 850 g (a whole
 * brisket), `half a beef and bean chili dog` on `Beef Chili and Beans` 212.5 g (a can).
 * So the two names must share their HEAD word: the last word before any `with` / `on` /
 * `from` / `w/` clause, singular. `Rotisserie Chicken` / `costco rotisserie chicken`,
 * `Pepperoni Pizza` / `digiorno pepperoni pizza`, `Original Bagels With Cream Cheese` /
 * `bagel with cream cheese` pass; `oil` / `avocado`, `beef` / `hamburger`, `brisket` /
 * `plate` do not. A miss keeps today's bill (the safe direction).
 */
function headWord(name: string | null | undefined): string | null {
    const clause = (name ?? '').toLowerCase().replace(/['’]/g, '').split(/\s(?:with|on|from)\s|\sw\//)[0];
    const words = clause.split(/[^a-z&]+/).filter(Boolean);
    return words.length ? singularizeUnit(words[words.length - 1]) : null;
}

export function recordIsTheItem(recordName: string | null | undefined, itemName: string | null | undefined): boolean {
    const record = headWord(recordName);
    return record != null && record === headWord(itemName);
}

export function fractionWholeEnabled(): boolean {
    return process.env.SERVING_FRACTION_WHOLE !== '0';
}

/** Predicate 3: take the whole weight only when it is more than the portion it replaces. */
export function wholeBeatsPortion(wholeGrams: number | null | undefined, portionGrams: number): boolean {
    return wholeGrams != null && Number.isFinite(wholeGrams) && wholeGrams > portionGrams;
}

/** Predicate 5: above this energy density a panel is a dry mix, a powder, a spread, an oil or a baked good, never a prepared whole item. */
export const FRACTION_WHOLE_MAX_KCAL_PER_100G = 300;
/** Predicate 8: no single item a person logs a fraction of weighs more (a roast or a multipack does). */
export const FRACTION_WHOLE_MAX_GRAMS = 2000;
/** Predicate 8: the estimator's `whole` repeats within 1.5x (170 of 186 records drawn twice, rf-whole). */
export const BARE_MASS_WHOLE_MARGIN = 1.5;

/** Predicate 6: the standard sizes the estimator answers as units, and below-standard sizes it cannot. */
const SIZE_UNIT: Readonly<Record<string, 'small' | 'medium' | 'large'>> = {
    small: 'small', sm: 'small', medium: 'medium', med: 'medium', large: 'large', lg: 'large',
};
const BELOW_STANDARD_SIZE = new Set(['kid', 'kids', 'kiddie', 'child', 'mini', 'little', 'snack', 'fun', 'junior', 'jr']);
/** Predicate 7: words that name a PACKAGE of the food, not one item of it. */
const PACKAGE_WORDS = new Set([
    'container', 'jar', 'tub', 'bag', 'box', 'carton', 'packet', 'pack', 'package', 'pkg', 'sleeve', 'tray', 'case',
]);
/** Predicate 7: drinks sold by the bottle and drunk by the pour (ALCOHOL_PATTERN's pour subset): their `whole` is the bottle. */
const BOTTLE_POUR_RE = /\b(?:wine|vodka|whiske?y|rum|gin|tequila|mezcal|liqueur|brandy|cognac|sake|champagne|prosecco|bourbon|scotch|soju|spirits?|vermouth|schnapps|absinthe|amaretto|kahlua|baileys?)\b/i;

function itemWords(itemName: string | null | undefined): string[] {
    return (itemName ?? '').toLowerCase().replace(/['’]/g, '').split(/[^a-z&]+/).filter(Boolean);
}

/**
 * Predicate 6: the size unit the fraction asks instead of `whole` (`half a small fries` -> `small`), or null.
 * The parser lifts `small` / `medium` / `large` out of the name into `qualifiers` (`a fries` + ['small']), and
 * leaves `med` / `lg` in the name, so both are read.
 */
export function fractionSizeUnit(parsed: Pick<ParsedIngredient, 'name' | 'qualifiers'> | null | undefined): 'small' | 'medium' | 'large' | null {
    const words = [...(parsed?.qualifiers ?? []).flatMap((q) => itemWords(q)), ...itemWords(parsed?.name)];
    for (const w of words) if (SIZE_UNIT[w]) return SIZE_UNIT[w];
    return null;
}

export type FractionWholeDecline = 'dense_panel' | 'implausible_panel' | 'below_standard_size' | 'package' | 'bottle_pour';

/**
 * Predicates 5-7, read BEFORE the estimate (a declined record costs no model call and writes
 * no row). `per100` is the record's panel; a missing panel declines nothing here.
 */
export function fractionWholeDecline(args: {
    itemName: string | null | undefined;
    recordName: string | null | undefined;
    rawLine: string;
    per100: Record<string, number> | null | undefined;
}): FractionWholeDecline | null {
    const words = itemWords(args.itemName);
    if (words.some((w) => BELOW_STANDARD_SIZE.has(w))) return 'below_standard_size';
    if (words.some((w) => PACKAGE_WORDS.has(w))) return 'package';
    if (BOTTLE_POUR_RE.test(args.itemName ?? '')) return 'bottle_pour';
    const kcal = args.per100 ? Number(args.per100.calories ?? args.per100.kcal) : NaN;
    if (Number.isFinite(kcal) && kcal > FRACTION_WHOLE_MAX_KCAL_PER_100G) return 'dense_panel';
    if (args.per100) {
        const item = (args.itemName ?? '').replace(/^\s*(?:of\s+)?(?:a|an|the)\s+/i, '');
        const rank = assessRankTimePlausibility(item, args.recordName ?? '', args.per100, args.rawLine);
        if (rank.impossible || rank.floorHit) return 'implausible_panel';
    }
    return null;
}

/**
 * Predicates 3 and 8, read AFTER the estimate: raise-only, under the cap, and on a BARE MASS
 * label (or no word: `1 | (123 g)`) more than BARE_MASS_WHOLE_MARGIN x the label. No label
 * (the fabricated 100 g floor) and a `portion` / `serving` label need only raise-only.
 */
export function wholeAccepted(
    wholeGrams: number | null | undefined, oneGrams: number, labelDescription: string | null | undefined,
): boolean {
    if (wholeGrams == null || !wholeBeatsPortion(wholeGrams, oneGrams)) return false;
    if (wholeGrams > FRACTION_WHOLE_MAX_GRAMS) return false;
    if (!labelDescription || !labelDescription.trim()) return true;
    const word = extractLabelServingUnit(labelDescription);
    // normalizeServingDescription() (openfoodfacts/serving-resolver.ts, NOT changed here) rewrites a bare gram label
    // (`173.0g`, `50.0g`, `37.0g`) to exactly `1 serving`: that `serving` is the normalizer's word, not the label's.
    // It also yields `1 serving` for `1 serving (85g)` (9 OffFood rows, s461 rf-whole2) and for a quantity with no
    // label text, so those take the margin too; `1 portion (85 g)` keeps its word and takes none.
    const bareMass = word == null || MASS_WORDS.has(word) || /^\s*1 serving\s*$/i.test(labelDescription);
    return !bareMass || wholeGrams > BARE_MASS_WHOLE_MARGIN * oneGrams;
}
