/**
 * volume-density.ts — THE owner of "how many grams is one ml of this food".
 *
 * WHY THIS EXISTS
 * ---------------
 * This rule existed in THREE hand-copied places, and only one of them was
 * correct:
 *
 *   - the OFF path in `mapIngredientWithFallback()` — had the `isPaste` tier
 *   - the FDC path in the same file       — did NOT
 *   - `buildFatSecretResult()`            — did NOT
 *
 * The paste tier was added because the dry-goods default badly undercounts
 * dense spreads; its own comment reads "2 tbsp peanut butter is ~32g, not 15g".
 * That fix landed in one copy. The other two kept billing `15ml × 0.5 = 7.5 g`
 * for a tablespoon of peanut butter.
 *
 * It stayed invisible because of WHO WINS. The FatSecret lane reached the
 * reranker on only 16.9% of queries (measured 2026-08-01 over 249 already-asked
 * lines), so the broken copies were rarely the ones billing. Fixing the
 * pre-rerank lane starvation raises that to ~53% and the divergence surfaces
 * immediately: `1 tbsp peanut butter` 16 g → 7.5 g, `1 cup greek yogurt`
 * 250 g → 120 g. The gate caught it on 73 of 250 already-asked queries.
 *
 * So the defect this module closes is not "the FatSecret path is wrong". It is
 * "the same rule is maintained in three places", which guarantees that the next
 * correction lands in one of them.
 *
 * ONE OWNER, ONE CALLER SO FAR. Only `buildFatSecretResult()` calls this today.
 * `buildOffResult()` and `buildFdcResult()` still carry their inline copies, and
 * FDC is still the copy WITHOUT the paste tier. Do not read the existence of an
 * owner as evidence the callers use it — count them:
 *   grep -rn "volume-density" src/ | grep -v __tests__
 *
 * A caveat on FDC, measured 2026-08-02 and worth carrying, because it is the
 * opposite of what the code reads like: FDC's inline density table has NEVER
 * billed a live query. Of 4,491 `volume_unit` events, ZERO have an FDC winner —
 * `findOwnFdcVolumeServing()` and `insertFdcAiServing()` absorb every FDC volume
 * request ahead of it (`fdc_label_volume` 865, `fdc_volume_cached` 317,
 * `fdc_volume_ai` 318, density fallback 0). So converging FDC is a near-free
 * deletion of a latent landmine, not a repair of live billing; the live
 * population is entirely OFF's. Re-derive:
 *   SELECT "servingTier", count(*) FROM "MappingEventLog"
 *   WHERE "servingTier" LIKE '%volume%' GROUP BY 1;
 *
 * Note also that OFF and FDC both stamp the SAME tier string `volume_unit`, so
 * the event log cannot attribute a wrong gram bill to a lane. That is how the
 * FDC copy stayed divergent unseen; splitting the tiers belongs with the
 * convergence commit.
 *
 * Re-derive the divergence:
 *   grep -rn "isPaste" src/            # was 1 file before this module existed
 *
 * NOT A DENSITY MODEL. Any change to the NUMBERS is a separate PR with its own
 * winner-gate run, because grams feed the save gates and the cached row.
 *
 * PROVENANCE, corrected 2026-08-02 — an earlier version of this header claimed
 * the constants were "the OFF path's constants verbatim". That is FALSE for
 * `ml`, `floz` and `fl oz`. `cup`/`tbsp`/`tsp` came from OFF; `ml`/`floz` came
 * from FDC, which is what `buildFatSecretResult()` already did before the move,
 * so nothing regressed — but the header was asserting agreement that does not
 * exist. Measured over 9 foods x 15 unit keys, 21 of 135 cells differ from OFF.
 *
 * The disagreement is real and OFF is the wrong one: OFF hardcodes `ml: 1` and
 * `floz: 30` UNSCALED, so it bills `1 cup flour` at 127.2g and `240 ml flour`
 * at 240g — the same volume of the same food, 1.89x apart, contradicting the
 * density it computed one line earlier. This module scales them. Converging OFF
 * onto it is measured to move 0 of 4,473 live `volume_unit` events (`ml`/`floz`
 * have zero production traffic), but it is a constant change and belongs in its
 * own commit with its own gate.
 *
 * Re-derive the cell-level diff by executing both inline blocks:
 *   the OFF block in `buildOffResult()` vs `resolveVolumeGrams()`, same inputs.
 */

import {
    inferCategoryFromName,
    categoryDensity,
    DRY_GRANULE_DENSITY_CATEGORIES,
} from './density';

/** Millilitres per volume unit. The unit tables in the callers were identical
 *  except that one spelled `cup` 240 and another 240 — kept at 240. */
export const VOLUME_UNIT_ML: Record<string, number> = {
    'cup': 240, 'cups': 240,
    'tbsp': 15, 'tablespoon': 15, 'tablespoons': 15,
    'tsp': 5, 'teaspoon': 5, 'teaspoons': 5,
    'ml': 1, 'milliliter': 1, 'milliliters': 1,
    'floz': 30, 'fl oz': 30,
};

