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
 * ONE OWNER, THREE CALLERS since 2026-08-17 (lane B1a). `buildFatSecretResult()`,
 * `buildOffResult()` and `buildFdcResult()` all resolve the DENSITY RULE here;
 * the inline hand-copies are gone. Do not read the existence of an owner as
 * evidence the callers use it — count them:
 *   grep -rn "volume-density" src/ | grep -v __tests__
 *
 * WHAT THE CALLERS STILL OWN, and why. Each caller keeps its OWN set of unit
 * SPELLINGS and hands it to `pickVolumeUnits()`. That is deliberate: the map a
 * caller builds is the GATE on whether a line enters its volume branch at all
 * (`unit && volumeToGrams[unit]`), so a spelling this module happens to carry
 * would re-route traffic that reaches a different branch today. Spellings are a
 * separate axis from "how many grams is one ml" and are not settled here — with
 * ONE named exception: `LARGE_VOLUME_UNIT_SPELLINGS` below (lane B1b,
 * 2026-08-17) is exported so the three gates admit the litre/pint/quart/gallon
 * family in lockstep; each gate still spreads it into its own list.
 *
 * A caveat on FDC, first measured 2026-08-02 and re-measured 2026-08-17, worth
 * carrying because it is the opposite of what the code reads like: FDC's density
 * fallback has NEVER billed a live query. Of 8,200 `volume_unit` events, ZERO
 * have an FDC winner — all 8,200 are `openfoodfacts`, because
 * `findOwnFdcVolumeServing()` and `insertFdcAiServing()` absorb every FDC volume
 * request ahead of it (`fdc_label_volume` 2,134, `fdc_volume_cached` 632,
 * `fdc_volume_ai` 318, density fallback 0). So converging FDC was a near-free
 * deletion of a latent landmine, not a repair of live billing; the live
 * population is entirely OFF's. Re-derive:
 *   SELECT "servingTier", count(*) FROM "MappingEventLog"
 *   WHERE "servingTier" LIKE '%volume%' GROUP BY 1;
 *   SELECT "source",      count(*) FROM "MappingEventLog"
 *   WHERE "servingTier" = 'volume_unit' GROUP BY 1;
 *
 * Note also that OFF and FDC both stamp the SAME tier string `volume_unit`, so
 * the event log cannot attribute a wrong gram bill to a lane. That is how the
 * FDC copy stayed divergent unseen. It is now attributable a different way — the
 * FDC branch reaches that tier only when both rungs above it declined, and the
 * lane is readable off `source` — so splitting the tier string was NOT bundled
 * with the convergence; it would move a classification set every instrument
 * keys on.
 *
 * Re-derive the divergence:
 *   grep -rn "isPaste" src/            # 1 file: this one
 *
 * NOT A DENSITY MODEL. Any change to the NUMBERS is a separate PR with its own
 * winner-gate run, because grams feed the save gates and the cached row.
 *
 * PROVENANCE, corrected 2026-08-02 — an earlier version of this header claimed
 * the constants were "the OFF path's constants verbatim". That is FALSE for
 * `ml`, `floz` and `fl oz`. `cup`/`tbsp`/`tsp` came from OFF; `ml`/`floz` came
 * from FDC, which is what `buildFatSecretResult()` already did before the move,
 * so nothing regressed — but the header was asserting agreement that does not
 * exist.
 *
 * THE ml/floz DISAGREEMENT IS STILL OPEN, and `buildOffResult()` still pins its
 * own flat `ml: 1` / `floz: 30` rather than this module's scaled values. B1a
 * measured the OFF↔owner delta cell-for-cell over 12 foods x 23 unit keys: every
 * cup/tbsp/tsp/dash/pinch cell agrees for every volume class, and `ml`/`floz`/
 * `fl oz` are the ONLY family that differs — for volume-class SOLIDS only, where
 * this module scales by `solidDensity` and OFF does not. So converging it is a
 * CONSTANT change, not a de-duplication, and it is not free in either direction:
 *   - this module is right about `240 ml flour`, which OFF bills at 240 g while
 *     billing the same volume as `1 cup flour` at 127.2 g — 1.89x apart, from a
 *     density it computed one line earlier;
 *   - and wrong about `250 ml red bull`, because the classifier missed cola,
 *     beer, coffee and energy drinks, so a water-density beverage classified
 *     SOLID and would bill 125 g instead of 250 g. Those 2 events are the ONLY
 *     ml/floz traffic in the entire live `volume_unit` population (8,200 events:
 *     cup 5,533, tbsp 2,059, tsp 606, ml 2, floz 0 — measured 2026-08-17 by
 *     bucketing `rawLine`; re-derive with the query in that report).
 * The fix belongs on the CLASSIFICATION side, not the scaling side, and it got
 * its own commit: `BEVERAGE_RE` below (lane B1b). That does NOT close the ml/floz
 * convergence — the classifier now reaches a drink NAMED as one, and the literal
 * string `Red Bull` carries no such token, so the pin in
 * `mapping/__tests__/volume-density-convergence.test.ts` is still live.
 *
 * Re-derive the cell-level diff by executing both tables over the same inputs:
 *   `resolveVolumeGrams()` vs the pinned literals in `buildOffResult()`.
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
    // Large volume units, added 2026-08-17 (lane B1b). Same millilitres as
    // `VOLUME_IN_ML` in `src/lib/parse/unit.ts`. `normalizeUnitToken()` emits
    // the SHORT forms (`l`, `pint`, `quart`, `gallon`); the long forms reach
    // `parsed.unit` only through the AI-parse arm (raw model string) and
    // `litre(s)`, which the tokenizer does not know, arrives raw via the
    // partitive-"of" path ("1 litre of milk"). Every spelling is a key here so
    // both arms resolve to the same number.
    'l': 1000, 'liter': 1000, 'liters': 1000, 'litre': 1000, 'litres': 1000,
    'pint': 473.176, 'pints': 473.176,
    'quart': 946.353, 'quarts': 946.353,
    'gallon': 3785.41, 'gallons': 3785.41,
};

