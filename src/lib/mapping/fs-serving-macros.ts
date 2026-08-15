/**
 * fs-serving-macros.ts — THE reader for FatSecretServing.nutrients Json.
 *
 * Extracted verbatim from build-fatsecret-result.ts (2026-07-27) so that the
 * correctness screen and the production macro-only branch read serving-level
 * nutrition through the SAME function. The screen's first draft re-implemented
 * this reader (`Number(n.calories ?? n.kcal ?? NaN)`) and diverged on
 * string-typed Json values: `Number('') === 0` reads an empty string as a
 * genuine 0 kcal billing basis, while this reader's parseFloat returns NaN and
 * refuses it — playbook §11 class A (the instrument forks the system). Any
 * future caller that needs "what kcal does the FatSecret lane bill from this
 * nutrients Json" must import this, never re-derive it.
 *
 * PURE by design: no prisma, no logger, no config — importable by offline
 * eval tooling without dragging in a DB client. Its one import is the tier
 * registry, itself a leaf module, so there is no cycle to create.
 */

import { FS_SERVING_MACROS_ONLY_EST_TIER } from './serving-ai-tiers';

export interface Macros { kcal: number; protein: number; carbs: number; fat: number }

export function num(v: unknown): number | null {
    const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
    return Number.isFinite(n) ? n : null;
}

/**
 * Per-serving macros from a FatSecretServing.nutrients Json. The lane persists
 * the client's normalized field names (calories/protein/carbohydrate/fat);
 * accept kcal/carbs synonyms defensively — Json columns carry no schema.
 */
export function servingMacros(nutrients: Record<string, unknown> | null): Macros | null {
    if (!nutrients) return null;
    const kcal = num(nutrients['calories'] ?? nutrients['kcal']);
    if (kcal == null) return null;
    return {
        kcal,
        protein: num(nutrients['protein']) ?? 0,
        carbs: num(nutrients['carbohydrate'] ?? nutrients['carbs']) ?? 0,
        fat: num(nutrients['fat']) ?? 0,
    };
}

/**
 * The energy density the macro-only path assumes when it has to invent a weight.
 *
 * IT IS 3.7x WRONG AND THAT IS NOT FIXABLE BY CHANGING IT. Measured on the box
 * 2026-08-14, on the 76 tier-firing records that DO carry a panel (so the true
 * weight is recoverable by inversion): median est/true 0.273, p10 0.033, p90
 * 1.105, only 11 of 76 within +-25%. The true densities behind this population
 * run 0-494 kcal/100 g, so no single constant can serve a brewed coffee and a
 * fried chicken thigh. It is also load-bearing in the
 * `estPerServingGrams < BARE_LABEL_MIN_GRAMS` floor test in
 * build-fatsecret-result.ts, so moving it changes which tier fires.
 * Owner: sync-docs/reports/2026-08-14_the-empty-panel-serving-is-synthetic.md
 * (mobile repo).
 */
export const PREPARED_FOOD_KCAL_PER_GRAM = 2.0;

/**
 * Estimate a serving's gram weight from its per-serving macros, used ONLY for
 * FatSecret records that carry per-serving macros but no metric weight and no
 * per-100g panel (FatSecret's generic "1 serving" restaurant records — e.g.
 * "Impossible Whopper", "Cheese Fries [Shake Shack]"). Grams is secondary
 * metadata on this path: the per-serving macros are billed directly and stay
 * authoritative, so a neutral energy-density estimate is sufficient. Floored at
 * the physical macro mass (protein + carbs + fat), which a food can never weigh
 * less than, so the reported density can never exceed a plausible value.
 *
 * MOVED HERE FROM build-fatsecret-result.ts (2026-08-14), verbatim, for the
 * same reason `servingMacros` moved: `/api/foods/search`'s local lane now has
 * to answer the identical question ("what weight does the FatSecret lane put on
 * a macro-only serving?") and a second implementation would let the two lanes
 * bill differently for the same record. Any caller that reaches for this MUST
 * also stamp `FS_SERVING_MACROS_ONLY_EST_TIER` and honour
 * `isSyntheticGramsTier()` (./serving-ai-tiers) — the number is admissible only
 * when it travels with the flag that says it was invented.
 *
 * The `1` in the max() is a DIVISION GUARD, not an estimate: at zero energy and
 * zero macro mass there is nothing to estimate from. A caller that divides by
 * the result must handle that case itself rather than read 1 g as a portion.
 */
export function estimateServingGrams(m: Macros): number {
    const macroMass = m.protein + m.carbs + m.fat;
    const byEnergy = m.kcal > 0 ? m.kcal / PREPARED_FOOD_KCAL_PER_GRAM : 0;
    return Math.max(macroMass, byEnergy, 1);
}

function round2(v: number): number {
    return Math.round(v * 100) / 100;
}