/** Foods that pour. ~1 g/ml. */
const LIQUID_RE = /broth|stock|water|juice|milk|sauce|vinegar|oil|syrup/i;

/**
 * Dense pastes and spreads, ~1 g/ml rather than the dry-goods default.
 * Verbatim from the OFF path — this is the list that made `2 tbsp peanut
 * butter` bill ~32 g instead of 15 g.
 */
const PASTE_RE =
    /butter|spread|hummus|yogurt|yoghurt|honey|mayo|mayonnaise|jam|jelly|nutella|tahini|cream cheese|sour cream|ricotta|paste|dressing|ketchup|mustard/i;

export type VolumeClass = 'liquid' | 'paste' | 'solid';

export interface VolumeGrams {
    /** Grams for one of each supported volume unit. */
    perUnit: Record<string, number>;
    /** Which branch decided it — logged, so a wrong bill is traceable to a rule. */
    volumeClass: VolumeClass;
    /** g/ml actually used for solids (category density, or the 0.5 default). */
    solidDensity: number;
}

/**
 * Resolve grams-per-volume-unit for a food, by NAME.
 *
 * `names` are tried in order and the FIRST NON-EMPTY one classifies; the rest
 * are fallbacks for an unnamed record, not additional evidence. Callers pass
 * the matched candidate's name first because that is what the OFF path
 * classifies on (`isLiquid`/`isPaste` in `buildOffResult()` test
 * `candidate.name` alone).
 *
 * KNOWN DIVERGENCE, not closed here: `buildFdcResult()` tests the query name
 * TOO (`RE.test(candidate.name) || RE.test(parsed?.name || '')`), so the three
 * cascades disagree about whether what the USER typed may classify the food.
 * It matters — `1 tbsp peanut butter` matching a record named "Skippy Creamy"
 * has no paste token in the candidate name and bills the dry-goods 7.5g.
 * Widening this to consider every name is a BEHAVIOUR change that moves grams,
 * so it needs its own winner-gate run; it is deliberately not bundled with the
 * de-duplication.
 */
export function resolveVolumeGrams(...names: Array<string | null | undefined>): VolumeGrams {
    const name = names.find(n => n && n.trim().length > 0)?.trim() ?? '';

    const isLiquid = LIQUID_RE.test(name);
    const isPaste = !isLiquid && PASTE_RE.test(name);

    // Dry-solid density: prefer the food's category density (sugar 0.85, flour
    // 0.53, oats 0.36 …) over a flat 0.5, which under-weighted DENSE solids by
    // ~40% — granulated sugar billed 2.5 g/tsp instead of ~4.25 g (n-serv-14).
    //
    // ONLY for unambiguous dry-granular categories. rice/grain/dairy stay at 0.5
    // on purpose: overriding them overshoots COOKED servings and trips the
    // serving bands (n-serv-01/03/04). That restriction is load-bearing, not
    // conservatism — do not widen it without re-running those cases.
    let solidDensity = 0.5;
    const category = inferCategoryFromName(name);
    if (category && DRY_GRANULE_DENSITY_CATEGORIES.has(category)) {
        const catDensity = categoryDensity(category);
        if (catDensity && catDensity > 0) solidDensity = catDensity;
    }

    const cupG = isLiquid ? 240 : isPaste ? 250 : 240 * solidDensity;
    const tbspG = isLiquid ? 15 : isPaste ? 16 : 15 * solidDensity;
    const tspG = isLiquid ? 5 : isPaste ? 5.3 : 5 * solidDensity;
    const mlG = isLiquid ? 1 : isPaste ? 1 : solidDensity;
    const flozG = isLiquid ? 30 : isPaste ? 30 : 30 * solidDensity;

    return {
        perUnit: {
            'cup': cupG, 'cups': cupG,
            'tbsp': tbspG, 'tablespoon': tbspG, 'tablespoons': tbspG,
            'tsp': tspG, 'teaspoon': tspG, 'teaspoons': tspG,
            'ml': mlG, 'milliliter': mlG, 'milliliters': mlG,
            'floz': flozG, 'fl oz': flozG,
            // Micro-volume spice measures: absolute, not density-scaled. A pinch
            // of anything is a pinch.
            'dash': 0.6, 'dashes': 0.6,
            'pinch': 0.3, 'pinches': 0.3,
        },
        volumeClass: isLiquid ? 'liquid' : isPaste ? 'paste' : 'solid',
        solidDensity,
    };
}

/** Grams for `qty` of `unit`, or null when the unit is not a volume unit. */
export function volumeToGrams(
    qty: number,
    unit: string | null | undefined,
    ...names: Array<string | null | undefined>
): { grams: number; volumeClass: VolumeClass } | null {
    if (!unit) return null;
    const resolved = resolveVolumeGrams(...names);
    const perUnit = resolved.perUnit[unit.toLowerCase()];
    if (perUnit == null) return null;
    return { grams: qty * perUnit, volumeClass: resolved.volumeClass };
}