/**
 * The spellings lane B1b (2026-08-17) admitted to every volume branch at once —
 * `buildOffResult()`, `buildFdcResult()` (both via their `*_VOLUME_UNIT_SPELLINGS`
 * gates in `mapping/serving/hydration-lane.ts`) and `buildFatSecretResult()`
 * (which gates on `VOLUME_UNIT_ML` directly). Exported so the three gates cannot
 * drift on this family; each gate still spreads it into its OWN list, so the
 * per-caller ownership of spellings described in the header stands.
 *
 * Why these and only these: `normalizeUnitToken()` emits `l`/`pint`/`quart`/
 * `gallon`, and before this every one of them fell past every branch to a flat
 * 100 g — `1 gallon of milk` billed 100 g live (38x under; measured 2026-08-17).
 * `serving`/`portion`/`mg`/`kilograms`/`milliliter(s)` are deliberately NOT here:
 * the first two need a per-lane answer (OFF routes them through
 * PACKAGE_LIKE_UNITS, FDC does not) and the rest are a separate decision.
 */
export const LARGE_VOLUME_UNIT_SPELLINGS: readonly string[] = [
    'l', 'liter', 'liters', 'litre', 'litres',
    'pint', 'pints',
    'quart', 'quarts',
    'gallon', 'gallons',
];

/** Foods that pour. ~1 g/ml. */
const LIQUID_RE = /broth|stock|water|juice|milk|sauce|vinegar|oil|syrup/i;