/** What a caller gets back when a macro-only FatSecret serving is recoverable. */
export interface MacroOnlyServingRecovery {
    /**
     * Per-100g figures. THIS IS NOT A DENSITY CLAIM. It is the self-consistency
     * term that makes `per100.kcal * grams / 100 === billed kcal` true, exactly
     * as `per100gFromBilledMacros()` does on the parse wire — see the header of
     * `recoverMacroOnlyServing` for why it must never be read as one.
     */
    per100: Macros & { fiber?: number; sugars?: number; sodium?: number };
    /** The record's own serving label — "1 serving", "1 can", "1 medium". */
    label: string;
    /**
     * The serving's estimated weight, or `null` when the serving carries no
     * energy and no macro mass to estimate from (a 0 kcal drink). `null` means
     * "this record states no weight and none can be inferred" — NOT 1 g, which
     * is `estimateServingGrams`'s division guard and is not a portion.
     */
    grams: number | null;
    /** Always the synthetic-grams tier — this IS that producer's `fromPanel == null` leg. */
    tier: typeof FS_SERVING_MACROS_ONLY_EST_TIER;
}

/**
 * Recover the real serving behind a FatSecret record whose per-100g derivation
 * refused it.
 *
 * WHEN THIS FIRES. `derivePer100gFromServings()` (fatsecret-lane.ts) needs a
 * serving with usable GRAMS — `metricServingUnit === 'g'`, an explicit
 * `servingWeightGrams`, or `metricServingUnit === 'ml'` times a density. A
 * FatSecret "1 serving" restaurant row has none of the three, so it returns
 * null and the candidate reaches consumers with `nutrition` undefined even
 * though its macros are right there in `rawData.servings`. Measured on the box
 * 2026-08-14: 3,394 of 24,124 `FatSecretFood` rows are that shape (Dunkin' 155,
 * Panera 106, Jersey Mike's 83, Cheesecake Factory 76, Jimmy John's 75).
 *
 * WHY `per100` IS NOT A DENSITY. `grams` here is `estimateServingGrams`, i.e.
 * `kcal / 2.0`, so `kcal * 100 / grams` is a flat 200.0 for essentially the
 * whole population — measured 2026-08-14, 3,398 of 3,402 macro-bearing servings
 * on empty-panel foods take the energy branch. Brewed coffee and fried chicken
 * would both read 200 kcal/100 g. The number is admissible ONLY as the
 * arithmetic that keeps `per100 x grams/100 === the record's own billed macros`
 * true, and ONLY when it travels with a flag saying the weight was invented.
 * That is why `tier` is returned rather than left to the caller: every consumer
 * must run it through `isSyntheticGramsTier()` (./serving-ai-tiers) and surface
 * the result — ship the pair or ship neither.
 *
 * SELECTION PARITY with the mapper. build-fatsecret-result.ts's macro-only
 * branch prefers the record's `defaultServingId` and otherwise takes the first
 * serving carrying macros; `fatsecret-lane.ts` sets that default to
 * `hit.servings[0].id`, so "first serving with macros" is the same rule on an
 * API-shaped array. `servingMacros` accepts the API's `carbohydrate` and the
 * DB's `carbs` spelling, so this reads either shape.
 *
 * Accepts `unknown` because its search-lane caller reads it off an `any`-typed
 * `rawData`; every field is re-validated here rather than trusted.
 */
export function recoverMacroOnlyServing(servings: unknown): MacroOnlyServingRecovery | null {
    if (!Array.isArray(servings)) return null;
    for (const s of servings) {
        if (!s || typeof s !== 'object') continue;
        const row = s as Record<string, unknown>;
        const m = servingMacros(row);
        if (!m) continue;
        const label = String(row['description'] ?? row['measurementDescription'] ?? '').trim();
        if (!label) continue;

        // Nothing to estimate a weight from: report the (correct, complete) zero
        // panel and say so with a null weight rather than billing the 1 g guard.
        if (!(m.kcal > 0) && !(m.protein > 0) && !(m.carbs > 0) && !(m.fat > 0)) {
            return {
                per100: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
                label,
                grams: null,
                tier: FS_SERVING_MACROS_ONLY_EST_TIER,
            };
        }

        const grams = estimateServingGrams(m);
        const factor = 100 / grams;
        const per100: MacroOnlyServingRecovery['per100'] = {
            kcal: round2(m.kcal * factor),
            protein: round2(m.protein * factor),
            carbs: round2(m.carbs * factor),
            fat: round2(m.fat * factor),
        };
        // Same fields and the same mg->g sodium conversion as
        // derivePer100gFromServings, so a recovered row and a derived one carry
        // the identical units. Omitted (not zeroed) when the serving is silent —
        // this function exists because a manufactured zero is the defect.
        const fiber = num(row['fiber']);
        if (fiber != null) per100.fiber = round2(fiber * factor);
        const sugars = num(row['sugar'] ?? row['sugars']);
        if (sugars != null) per100.sugars = round2(sugars * factor);
        const sodium = num(row['sodium']);
        if (sodium != null) per100.sodium = Math.round(sodium * factor) / 1000;

        return { per100, label, grams, tier: FS_SERVING_MACROS_ONLY_EST_TIER };
    }
    return null;
}
