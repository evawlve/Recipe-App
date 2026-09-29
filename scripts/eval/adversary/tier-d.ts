/**
 * tier-d.ts — the hard-case loop's deterministic bounds (Lane A S63, pm109).
 *
 * Pure: no network, no DB, no parser import. The caller hands in the shipped parser's
 * reading of the line (`parseIngredientLine()` from src/lib/parse/ingredient-line.ts,
 * lazy-required by cli.ts) so these rules read the SAME quantity the mapper does —
 * `qty × multiplier`, never `qty` alone (a capitalised `Half` arrives as multiplier 0.5,
 * Lane A S62 §ROW 2).
 *
 * Four rules, from the brief:
 *   D-kcal-per-g  billed kcal / billed grams outside 0–9 (pure fat is 9).
 *   D-flat-100g   the row billed the flat-100 g default (`flat_100g_default`): no anchor.
 *   D-count       grams per count unit outside the food class's band. The bands are
 *                 REASONED from common label weights, not fitted to any row; the one
 *                 load-bearing number is the 25 g ceiling on a snack piece, which is
 *                 S49 §3's "a snack bite over 25 g flags".
 *   D-volume      grams per CUP (tbsp/tsp/ml/... converted) under the class floor or
 *                 over the class ceiling. The default floor is 60 g/cup (S49 §3); the
 *                 ceilings are per class, so a leafy green billed like a dense food
 *                 (60 g for half a cup of raw spinach is ~4× over) is caught as an
 *                 OVER-bill, which a floor alone cannot see.
 *
 * A hit is a FLAG, never a verdict: every flag gets a reproduction before it becomes
 * anything (the brief's "THE LOOP NEVER" list). Whatever a class band gets wrong, the
 * judge still sees a capped sample of the rows Tier D flagged, and the report names
 * the rule and the numbers so a reader can discard a false fire in one glance.
 *
 * What this file CANNOT see: a line whose items vanished (a vanished item writes no
 * MappingEventLog row) — that check lives in Mode G, which knows how many foods it asked
 * for; and identity — `spinach` billed as a pizza is a judge question.
 */

export interface ParsedLine {
    qty: number;
    multiplier: number;
    unit: string | null;
    /** The parser's unitHint (`white`/`yolk` for egg parts); optional. */
    unitHint?: string | null;
    name: string;
}

export interface ServedItem {
    rawLine: string;
    parsed: ParsedLine | null;
    foodName: string;
    grams: number | null;
    kcal: number | null;
    tier: string | null;
}

export type TierDRule = 'D-kcal-per-g' | 'D-flat-100g' | 'D-count' | 'D-volume';

export interface TierDHit { rule: TierDRule; detail: string }

/** Cups per ONE of each volume unit the parser emits (`normalizeUnitToken()` in src/lib/parse/unit.ts). */
export const CUPS_PER_UNIT: Record<string, number> = {
    cup: 1,
    tbsp: 1 / 16,
    tsp: 1 / 48,
    ml: 1 / 236.6,
    floz: 1 / 8,
    l: 1000 / 236.6,
    pint: 2,
    quart: 4,
};

export interface Band { cls: string; min: number; max: number }

interface VolumeClass extends Band { name: RegExp; unless?: RegExp }

/**
 * First match wins, tested against `<rawLine> <foodName>` lowercased. Leafy and airy
 * foods are light per cup, so the 60 g/cup floor does not apply to them; their ceiling
 * is what matters. Everything unmatched is `default`.
 */
export const VOLUME_CLASSES: VolumeClass[] = [
    {
        cls: 'leafy-or-herb',
        name: /\b(spinach|lettuce|kale|arugula|romaine|spring mix|mixed greens?|greens|mesclun|watercress|chard|cilantro|parsley|basil|mint leaves|oregano|thyme|rosemary|dill|sage|italian seasoning|dried herbs|(green|garden|side|house) salad)\b/,
        unless: /\b(cooked|boiled|steamed|saut[eé]ed|creamed|frozen|wilted|canned|pesto|dip)\b/,
        min: 3, max: 60,
    },
    {
        cls: 'airy',
        name: /\b(popcorn|puffs?|cheetos|cheese puffs|chips|crisps|cereal|cheerios|krispies|corn flakes|puffed|marshmallows?)\b/,
        min: 8, max: 75,
    },
    {
        cls: 'syrup-or-nut-butter',
        name: /\b(honey|syrup|molasses|peanut butter|almond butter|nut butter|cashew butter|jam|jelly|nutella|preserves|agave)\b/,
        min: 60, max: 380,
    },
];
export const VOLUME_DEFAULT: Band = { cls: 'default', min: 60, max: 300 };

interface CountClass extends Band { units: (string | null)[]; name: RegExp; unless?: RegExp; hint?: string[] }

/**
 * Grams per ONE count unit. `units: null` means "a bare count with no unit word"
 * (`9 bites`, `two eggs` read with unit `egg`, `3 oreos`); such lines only enter a
 * class when qty × multiplier >= 2, because `a pizza` or `1 burrito` is a whole
 * item, not a piece.
 */
