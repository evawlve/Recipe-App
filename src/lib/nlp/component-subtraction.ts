/**
 * Solo-path component subtraction (s447a, R2 class C).
 *
 * After the mapper bills the HEAD of `<dish> without|minus <component>`, subtract ONE
 * fixed portion of the component from the billed panel, but only when the dish is a
 * known carrier of it (see component-table.ts). Pure: no I/O, no logger. Every micro
 * arithmetic lives here, not in the route (sodium is GRAMS everywhere; NULL STAYS NULL).
 *
 * Skip reasons, one per cause: `unmapped`, `not_in_table`, `no_carrier`,
 * `too_large_kcal`, `too_large_grams`, `qty_out_of_range`. A multi-part clause may
 * partially subtract: success when >= 1 part subtracted, `partSkips` names the rest;
 * `{ skipped }` only when every part skips (the first part's reason).
 */

import { words } from './trailing-quantity-fold';
import { per100gFromBilledMacros } from './resolve-payload';
import { ALIASES, COMPONENT_TABLE } from './component-table';

export type SkipReason =
  | 'unmapped'
  | 'not_in_table'
  | 'no_carrier'
  | 'too_large_kcal'
  | 'too_large_grams'
  | 'qty_out_of_range';

export type BilledNutrition = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number | null;
  sugar: number | null;
  sodium: number | null;
};

export type Per100g = {
  kcal100: number;
  protein100: number;
  carbs100: number;
  fat100: number;
  fiber100: number | null;
  sugar100: number | null;
  sodium100: number | null;
};

export type Adjustment = {
  kind: 'removed';
  component: string;
  clause: string;
  foodId: string;
  grams: number;
  nutrition: {
    calories: number; protein: number; carbs: number; fat: number;
    fiber: number; sugar: number; sodium: number;
  };
};

export type SubtractionInput = {
  nutrition: BilledNutrition;
  grams: number;
  foodName: string;
  standardSource: string;
  head: string;
  clause: string;
  parsed?: { qty?: number | null; multiplier?: number | null; unit?: string | null } | null;
};

export type SubtractionResult =
  | {
      nutrition: BilledNutrition;
      nutritionPer100g: Per100g;
      adjustments: Adjustment[];
      partSkips?: { component: string; reason: SkipReason }[];
    }
  | { skipped: SkipReason };

const COUNT_LIKE_UNITS = new Set([
  'piece', 'pieces', 'each', 'ea', 'item', 'items', 'serving', 'servings', 'whole',
]);
const LEADING_DETERMINERS = new Set(['the', 'any', 'my', 'a', 'an']);
const MAX_HEAD_QTY = 10;
const MAX_KCAL_SHARE = 0.6;
const MAX_GRAMS_SHARE = 0.6;

const r1 = (x: number) => Number(x.toFixed(1));

function padded(s: string): string {
  return ` ${words(s).join(' ')} `;
}

/** Word-bounded containment of `term` (or its plural `+s`) in `text`. */
function names(text: string, term: string): boolean {
  const hay = padded(text);
  return hay.includes(` ${term} `) || hay.includes(` ${term}s `);
}

function keyOf(token: string): string | null {
  if (COMPONENT_TABLE[token]) return token;
  return ALIASES[token] ?? null;
}

/** Split a removal clause into its part strings (negator and leading determiner dropped). */
function clauseParts(clause: string): string[] {
  let w = words(clause).slice(1);
  if (w.length > 0 && LEADING_DETERMINERS.has(w[0])) w = w.slice(1);
  return w.join(' ').split(/ or | nor /).map(s => s.trim()).filter(Boolean);
}

/** The longest table key or alias matching the part's last 2, then last 1, tokens. */
function resolveKey(part: string): string | null {
  if (/\band\b/.test(part)) return null; // "onions and pickles": never guess which one
  const t = part.split(' ');
  if (t.length >= 2) {
    const two = keyOf(t.slice(-2).join(' '));
    if (two) return two;
  }
  return keyOf(t[t.length - 1]);
}