/**
 * DRINKABLE BEVERAGES — the second half of "foods that pour", added 2026-08-17
 * (lane B1b) because `LIQUID_RE` above names nine tokens and none of them is a
 * drink anyone orders.
 *
 * THE MEASUREMENT. Classify the 314 seeds the coverage corpus itself labels
 * `sodas-energy` / `coffee-tea` / `alcohol` and `LIQUID_RE` calls 32 of them
 * liquid — 10.2% recall, so 89.5% of drinkable foods were billed at the
 * dry-goods 0.5 g/ml and `1 cup coffee` came to 120 g. This vocabulary takes
 * that to 153 of 314 (48.7%). Measured 2026-08-17; re-derive by running
 * `resolveVolumeGrams()` over column 3 of
 * `scripts/eval/coverage-corpus-2026-08-08.tsv`, grouped by column 1.
 *
 * WHY IT IS A SECOND REGEX AND NOT MORE TOKENS IN THE FIRST. `LIQUID_RE`
 * matches unanchored substrings, which is why `water` classifies WATERMELON and
 * `oil` classifies BOILED anything. Adding `\b` to those tokens is a behaviour
 * change in the opposite direction on live `cup` traffic, so it is not bundled
 * here. Keeping the new vocabulary separate — and checking it LAST, after both
 * existing tiers — is what makes this change provably one-directional: a name
 * that is `liquid` or `paste` today keeps its class and its grams, and the only
 * transition this commit can produce is `solid` -> `beverage`.
 *
 * NOT A DENSITY CHANGE. `beverage` bills the LIQUID numbers, cell for cell; the
 * separate class name exists so the two populations stay independently
 * countable (same reason `bare_name_sibling_serving_tight` is its own tier), not
 * because it is worth a different g/ml. The module header's rule stands: moving
 * a NUMBER is a separate PR.
 *
 * PRECISION, measured over the other 3,788 corpus seeds. 100 of them change
 * class. 97 are unambiguously drinkable (coffee, tea, soda, wine, kombucha,
 * protein shakes, kefir); the other three are `agave nectar`, `beer cheese dip`
 * and `root beer float`, which are not drinks but ARE ~1 g/ml, so the move is
 * right in direction and wrong in kind — recorded rather than excluded, because
 * a guard for them would cost more precision elsewhere than it buys. ZERO of the
 * 3,788 move in the wrong direction. The shapes below are the ones that had to
 * be excluded by hand; they are pinned in
 * `__tests__/beverage-classification.test.ts`:
 *   - `shake` is two chain names before it is a drink ("Shake Shack Crinkle Cut
 *     Fries", "Steak n Shake Chili"), so it is admitted only in the three
 *     compound forms or at the END of a name. Tail-anchoring is used HERE and
 *     nowhere else: as a general head-noun rule it is refuted — that is warm
 *     screen rule D3, which flags branded grocery on its flavour word.
 *   - distilled spirits are absent outright. They name solids as flavour words
 *     ("Bourbon Street Chicken", "Penne Vodka", "Whiskey River BBQ Burger"), and
 *     at ~0.94 g/ml a 40% ABV spirit is not the 1.0 class anyway. Fermented
 *     drinks (beer/wine/cider/sake, ~0.99) are in.
 *   - `soda` excludes `baking soda`. Note the exclusion COSTS accuracy and is
 *     kept anyway: baking soda is ~0.92 g/ml, so calling it a drink would have
 *     billed it better than the 0.5 it keeps. Do not "fix" this back.
 *   - `cocoa` is admitted only as `hot cocoa`; cocoa POWDER is a 0.55 g/ml dry
 *     solid that the category override already handles.
 *
 * WHAT IT STILL MISSES, and no vocabulary can reach: brand-only names. 161 of
 * the 314 drink seeds stay solid and they are almost all brands — `bud light`,
 * `heineken`, `mountain dew`, `white claw`, `celsius`, `cabernet sauvignon`.
 * Note this module classifies the MATCHED RECORD's name, not the query, and OFF
 * record names are fuller than corpus seeds ("Energy Drink", "Pale Ale"), so
 * 48.7% is a floor on seeds rather than an estimate on records [reasoning, not
 * measured — it needs the live index]. The mechanism that would reach brands is
 * not a longer list: `OffFood.packageQuantityUnit == 'ml'` says the SKU is sold
 * by volume, which is a data-side answer to the same question. It is not built
 * here because it needs a signature that carries hydrate data into this module
 * and FDC/FatSecret have no equivalent field. Re-derive its reach first:
 *   SELECT count(*) FILTER (WHERE "packageQuantityUnit" = 'ml'), count(*)
 *   FROM "OffFood" WHERE "packageQuantity" IS NOT NULL;
 */
const BEVERAGE_RE = new RegExp([
    // Coffee bar.
    '\\b(?:coffees?|espressos?|lattes?|cappuccinos?|americanos?|macchiatos?',
    '|mochas?|cortados?|frappuccinos?|frappes?|brew)\\b',
    // Tea bar.
    '|\\b(?:teas?|chai|kombucha|yerba mate)\\b',
    // Soft drinks and mixers.
    '|\\b(?:colas?|lemonades?|limeades?|seltzers?|tonic|nectar)\\b',
    '|(?<!baking )\\bsodas?\\b',
    // Drinkable by name.
    '|\\b(?:drinks?|beverages?|smoothies?|horchata|lassi|kefir|eggnog)\\b',
    '|\\bhot (?:chocolate|cocoa)\\b',
    '|\\b(?:protein|meal replacement|milk) ?shakes?\\b|\\bshakes?$',
    // Fermented alcohol only — see PRECISION above.
    '|\\b(?:beers?|ales?|lagers?|pilsners?|stouts?|ciders?|wines?',
    '|champagne|prosecco|sake)\\b',
].join(''), 'i');

/**
 * Dense pastes and spreads, ~1 g/ml rather than the dry-goods default.
 * Verbatim from the OFF path — this is the list that made `2 tbsp peanut
 * butter` bill ~32 g instead of 15 g.
 */
