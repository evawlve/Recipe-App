/**
 * scoop-liquid-escape.ts — a SCOOP line must not be billed off a cached
 * READY-TO-DRINK record, and must not take that record's key away from the
 * bare line either.
 *
 * THE DEFECT (s459). The cache key carries no unit, so `1 scoop muscle milk`
 * and `muscle milk` share the key `milk muscle`. That row holds the bottled
 * shake (`off_0052000051032`, "1 serving (330 ml)", 49 kcal/100 g): right for
 * the bare line, wrong for the scoop line, which is hydrated as a ~35 g scoop
 * of a 49 kcal/100 g drink — 17 kcal where the powder bills 140. Same shape:
 * `1 scoop meal replacement shake` (carton row, 28.5 kcal vs 142) and
 * `.7 scoop of vanilla protein` (Ideal Protein "335g" RTD, 8.1 vs 83.5).
 *
 * WHY THIS IS NOT THE count_label SHAPE, and why it must not write back.
 * The obvious read-time escape re-resolves cold and SAVES, and the save
 * overwrites the shared key: the powder then serves the BARE line
 * (bare `muscle milk` → 280 kcal), and nothing ever escapes it back — a key
 * capture, not a loop (s459 pd-key, probes C04/C05). Escaping without the
 * save never memoizes, so the line re-resolves on every request — which is
 * exactly the cost this module accepts, because it was measured to be tiny:
 * 0 LLM calls and ~0.15 s per re-resolution (s459 pd-keyn), on a population
 * of 5 lines all-time. `finalizeAndSaveResult()` reads the escape from
 * `readEscapes` and skips the write (`save_rejected:scoop_liquid`), so the
 * bare line's row is never touched and the event stays attributable.
 *
 * WHY NOT A UNIT IN THE KEY. Held (s459 rf-key): it forks every food scoop,
 * bypasses ten human-triage rows, and blinds the instruments that key from
 * MappingEventLog `normalizedForm` (which carries no unit). This escape forks
 * nothing, writes nothing, and labels every event it fires on.
 *
 * SCOPE, deliberately narrow:
 *   - unit `scoop` only (the parser's unit; `scoopful`, `scp`, a trailing
 *     `… 1 scoop` and Spanish `medida` are not parsed as it and stay out);
 *   - OFF records only — the only lane with a measured member; fs_/fdc_ are
 *     unmeasured and would need their own census;
 *   - a human-triage row is trusted (`scoop_liquid` is in
 *     HUMAN_TRUST_SKIPPABLE_ESCAPES): a repoint is identity, and this is an
 *     identity heuristic;
 *   - the record NAME must say drink (DRINK_NAME) on EVERY arm, not only the
 *     density arm. A volume label alone is not a drink: US labels state solid
 *     food in ml ("Chipotle, Fajita Vegetables" 73.9 mL / 55.5 kcal, Breyers
 *     188 ml, Halo Top 118 ml, Panang curry 120 ml, soups, beans). Without the
 *     name gate those rows escape and the cold pick is served instead — and it
 *     can be wrong: `1 scoop chipotle fajita veggies` warm 44 kcal (the
 *     Chipotle record) vs cold 165/183 kcal (a ShopRite veggie burger), 2 of 2
 *     draws (s459 rf-keyn F4/F4b). The name gate keeps all four members and
 *     narrows the OFF FoodMapping footprint from 297 rows to 107, all drinks.
 *
 * IN-FLIGHT LOCK WAITERS: a scoop request that waits on a concurrent request
 * with the same baseName falls through into the same early cache check after
 * the lock (s459 pd-waiter), so this escape covers it too. Pinned by
 * lock-waiter-reenters-main-path.test.ts.
 */

/** Telemetry class for the escape and for the suppressed save. */
export const SCOOP_LIQUID_ESCAPE = 'scoop_liquid';

/** A scoopable product (powder) is never this dilute; RTD shakes sit at 30–100. */
export const LIQUID_MAX_KCAL_PER_100G = 150;

/** Density arm: a drink-sized gram label at drink density (the name gate applies to every arm). */
export const RTD_MIN_LABEL_GRAMS = 250;
export const RTD_MAX_KCAL_PER_100G = 100;

/** A label serving stated in a liquid volume ("1 serving (330 ml)", "12 fl oz", "8 OZA (240 ml)"). */
const VOLUME_LABEL = /\d\s*(?:ml|cl|l|fl\.?\s*oz|fluid\s+ounces?|oza)(?![a-z])/i;

/** A drink container ("1 bottle (414 ml)", "1 CARTON (325 ml)"). `can` is out: canned beans, tuna, soup. */
const DRINK_CONTAINER_LABEL = /(?<![a-z])(?:bottles?|cartons?|bouteilles?|drink\s*box|tetra\s*pak|brik)(?![a-z])/i;

/** A label that itself says scoop is a powder serving, whatever else it says. */
const SCOOP_LABEL = /(?<![a-z])scoops?(?![a-z])/i;

/** A record is a drink candidate only when its name says so ("muscle milk", "Meal replacement shake", "Vanilla Protein"). */
const DRINK_NAME = /(?<![a-z])(?:protein|shakes?|drinks?|milk|smoothies?|beverages?|juice)(?![a-z])/i;

/** True when the parsed unit is the scoop unit (the parser singularizes; fold anyway). */
export function isScoopUnit(unit: string | null | undefined): boolean {
    return typeof unit === 'string' && /^scoops?$/i.test(unit.trim());
}

export interface LiquidRecordFacts {
    name: string | null | undefined;
    servingSize: string | null | undefined;
    servingGrams: number | null | undefined;
    kcalPer100g: number | null | undefined;
}

/**
 * True when a cached OFF record reads as a ready-to-drink liquid. Unknown
 * calories → false (never escape on missing evidence).
 */
export function looksReadyToDrink(rec: LiquidRecordFacts): boolean {
    const kcal = rec.kcalPer100g;
    if (kcal == null || !Number.isFinite(kcal) || kcal >= LIQUID_MAX_KCAL_PER_100G) return false;
    if (!DRINK_NAME.test(rec.name ?? '')) return false;
    const label = rec.servingSize ?? '';
    if (SCOOP_LABEL.test(label)) return false;
    if (VOLUME_LABEL.test(label) || DRINK_CONTAINER_LABEL.test(label)) return true;
    const grams = rec.servingGrams;
    return grams != null && grams >= RTD_MIN_LABEL_GRAMS
        && kcal < RTD_MAX_KCAL_PER_100G;
}

/** The escape predicate both cache layers evaluate. */
export function isScoopOnLiquidRecord(
    unit: string | null | undefined,
    foodId: string,
    rec: LiquidRecordFacts,
): boolean {
    return isScoopUnit(unit) && foodId.startsWith('off_') && looksReadyToDrink(rec);
}

/** True when a site-prefixed read-escape reason ('early:scoop_liquid') is this class. */
export function isScoopLiquidEscape(reason: string): boolean {
    const parts = reason.split(':');
    return (parts.length > 1 ? parts[1] : parts[0]) === SCOOP_LIQUID_ESCAPE;
}