function headQtyOf(parsed: SubtractionInput['parsed']): number {
  const unit = (parsed?.unit ?? '').toLowerCase();
  if (unit !== '' && !COUNT_LIKE_UNITS.has(unit)) return 1;
  return (parsed?.qty ?? 1) * (parsed?.multiplier ?? 1);
}

export function applyComponentSubtraction(input: SubtractionInput): SubtractionResult {
  const { grams, foodName, standardSource, head, clause } = input;
  if (standardSource === 'ai_estimated' || !(input.nutrition.calories > 0) || !(grams > 0)) {
    return { skipped: 'unmapped' };
  }
  const headQty = headQtyOf(input.parsed);
  if (!(headQty > 0) || headQty > MAX_HEAD_QTY) return { skipped: 'qty_out_of_range' };

  const bill: BilledNutrition = { ...input.nutrition };
  const adjustments: Adjustment[] = [];
  const partSkips: { component: string; reason: SkipReason }[] = [];
  let firstSkip: SkipReason | null = null;
  const skip = (component: string, reason: SkipReason) => {
    if (firstSkip === null) firstSkip = reason;
    partSkips.push({ component, reason });
  };

  for (const part of clauseParts(clause)) {
    const key = resolveKey(part);
    if (!key) { skip(part, 'not_in_table'); continue; }
    const row = COMPONENT_TABLE[key];

    const namesComponent =
      names(foodName, key) || Object.keys(ALIASES).some(a => ALIASES[a] === key && names(foodName, a));
    const namesCarrier = row.carriers.some(c => names(head, c) || names(foodName, c));
    if (!namesComponent && !namesCarrier) { skip(key, 'no_carrier'); continue; }

    const compGrams = row.grams * headQty;
    if (compGrams > MAX_GRAMS_SHARE * grams) { skip(key, 'too_large_grams'); continue; }
    const f = compGrams / 100;
    const d = row.per100g;
    if (d.calories * f > MAX_KCAL_SHARE * bill.calories) { skip(key, 'too_large_kcal'); continue; }

    const sub = (billed: number, delta: number) => Math.max(0, r1(billed - delta));
    bill.calories = sub(bill.calories, d.calories * f);
    bill.protein = sub(bill.protein, d.protein * f);
    bill.carbs = sub(bill.carbs, d.carbs * f);
    bill.fat = sub(bill.fat, d.fat * f);
    if (bill.fiber != null) bill.fiber = sub(bill.fiber, d.fiber * f);
    if (bill.sugar != null) bill.sugar = sub(bill.sugar, d.sugar * f);
    if (bill.sodium != null) bill.sodium = sub(bill.sodium, d.sodium * f);

    adjustments.push({
      kind: 'removed',
      component: key,
      clause,
      foodId: row.fsId,
      grams: compGrams,
      nutrition: {
        calories: r1(d.calories * f), protein: r1(d.protein * f), carbs: r1(d.carbs * f),
        fat: r1(d.fat * f), fiber: r1(d.fiber * f), sugar: r1(d.sugar * f), sodium: r1(d.sodium * f),
      },
    });
  }

  if (adjustments.length === 0) return { skipped: firstSkip ?? 'not_in_table' };

  const macros = per100gFromBilledMacros({
    grams, kcal: bill.calories, protein: bill.protein, carbs: bill.carbs, fat: bill.fat,
  });
  if (!macros) return { skipped: 'unmapped' };
  const micro = (v: number | null) => (v == null ? null : Math.round(((v * 100) / grams) * 100) / 100);
  return {
    nutrition: bill,
    nutritionPer100g: {
      ...macros,
      fiber100: micro(bill.fiber),
      sugar100: micro(bill.sugar),
      sodium100: micro(bill.sodium),
    },
    adjustments,
    ...(partSkips.length ? { partSkips } : {}),
  };
}