export const COUNT_CLASSES: CountClass[] = [
    {
        cls: 'egg-part', units: ['egg', null], hint: ['white', 'whites', 'yolk', 'yolks'],
        name: /\begg\b|\beggs\b/, min: 8, max: 45,
    },
    {
        cls: 'egg', units: ['egg', null],
        name: /\beggs?\b/, unless: /\b(white|whites|yolk|yolks|salad|roll|rolls|plant|nog|noodles?|bites?|muffins?|sandwich|mcmuffin|burrito)\b/,
        min: 25, max: 75,
    },
    {
        cls: 'snack-piece', units: ['piece', null],
        name: /\b(bites?|minis?|candy|candies|gumm(y|ies)|chips?|crisps?|crackers?|pretzels?|cookies?|oreos?|m&m'?s|skittles|jelly ?beans?|popcorn|almonds?|cashews?|peanuts?|pecans?|walnuts?|pistachios?|nuts?|grapes?|blueberr(y|ies)|raspberr(y|ies)|chocolate chips?|marshmallows?|tots?|nuggets?|drizzilicious|drizzliscious)\b/,
        min: 0.2, max: 25,
    },
    {
        cls: 'bread-slice', units: ['slice'],
        name: /\b(bread|toast|sourdough|rye|brioche|baguette|texas toast)\b/, unless: /\bpizza\b/,
        min: 12, max: 80,
    },
    {
        cls: 'cheese-slice', units: ['slice'],
        name: /\bcheese\b/, unless: /\b(pizza|cake|cheesecake|burger)\b/,
        min: 8, max: 45,
    },
    {
        cls: 'deli-slice', units: ['slice'],
        name: /\b(ham|turkey|salami|bologna|pepperoni|prosciutto|bacon|roast beef|pastrami)\b/, unless: /\bpizza\b/,
        min: 2, max: 45,
    },
    { cls: 'pizza-slice', units: ['slice'], name: /\bpizza\b/, min: 50, max: 300 },
    { cls: 'scoop', units: ['scoop'], name: /./, min: 5, max: 90 },
    { cls: 'bar', units: ['bar'], name: /./, min: 10, max: 130 },
    // Every other piece/slice: only the gross ceiling of the estimator's own `piece`
    // cap (UNIT_MAX_GRAMS, 200 g) with room — this catches a whole dish billed per piece.
    { cls: 'any-piece-or-slice', units: ['piece', 'slice'], name: /./, min: 0.2, max: 250 },
];

export function effectiveQty(p: ParsedLine): number {
    const q = Number(p.qty) * (Number.isFinite(Number(p.multiplier)) && Number(p.multiplier) > 0 ? Number(p.multiplier) : 1);
    return Number.isFinite(q) ? q : NaN;
}

function subject(item: ServedItem): string {
    return `${item.rawLine} ${item.foodName}`.toLowerCase().replace(/[’`]/g, "'");
}

export function volumeBandFor(item: ServedItem): Band {
    const s = subject(item);
    for (const c of VOLUME_CLASSES) {
        if (c.name.test(s) && !(c.unless && c.unless.test(s))) return { cls: c.cls, min: c.min, max: c.max };
    }
    return VOLUME_DEFAULT;
}

export function countBandFor(item: ServedItem): Band | null {
    const p = item.parsed;
    if (!p) return null;
    const unit = p.unit ?? null;
    const s = subject(item);
    const hint = (p.unitHint ?? '').toLowerCase();
    for (const c of COUNT_CLASSES) {
        if (!c.units.includes(unit)) continue;
        if (unit === null && effectiveQty(p) < 2) continue;
        if (c.hint && !c.hint.includes(hint)) continue;
        if (!c.name.test(s)) continue;
        if (c.unless && c.unless.test(s)) continue;
        return { cls: c.cls, min: c.min, max: c.max };
    }
    return null;
}

const fmt = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1));

/** Every Tier-D hit for one served item. Empty = the row passed Tier D. */
export function tierD(item: ServedItem): TierDHit[] {
    const hits: TierDHit[] = [];
    const g = item.grams;
    const k = item.kcal;

    if (item.tier === 'flat_100g_default') {
        hits.push({ rule: 'D-flat-100g', detail: `billed the flat 100 g default (tier ${item.tier}): no gram anchor` });
    }

    if (g != null && g > 0 && k != null) {
        const kpg = k / g;
        if (kpg < 0 || kpg > 9) {
            hits.push({ rule: 'D-kcal-per-g', detail: `${fmt(k)} kcal over ${fmt(g)} g = ${kpg.toFixed(2)} kcal/g, outside 0–9` });
        }
    }

    const p = item.parsed;
    if (p && g != null && g > 0) {
        const q = effectiveQty(p);
        const unit = p.unit ?? null;
        if (Number.isFinite(q) && q > 0) {
            const cupsPer = unit ? CUPS_PER_UNIT[unit] : undefined;
            if (cupsPer !== undefined) {
                const cups = q * cupsPer;
                const perCup = g / cups;
                const band = volumeBandFor(item);
                if (perCup < band.min || perCup > band.max) {
                    hits.push({
                        rule: 'D-volume',
                        detail: `${fmt(q)} ${unit} = ${cups.toFixed(3)} cup billed ${fmt(g)} g = ${fmt(perCup)} g/cup, `
                            + `outside the ${band.cls} band ${band.min}–${band.max} g/cup`,
                    });
                }
            } else {
                const band = countBandFor(item);
                if (band) {
                    const per = g / q;
                    if (per < band.min || per > band.max) {
                        hits.push({
                            rule: 'D-count',
                            detail: `${fmt(q)} × ${unit ?? '(bare count)'} billed ${fmt(g)} g = ${fmt(per)} g each, `
                                + `outside the ${band.cls} band ${band.min}–${band.max} g`,
                        });
                    }
                }
            }
        }
    }
    return hits;
}