const PASTE_RE =
    /butter|spread|hummus|yogurt|yoghurt|honey|mayo|mayonnaise|jam|jelly|nutella|tahini|cream cheese|sour cream|ricotta|paste|dressing|ketchup|mustard/i;

/**
 * `beverage` bills exactly what `liquid` bills — see BEVERAGE_RE. It is a
 * separate member so the two vocabularies stay independently countable, not
 * because it is worth a different g/ml.
 */
export type VolumeClass = 'liquid' | 'beverage' | 'paste' | 'solid';

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
    // Checked LAST, so this tier can only ever claim a name that would otherwise
    // be a `solid`. That ordering is the whole blast-radius argument for B1b —
    // see BEVERAGE_RE. `Port Wine Cheese Spread` is the case it protects: it
    // carries a beverage token and is a spread.
    const isBeverage = !isLiquid && !isPaste && BEVERAGE_RE.test(name);
    /** Pours at ~1 g/ml, by either vocabulary. */
    const isPourable = isLiquid || isBeverage;

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

    const cupG = isPourable ? 240 : isPaste ? 250 : 240 * solidDensity;
    const tbspG = isPourable ? 15 : isPaste ? 16 : 15 * solidDensity;
    const tspG = isPourable ? 5 : isPaste ? 5.3 : 5 * solidDensity;
    const mlG = isPourable ? 1 : isPaste ? 1 : solidDensity;
    const flozG = isPourable ? 30 : isPaste ? 30 : 30 * solidDensity;

    return {
        perUnit: {
            'cup': cupG, 'cups': cupG,
            'tbsp': tbspG, 'tablespoon': tbspG, 'tablespoons': tbspG,
            'tsp': tspG, 'teaspoon': tspG, 'teaspoons': tspG,
            'ml': mlG, 'milliliter': mlG, 'milliliters': mlG,
            'floz': flozG, 'fl oz': flozG,
            // Large volume units (lane B1b): the ml cell scaled by the unit's
            // millilitres, so each class bills them the way it bills `ml` and
            // `floz` — liquid 1 g/ml, paste 1 g/ml, solid at `solidDensity`.
            // (`cup`/`tbsp`/`tsp` carry a paste cell ~4% above 1 g/ml; the
            // absolute-volume family here follows `ml`, not that.) The
            // millilitres are read off `VOLUME_UNIT_ML` so the number lives once.
            'l': VOLUME_UNIT_ML['l'] * mlG,
            'liter': VOLUME_UNIT_ML['liter'] * mlG, 'liters': VOLUME_UNIT_ML['liters'] * mlG,
            'litre': VOLUME_UNIT_ML['litre'] * mlG, 'litres': VOLUME_UNIT_ML['litres'] * mlG,
            'pint': VOLUME_UNIT_ML['pint'] * mlG, 'pints': VOLUME_UNIT_ML['pints'] * mlG,
            'quart': VOLUME_UNIT_ML['quart'] * mlG, 'quarts': VOLUME_UNIT_ML['quarts'] * mlG,
            'gallon': VOLUME_UNIT_ML['gallon'] * mlG, 'gallons': VOLUME_UNIT_ML['gallons'] * mlG,
            // Micro-volume spice measures: absolute, not density-scaled. A pinch
            // of anything is a pinch.
            'dash': 0.6, 'dashes': 0.6,
            'pinch': 0.3, 'pinches': 0.3,
        },
        volumeClass: isLiquid ? 'liquid' : isBeverage ? 'beverage' : isPaste ? 'paste' : 'solid',
        solidDensity,
    };
}

/**
 * This module's per-unit grams, restricted to the spellings ONE caller accepts.
 *
 * Key sets stay per-caller on purpose and are NOT part of the rule this module
 * owns — see §"WHAT THE CALLERS STILL OWN" in the header. Callers merge their
 * own extra units (FDC's spray/drop micro-measures) over the result.
 *
 * A spelling this module carries no value for is DROPPED rather than written as
 * `undefined`, because every caller gates its branch on `map[unit]` being
 * truthy and an explicit `undefined` would read as absent anyway — dropping it
 * keeps `Object.keys()` an honest statement of what the caller accepts.
 */
export function pickVolumeUnits(
    perUnit: Record<string, number>,
    accepted: readonly string[],
): Record<string, number> {
    const picked: Record<string, number> = {};
    for (const spelling of accepted) {
        const grams = perUnit[spelling];
        if (grams != null) picked[spelling] = grams;
    }
    return picked;
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
