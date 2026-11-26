/**
 * FDA label rounding (21 CFR 101.9(c)), for chains whose source publishes UNROUNDED panels (Nutritionix `calculated*`
 * fields, e.g. Boneless Wings - Sampler calories 325.5328). Applebee's own calculator sets `useFdaRounding: 1`, and its
 * rendered labels agree with these bands on 70 of 70 observed cells (mobile repo CHAIN-5 r2 report).
 *
 * Bands are read off the RAW value (reasoning from the regulation, confirmed on those cells):
 *  - kcal:   < 5 -> 0; <= 50 -> nearest 5; else nearest 10.
 *  - fat (total, saturated, trans): < 0.5 -> 0; < 5 -> nearest 0.5; else nearest 1.
 *  - chol:   < 2 -> 0; <= 5 -> null ("less than 5 mg"); else nearest 5.
 *  - sodium: < 5 -> 0; <= 140 -> nearest 5; else nearest 10.
 *  - gram (carbs, fiber, sugars, protein): < 0.5 -> 0; < 1 -> null ("less than 1 g"); else nearest 1.
 * A "less than" band is null, the same as `num()` does with a printed "<1": the chain stated no number.
 *
 * The tie rule is a CHOICE: an exact tie goes to the even multiple (half-to-even, the default). The one observed tie
 * (84.5 -> 84) fits; the INM's actual rule is UNVERIFIED. A negative or non-finite value throws.
 */
export type FdaRule = 'kcal' | 'fat' | 'chol' | 'sodium' | 'gram';

function nearest(v: number, step: number): number {
  const q = v / step;
  const f = Math.floor(q);
  const d = q - f;
  const n = Math.abs(d - 0.5) < 1e-9 ? (f % 2 === 0 ? f : f + 1) : Math.round(q);
  return n * step;
}

export function fdaRound(rule: FdaRule, v: number): number | null {
  if (!Number.isFinite(v) || v < 0) throw new Error(`fdaRound(${rule}): ${v} is not a non-negative number`);
  switch (rule) {
    case 'kcal':
      return v < 5 ? 0 : v <= 50 ? nearest(v, 5) : nearest(v, 10);
    case 'fat':
      return v < 0.5 ? 0 : v < 5 ? nearest(v, 0.5) : nearest(v, 1);
    case 'chol':
      return v < 2 ? 0 : v <= 5 ? null : nearest(v, 5);
    case 'sodium':
      return v < 5 ? 0 : v <= 140 ? nearest(v, 5) : nearest(v, 10);
    case 'gram':
      return v < 0.5 ? 0 : v < 1 ? null : nearest(v, 1);
  }
}
