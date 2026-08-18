/**
 * FatSecret result builder (fatsecret retrieval lane, Phase 1 — Jul 2026).
 *
 * Hydrates a `fs_<food_id>` candidate from the local FatSecretFood /
 * FatSecretServing store (persisted at retrieval time by the lane in
 * gather-candidates) and resolves grams + macros for the parsed request.
 * Same signature/return contract as buildOffResult / buildFdcResult in
 * map-ingredient-with-fallback.ts, but deliberately FOCUSED: fs servings are
 * clean household measures ("1 bar", "1 cup") with per-serving macros, so
 * none of the OFF label-placeholder / sibling-median / package-quantity
 * machinery is needed here.
 *
 * Gram-resolution priority:
 *   (a) explicit weight unit  → direct conversion       ('fs_weight_direct')
 *   (b) volume unit           → serving volumeMl match  ('fs_label_volume'),
 *       else the record's own declared serving when its
 *       description names the unit           ('fs_label_volume_declared'),
 *       else category-density fallback                  ('fs_volume_density')
 *   (c) count/serving request → noun-matched serving    ('fs_label_count'),
 *       else default serving                            ('fs_default_serving')
 *   (d) nothing usable        → per-100g × qty          ('fs_per100g_fallback')
 * Bare unitless qty-1 requests get the same bare-query-guard CAP/REPLACE
 * parity as buildOffResult (see the guard wire-in below), and the same
 * per-piece suppression: a bare PLURAL ("almonds") never resolves to one
 * piece, and a bare SINGULAR never bills a sub-20g piece. Both rules come from
 * `src/lib/servings/bare-query-guard.ts` — the ONE owner — because the two
 * previous copies of this cascade's rules diverged silently.
 */

import { prisma } from '../db';
import { logger } from '../logger';
import { FATSECRET_REFRESH_DAYS } from './config';
import {
    singularizeUnit, inferDiscreteUnit, extractLabelServingUnit,
    servingLabelCountsPiece, labelLeadingCount, labelPieceMatchesItem,
} from './count-label';
import {
    num,
    servingMacros,
    estimateServingGrams,
    type Macros,
} from './fs-serving-macros';
import { FS_SERVING_MACROS_ONLY_EST_TIER } from './serving-ai-tiers';
import {
    applyOffBareQueryGuard, isBarePluralRequest, isBareUnitlessQty1,
    usableBareLabelServing, BARE_MIN_PIECE_SERVING_GRAMS, BARE_LABEL_MIN_GRAMS,
} from '../servings/bare-query-guard';
import { volumeToGrams, VOLUME_UNIT_ML } from '../units/volume-density';
// Ambiguous/count-unit resolution, shared with the OFF and FDC cascades. Safe
// to import here: `ambiguous-unit-backfill` pulls only `db` and `logger`, so
// there is no cycle back through map-ingredient-with-fallback.
import { isAmbiguousUnit, getOrCreateAmbiguousServing } from './ambiguous-unit-backfill';
import { classifyUnit } from './unit-type';
// Leading-quantity parsing for serving labels ("1/2 cup" -> 0.5, "1 1/4 cups"
// -> 1.25). The ONE owner of that grammar; it has no imports of its own, so
// there is no cycle risk here. Deliberately NOT a local copy: 40.1% of the
// labels this module now reads lead with a fraction (measured below), and a
// second parser is exactly how this cascade's rules diverged before.
import { parseQuantityTokens } from '../parse/quantity';
import type { ParsedIngredient } from '../parse/ingredient-line';
import type { UnifiedCandidate } from './gather-candidates';
import type { FatsecretMappedIngredient } from './map-ingredient-with-fallback';

// ============================================================
// Local copies of unexported map-ingredient-with-fallback helpers.
// map-ingredient-with-fallback imports THIS module (hydrateAndSelectServing
// branch), so a value import back into it would create an import cycle —
// requestBillsByServing / EXPLICIT_MEASURE_UNIT_RE are unexported there
// anyway. Keep the regex byte-identical to the mapper's copy.
// ============================================================
const EXPLICIT_MEASURE_UNIT_RE = /^(g|gram|grams|oz|ounce|ounces|lb|lbs|pound|pounds|kg|kilogram|kilograms|cup|cups|tbsp|tablespoon|tablespoons|tsp|teaspoon|teaspoons|ml|milliliter|milliliters|l|liter|liters|floz|fl\s*oz|fluid\s*ounces?|pint|pints|quart|quarts|gallon|gallons)$/i;
function requestBillsByServing(parsed: ParsedIngredient | null): boolean {
    return !(parsed?.unit && EXPLICIT_MEASURE_UNIT_RE.test(parsed.unit.trim()));
}

/**
 * A serving row that literally calls itself one serving ("1 serving (85 g)",
 * "1 serving, cooked"). Deliberately anchored and count-1: "2 servings" is a
 * multiple and "1 serving size" style prose is not what FatSecret emits. 3,565
 * such rows exist on the box, 3,422 of them inside the 3-400g bare band
 * (measured 2026-08-02). Read by the default-serving fallback below, where it
 * replaces a positional pick — see the reasoning there.
 */
const EXPLICIT_ONE_SERVING_RE = /^\s*1\s+serving\b/i;

const WEIGHT_TO_GRAMS: Record<string, number> = {
    'g': 1, 'gram': 1, 'grams': 1,
    'oz': 28.35, 'ounce': 28.35, 'ounces': 28.35,
    'lb': 453.6, 'lbs': 453.6, 'pound': 453.6, 'pounds': 453.6,
    'kg': 1000, 'kilogram': 1000,
};

// The volume-unit table this builder gates its volume branch on is the OWNER's
// `VOLUME_UNIT_ML` (imported above). Until 2026-08-17 (lane B1b) this module
// carried a private copy that was key-for-key and value-for-value identical to
// the owner's export — pinned as such in
// `__tests__/volume-unit-spellings.test.ts` — so converging it changed nothing
// for the thirteen spellings it had, and admitted the large units (`l`, `pint`,
// `quart`, `gallon` and their long forms) that the owner grew in the same lane.

/** Serving-description stems for matching a requested volume unit ("1 cup" for "cup"). */
const VOLUME_UNIT_STEMS: Record<string, string[]> = {
    'cup': ['cup'], 'cups': ['cup'],
    'tbsp': ['tbsp', 'tablespoon'], 'tablespoon': ['tbsp', 'tablespoon'], 'tablespoons': ['tbsp', 'tablespoon'],
    'tsp': ['tsp', 'teaspoon'], 'teaspoon': ['tsp', 'teaspoon'], 'teaspoons': ['tsp', 'teaspoon'],
    'floz': ['fl oz', 'fluid ounce'], 'fl oz': ['fl oz', 'fluid ounce'],
    'ml': ['ml', 'milliliter'], 'milliliter': ['ml', 'milliliter'], 'milliliters': ['ml', 'milliliter'],
    // Lane B1b: the large units, so a FatSecret "1 pint" / "1 quart" row can
    // anchor the request the way a "1 cup" row does.
    'l': ['liter', 'litre'], 'liter': ['liter', 'litre'], 'liters': ['liter', 'litre'],
    'litre': ['liter', 'litre'], 'litres': ['liter', 'litre'],
    'pint': ['pint'], 'pints': ['pint'],
    'quart': ['quart'], 'quarts': ['quart'],
    'gallon': ['gallon'], 'gallons': ['gallon'],
};

// ============================================================
// Normalized serving view (DB row or candidate fallback)
// ============================================================

interface FsServingView {
    /** FatSecret serving_id when hydrated from DB; null on the candidate fallback. */
    servingId: string | null;
    description: string;
    measurementDescription: string | null;
    grams: number | null;
    volumeMl: number | null;
    numberOfUnits: number | null;
    /** Per-serving macros Json when hydrated from DB. */
    nutrients: Record<string, unknown> | null;
}

// `Macros`, `num` and `servingMacros` moved VERBATIM to ./fs-serving-macros.ts
// (2026-07-27) so the correctness screen reads serving-level nutrition through
// the exact function this lane bills from, instead of re-implementing it.
//
// `PREPARED_FOOD_KCAL_PER_GRAM` and `estimateServingGrams` moved there too
// (2026-08-14), verbatim and for the identical reason: `/api/foods/search`'s
// local lane now recovers the same macro-only servings this branch bills, and a
// second copy of the estimator would let the two lanes report different weights
// for the same record. Imported at the top of this file.

/**
 * Recover a serving's TRUE gram weight by inverting the record's own per-100g
 * panel — preferred over the energy-density estimate above whenever a panel
 * exists.
 *
 * FatSecret derives that panel FROM the serving (`serving / grams x 100`), so
 * the division is reversible: `100 x serving_nutrient / panel_nutrient` returns
 * the very grams that produced it. This is arithmetic, not estimation.
 * Validated on the box against the 24,579 servings whose true weight IS
 * recorded — median ratio 1.000 (p10 0.995 / p90 1.005), 98.1% within 5%.
 *
 * Why the MEDIAN across nutrients rather than calories alone: the panel is
 * rounded, and relative quantization error grows as the value shrinks, so a
 * brewed coffee's `1 kcal/100g` panel is already +-50% before anything else
 * goes wrong. Share landing within 10% of the true weight, by panel density:
 *
 *   panel kcal/100g    calories only    median-of-nutrients
 *   <=5  (drinks)          68.8%              91.1%
 *   6-20                   92.9%              99.0%
 *   >20  (solids)          99.7%              99.9%
 *
 * Only nutrients positive on BOTH sides vote. A serving fat rounded down to 0
 * against a positive panel fat would otherwise contribute a 0g estimate and
 * drag the median toward zero — the same rounding that motivates the median.
 */
function gramsFromPer100gPanel(serving: Macros, per100: Macros): number | null {
    const votes: number[] = [];
    for (const [sv, p100] of [
        [serving.kcal, per100.kcal],
        [serving.protein, per100.protein],
        [serving.carbs, per100.carbs],
        [serving.fat, per100.fat],
    ] as const) {
        if (sv > 0 && p100 > 0) votes.push((100 * sv) / p100);
    }
    if (votes.length === 0) return null;
    votes.sort((a, b) => a - b);
    const mid = votes.length >> 1;
    const median = votes.length % 2 === 1
        ? votes[mid]
        : (votes[mid - 1] + votes[mid]) / 2;
    return Number.isFinite(median) && median > 0 ? median : null;
}

/** True when a per-100g panel carries any nutrient the weight can be recovered from. */
function per100gCarriesWeightSignal(per100: Macros | null): boolean {
    return per100 != null
        && (per100.kcal > 0 || per100.protein > 0 || per100.carbs > 0 || per100.fat > 0);
}

/** Per-100g macros from FatSecretFood.nutrientsPer100g (or candidate.nutrition). */
function per100gMacros(source: Record<string, unknown> | null | undefined): Macros | null {
    if (!source) return null;
    const kcal = num(source['kcal'] ?? source['calories']);
    if (kcal == null) return null;
    return {
        kcal,
        protein: num(source['protein']) ?? 0,
        carbs: num(source['carbs'] ?? source['carbohydrate']) ?? 0,
        fat: num(source['fat']) ?? 0,
    };
}

/** True when any token of the serving's description(s) singularizes to the noun. */
function servingMatchesNoun(s: FsServingView, noun: string): boolean {
    const text = `${s.description ?? ''} ${s.measurementDescription ?? ''}`.toLowerCase();
    return text.split(/[^a-z]+/).some(tok => tok !== '' && singularizeUnit(tok) === noun);
}

/** True when the serving's description names the requested volume unit. */
function textMatchesVolumeUnit(text: string, unit: string): boolean {
    const stems = VOLUME_UNIT_STEMS[unit];
    if (!stems) return false;
    return stems.some(stem => new RegExp(`\\b${stem.replace(' ', '\\s+')}s?\\b`, 'i').test(text));
}

function servingMatchesVolumeUnit(s: FsServingView, unit: string): boolean {
    return textMatchesVolumeUnit(`${s.description ?? ''} ${s.measurementDescription ?? ''}`, unit);
}

/**
 * Grams for ONE of the requested volume unit, read off a serving that NAMES
 * that unit in its own description but carries no `volumeMl`.
 *
 * Why this exists: the density path above filters on `volumeMl != null` BEFORE
 * any description is consulted, so a label that states the answer outright is
 * structurally unreachable. That is not a rare shape — 7,768 FatSecretServing
 * rows carry grams and a volume-named description with NULL volumeMl, against
 * 2,478 rows the density path can see at all (measured 2026-08-03, box; see the
 * call site for the re-derive). `fs_4501` "White Rice" is the worked example:
 * its servings are `1 cup cooked` = 158 g and `1 cup, dry, yields` = 570 g, both
 * volumeMl NULL, so `1 cup white rice` fell to the category density fallback and
 * billed 240 ml x 0.5 = 120 g.
 *
 * Three things this rule is careful about, each measured over the 3,677
 * cup-named default servings on the box (2026-08-03):
 *
 *  1. THE LEADING QUANTITY IS USUALLY NOT 1. 1,474 of them (40.1%) lead with a
 *     fraction ("1/2 cup" x519, "1/4 cup" x382, "2/3 cup" x239) and 91 more are
 *     mixed numbers ("1 1/4 cups"). Reading those as one unit would under-bill a
 *     full cup by 2-4x, so the label's own quantity is divided out. Note that
 *     `labelLeadingCount()` in count-label.ts CANNOT be reused for this: it is
 *     integer-only and returns null below 2, i.e. null for every shape above.
 *  2. A YIELD IS NOT A PORTION. "1 cup, dry, yields" states what a cup of the
 *     dry product becomes after cooking (570 g for rice), not what a cup weighs
 *     — billing it would be ~3x wrong. Only 5 of the 3,677 defaults say "yield",
 *     but they are the worst-wrong rows in the set, so they are refused. Plain
 *     "dry" is NOT refused: those 77 rows are ordinary fractional portions
 *     ("1/4 cup dry" = 43 g) and are a correct answer to a volume request.
 *  3. IT READS THE DESCRIPTION ONLY, not `measurementDescription`. The
 *     population above was measured on `description`, and the quantity is parsed
 *     from that same string — gating on a field the measurement never covered
 *     would be a claim about rows nobody counted.
 */
function declaredVolumeUnitGrams(s: FsServingView, unit: string): number | null {
    if (s.grams == null || s.grams <= 0) return null;
    const description = s.description ?? '';
    if (!textMatchesVolumeUnit(description, unit)) return null;
    if (/yield/i.test(description)) return null;
    const parsedQty = parseQuantityTokens(description.trim().split(/\s+/));
    // No leading quantity means the label is not self-describing ("cup, chopped"
    // with no count); 4 of 3,677 are that shape. Refuse rather than assume 1.
    if (!parsedQty || !(parsedQty.qty > 0)) return null;
    return s.grams / parsedQty.qty;
}

// ============================================================
// Builder
// ============================================================

export async function buildFatSecretResult(
    candidate: UnifiedCandidate,
    parsed: ParsedIngredient | null,
    confidence: number,
    rawLine: string
): Promise<FatsecretMappedIngredient | null> {
    const fsId = candidate.id.replace(/^fs_/, '');

    // 1. Hydrate from the local store (persisted at retrieval time by the lane).
    const row = await prisma.fatSecretFood.findUnique({
        where: { fsId },
        // ORDER IS LOAD-BEARING and was unspecified. The default-serving branch
        // falls back to `usableServings[0]` — a POSITIONAL pick — whenever
        // `defaultServingId` does not resolve, and it very often does not:
        // 598 FatSecretFood rows declare a flat-100g panel row as their default
        // (measured 2026-08-02, box), and `isPer100gPanelServing()` demotes
        // exactly that row out of `usableServings`. For all 598 the billed grams
        // were therefore decided by Postgres row order, which no query pins.
        //
        // `servingId` is the stable natural key. This asserts reproducibility
        // only — it makes no claim that the first serving is the RIGHT one.
        // Re-derive the population:
        //   SELECT count(*) FROM "FatSecretFood" f
        //   JOIN "FatSecretServing" s ON s."fsId"=f."fsId"
        //    AND s."servingId"=f."defaultServingId"
        //   WHERE s.description ~* '^\s*100\s*g';
        include: { servings: { orderBy: { servingId: 'asc' } } },
    }).catch((err: Error) => {
        logger.warn('fs.build_result.hydrate_failed', {
            foodId: candidate.id,
            error: err.message,
        });
        return null;
    });

    // TODO(fs-refresh): when row.fetchedAt is older than FATSECRET_REFRESH_DAYS,
    // a background fail-open refresh from foods.get should re-persist the row
    // (spec §4). Deliberately NOT implemented in this PR — we only log, and the
    // stale row still serves (local data beats an extra external call).
    if (row && Date.now() - row.fetchedAt.getTime() > FATSECRET_REFRESH_DAYS * 86_400_000) {
        logger.debug('fs.build_result.stale_row', {
            foodId: candidate.id,
            fetchedAt: row.fetchedAt.toISOString(),
            refreshDays: FATSECRET_REFRESH_DAYS,
        });
    }

    // 2. Normalize servings: DB rows preferred; else candidate rawData/servings
    // (the lane's inline search payload) so a not-yet-persisted hit still bills.
    let servings: FsServingView[];
    if (row?.servings?.length) {
        servings = row.servings.map(s => ({
            servingId: s.servingId,
            description: s.description,
            measurementDescription: s.measurementDescription,
            grams: num(s.grams),
            volumeMl: num(s.volumeMl),
            numberOfUnits: num(s.numberOfUnits),
            nutrients: (s.nutrients && typeof s.nutrients === 'object')
                ? s.nutrients as Record<string, unknown> : null,
        }));
    } else {
        // Prefer candidate.servings: the lane normalizes those to
        // {description, grams}. rawData.servings are the RAW API servings
        // (metricServingAmount, no grams field) — last-resort only.
        const rawServings = (candidate.rawData as { servings?: unknown } | undefined)?.servings;
        const fallback = candidate.servings?.length
            ? candidate.servings
            : Array.isArray(rawServings) ? rawServings : [];
        servings = (fallback as unknown as Array<Record<string, unknown>>)
            .filter(s => s && typeof s['description'] === 'string')
            .map(s => ({
                servingId: typeof s['servingId'] === 'string' ? s['servingId'] as string : null,
                description: s['description'] as string,
                measurementDescription: typeof s['measurementDescription'] === 'string'
                    ? s['measurementDescription'] as string : null,
                grams: num(s['grams']),
                volumeMl: num(s['volumeMl']),
                numberOfUnits: num(s['numberOfUnits']),
                nutrients: (s['nutrients'] && typeof s['nutrients'] === 'object')
                    ? s['nutrients'] as Record<string, unknown> : null,
            }));
    }

    const per100 = per100gMacros(
        (row?.nutrientsPer100g && typeof row.nutrientsPer100g === 'object'
            ? row.nutrientsPer100g as Record<string, unknown> : null)
        ?? (candidate.nutrition?.per100g
            ? candidate.nutrition as unknown as Record<string, unknown> : null)
    );

    // A literal "100 g" serving is a PER-100G PANEL, not a portion anyone eats
    // (funnel fix 5). FatSecret ships many chain-restaurant records with exactly
    // two servings: a synthetic `100 g` row and the real `1 serving` row that
    // carries the item's macros but no gram weight. Because only the former has
    // grams, it was the only "usable" one — so `grams` was never null, the
    // macro-only branch below never ran, and every such item billed 100g
    // regardless of what it was. That is the flat-100g class the first funnel
    // read found: `starbucks flat white`, `dunkin matcha latte`,
    // `starbucks pike place roast` all landed at exactly 100g.
    //
    // Excluding it lets the real serving reach the macro-only branch, which
    // bills that serving's authoritative macros. The row is still available to
    // `per100`/gram-anchored requests — a user asking for "100g of X" is served
    // by the explicit-weight path, which does not read this list.
    const isPer100gPanelServing = (s: { description: string; grams: number | null; numberOfUnits: number | null }) =>
        s.grams === 100
        && (s.numberOfUnits == null || s.numberOfUnits === 100)
        && /^\s*100\s*g(?:rams?)?\s*$/i.test(s.description);

    // ...but only demote it when its per-100g can actually recover the serving
    // weight. For a genuinely zero-calorie drink — Diet Coke, sparkling water,
    // unsweetened tea, 50 such records on the box — every panel nutrient is 0,
    // so there is nothing to invert and dropping the row would trade a 100g
    // display for a 1g one showing the same, correct, 0 kcal. Leave those
    // exactly as they are rather than regress the portion to buy nothing.
    const panelIsInvertible = per100gCarriesWeightSignal(per100);

    const usableServings = servings.filter(s =>
        s.grams != null && s.grams > 0 && !(panelIsInvertible && isPer100gPanelServing(s)));
    // A serving may carry per-serving macros WITHOUT any gram weight —
    // FatSecret's generic "1 serving" restaurant records are exactly this shape
    // (e.g. Impossible Whopper: "1 serving" = 630 kcal / 28p / 62c / 32f, grams
    // null, per100g {}). Those are still billable serving-by-serving via the
    // macro-only branch in the count/serving cascade below, so keep the
    // candidate alive whenever ANY serving has macros — not only the
    // gram-anchored ones. Dropping here was discarding exact-match FS winners
    // and fabricating an AI estimate in their place.
    const anyServingHasMacros = servings.some(s => servingMacros(s.nutrients) != null);
    if (!per100 && !anyServingHasMacros) {
        // No per-100g nutrition and no per-serving macros anywhere — nothing
        // this builder could bill. (Distinct from "no servings": per-100g alone
        // still supports the fallback path below.)
        logger.warn('fs.build_result.no_nutrition', { foodId: candidate.id });
        return null;
    }

    const foodName = row?.name ?? candidate.name;
    const brandName = row?.brandName ?? candidate.brandName ?? null;
    const qty = parsed ? parsed.qty * parsed.multiplier : 1;
    const unit = parsed?.unit?.toLowerCase().trim();

    // INSTRUMENT, NOT A FIX — and deliberately so.
    //
    // `EXPLICIT_MEASURE_UNIT_RE` is a promise that a unit bills deterministically
    // from grams or millilitres; `requestBillsByServing()` skips the entire
    // count/serving branch on the strength of it. Until 2026-08-17 `pint`,
    // `quart`, `gallon` and `l` were in that regex and in NEITHER table below,
    // so they fell past everything to the flat per-100g tier: `1 pint ice cream`
    // billed 100 g. Lane B1b closed that family (the owner's `VOLUME_UNIT_ML`
    // now carries them, and this builder gates on the owner's table); the
    // density-side objection that held the fix back — the classifier called
    // cola, beer and coffee 0.5 g/ml solids, so `2 liters coca cola` would have
    // gone 200 g -> 1000 g against a true ~2,080 g — is answered by `BEVERAGE_RE`
    // in the owner (#340), which sequences ahead of B1b in the deploy queue.
    //
    // What is STILL uncounted rather than fixed: `kilograms` and
    // `fluid ounce(s)`, which the regex promises and no table converts. This
    // is the instrument-fail-open lesson applied deliberately: the existing
    // `volume_unit_table_mismatch` warning sits INSIDE the volume branch, which
    // those units can never enter, so it can never fire for them. Build the fix
    // if and only if this warns.
    if (unit && EXPLICIT_MEASURE_UNIT_RE.test(unit)
        && WEIGHT_TO_GRAMS[unit] == null && VOLUME_UNIT_ML[unit] == null) {
        logger.warn('fs.build_result.declared_unit_has_no_conversion', {
            foodId: candidate.id, unit, foodName, qty,
        });
    }

    // 3. Gram resolution cascade.
    let grams: number | null = null;
    let servingDescription: string | null = null;
    let servingTier: string | undefined;
    /** The serving whose grams anchored the result, for per-serving macro scaling. */
    let pickedServing: FsServingView | null = null;

    if (unit && WEIGHT_TO_GRAMS[unit]) {
        // (a) Explicit weight unit — direct conversion.
        grams = qty * WEIGHT_TO_GRAMS[unit];
        servingDescription = `${grams.toFixed(1)}g`;
        servingTier = 'fs_weight_direct';
    } else if (unit && VOLUME_UNIT_ML[unit]) {
        // (b) Volume unit — a serving carrying volumeMl gives this food's own
        // density (grams / volumeMl). Prefer a serving whose description names
        // the requested unit; else any volume-quantified serving.
        const totalMl = qty * VOLUME_UNIT_ML[unit];
        const volServings = usableServings.filter(s => s.volumeMl != null && s.volumeMl > 0);
        const volMatch = volServings.find(s => servingMatchesVolumeUnit(s, unit)) ?? volServings[0];
        // The record's OWN declared default, when it names the requested unit.
        // Only reached when no volumeMl-bearing serving exists, so this never
        // displaces the more precise density path above.
        //
        // Scoped to `defaultServingId` deliberately, and NOT widened to "any
        // serving whose description matches". 3,677 of the 4,822 cup-named
        // NULL-volumeMl rows (76.3%) ARE the record's default, so the declared
        // row carries most of the population anyway — and a record can hold
        // several cup rows ("1 cup cooked" 158 g vs "1 cup, dry, yields" 570 g
        // on fs_4501 itself), where picking among them without a declaration is
        // the positional pick this module already had to fix once at the hydrate
        // step. An explicit declaration beats an inference and needs no
        // threshold; widening this is a separate change with its own gate run.
        //
        // Re-derive the population (box, read-only):
        //   SELECT count(*) FILTER (WHERE s."volumeMl" IS NULL OR s."volumeMl" <= 0),
        //          count(*) FILTER (WHERE s."volumeMl" > 0)
        //   FROM "FatSecretServing" s
        //   WHERE s.grams IS NOT NULL AND s.description ~* '\ycups?\y';
        const declaredDefault = row?.defaultServingId
            ? usableServings.find(s => s.servingId === row.defaultServingId)
            : undefined;
        // ...and only when that declaration is UNAMBIGUOUS for this unit.
        //
        // A record can carry several rows naming the same unit, and then the
        // default's choice among them is a claim about PRODUCT FORM, not about
        // what the user asked for. `fs_39558` "Brown Sugar" is the case: it holds
        // `1 tsp unpacked` = 3 g (its declared default), `1 tsp brownulated` =
        // 3.2 g and `1 tsp packed` = 4.6 g. Billing a bare "1 tsp brown sugar"
        // as unpacked is picking a variant the request never named — recipes mean
        // packed, which is why golden `n-dens-03` bands [3.5, 5.5]. Refusing here
        // falls through to the category density, which answers the generic
        // question generically.
        //
        // Cheap, measured 2026-08-03 on the box: of the 3,672 records whose
        // declared default is a non-yield cup row, 3,624 (98.7%) have exactly one
        // such row, so this gives up 1.3% of the population. Note `fs_4501`
        // "White Rice" stays in: its second cup row is `1 cup, dry, yields`,
        // which the yield rule already removed before this count is taken.
        const sameUnitDeclarations = declaredDefault
            ? usableServings.filter(s => declaredVolumeUnitGrams(s, unit) != null).length
            : 0;
        const declaredGramsPerUnit = declaredDefault && sameUnitDeclarations === 1
            ? declaredVolumeUnitGrams(declaredDefault, unit)
            : null;

        if (volMatch) {
            grams = totalMl * (volMatch.grams! / volMatch.volumeMl!);
            servingDescription = `${qty} ${unit}`;
            servingTier = 'fs_label_volume';
            pickedServing = volMatch;
        } else if (declaredGramsPerUnit != null) {
            grams = qty * declaredGramsPerUnit;
            servingDescription = `${qty} ${unit}`;
            servingTier = 'fs_label_volume_declared';
            pickedServing = declaredDefault!;
        } else {
            // Density fallback, from the ONE owner of this rule
            // (`resolveVolumeGrams()` in `src/lib/units/volume-density.ts`).
            //
            // This block used to be a hand-copy that "mirrored buildFdcResult".
            // It mirrored the wrong copy: the OFF path carries an `isPaste` tier
            // (~1 g/ml for spreads) that neither this nor the FDC copy ever got,
            // so a tablespoon of peanut butter billed 15ml × 0.5 = 7.5 g here
            // against ~16 g there. Measured 2026-08-01 — when the rerank window
            // stopped starving the FatSecret lane, 73 of 250 already-asked
            // queries changed what the user is billed, and this was the cause.
            //
            // Nothing about the NUMBERS changed in the move; they are the OFF
            // path's tuned constants verbatim. Re-tuning is a separate PR with
            // its own winner-gate run, because grams feed the save gates and the
            // cached row.
            const resolved = volumeToGrams(qty, unit, foodName, parsed?.name);
            // `unit` already passed `VOLUME_UNIT_ML[unit]` above, so a null here
            // would mean the two unit tables disagree — fall back rather than
            // bill NaN, and say so.
            if (!resolved) {
                logger.warn('fs.build_result.volume_unit_table_mismatch', { unit, foodName });
                grams = totalMl * 0.5;
            } else {
                grams = resolved.grams;
            }
            servingDescription = `${qty} ${unit}`;
            servingTier = 'fs_volume_density';
        }
    } else if (requestBillsByServing(parsed)) {
        // (c) Count/serving-style request: either an explicit count/container
        // unit ("bar", "scoop", "bottle") or a unitless line whose NAME implies
        // a discrete piece. Token-match the noun against serving descriptions —
        // the fs "1 bar" serving is exactly the missing-serving-shape class
        // this lane exists to fix.
        //
        // BARE-REQUEST PER-PIECE SUPPRESSION — the same two rules the OFF
        // cascade applies, now taken from their one owner in bare-query-guard
        // rather than re-derived here:
        //   (1) a digitless qty-1 PLURAL asks for A SERVING, not one piece, so
        //       every per-piece branch is suppressed ("almonds" → a serving,
        //       never one 1.2 g nut);
        //   (2) a digitless qty-1 SINGULAR must not be answered by a tiny
        //       per-piece weight either — bare "almond" still means a serving.
        //       OFF spells this `BARE_MIN_PIECE_SERVING_GRAMS` (20 g); pieces
        //       at or above it (banana, egg, bagel) ARE the serving.
        //
        // This branch had NEITHER rule. OFF suppresses (1) across its three
        // per-piece branches and enforces (2) in its seed branch, but the
        // plural predicate lived inside map-ingredient-with-fallback and could
        // not be imported here without an import cycle — so the rule was
        // structurally unavailable to this copy, not merely forgotten.
        // Measured by the winner-gate 2026-08-01: bare `almonds` billed 1.2 g /
        // 7 kcal here against OFF's 28 g / 160 kcal.
        const barePlural = isBarePluralRequest(parsed, rawLine, parsed?.name || foodName);
        const bareSingular = !barePlural && isBareUnitlessQty1(parsed, rawLine);
        let noun = barePlural
            ? null
            : unit
                ? singularizeUnit(unit)
                : inferDiscreteUnit(parsed?.name || foodName);
        let match = noun ? usableServings.find(s => servingMatchesNoun(s, noun!)) : undefined;
        // Lexicon-free fallback for unitless lines ("15 pretzels"): the noun
        // lexicon is deliberately conservative, but an fs serving whose label
        // contains the request's trailing token ("1 pretzel (Include nuggets)")
        // is itself proof the token is a countable piece of THIS food. Only
        // fires when such a serving exists, so no false discrete billing.
        //
        // BUT IT YIELDS TO A DECLARED SERVING ON A BARE REQUEST. This fallback is
        // lexicon-free by design — it accepts whatever trailing token happens to
        // appear in some serving label — so it is the weakest evidence in this
        // branch, and on a bare query it was outranking the record's own answer.
        //
        // `trader joes chicken breast` (golden eval n-mq-47, drift measured
        // 2026-08-02) resolved trailing token `breast` against
        // `1/2 breast, bone and skin removed` on `fs_4881229`. That row carries
        // grams 118 and **numberOfUnits 0.5**, so the per-unit arithmetic below
        // derives 118 / 0.5 = 236 g — one whole breast. The arithmetic is
        // correct; the ANSWER is wrong, because a bare request asks what one
        // serving is and that record says so itself, on a row reading
        // `1 serving (90 g)`. 236 g is outside the case's [80, 200] band; 90 g
        // is inside it.
        //
        // Note what this is NOT: a size ceiling. A ceiling was the obvious read
        // (the floor `BARE_MIN_PIECE_SERVING_GRAMS` has no upper twin) and it
        // would be a magic number chosen to exclude one food, and would still
        // pick the wrong row for every record whose pieces are legitimately
        // large. Preferring an explicit declaration over an inference is a rule
        // with a reason, and it needs no threshold.
        //
        // Scoped to the lexicon-free path deliberately. The curated
        // `DISCRETE_ITEM_UNIT_RE` path is strong evidence — "1 bar" on a protein
        // bar SHOULD outrank a generic serving row — and is left alone.
        if (!match && !unit && !barePlural) {
            const requestName = parsed?.name || foodName;
            const lastToken = requestName
                .toLowerCase().trim().split(/\s+/).pop() ?? '';
            const fallbackNoun = singularizeUnit(lastToken);
            let matchedNoun: string | null = null;
            let fallbackMatch: FsServingView | undefined;
            if (fallbackNoun && fallbackNoun.length >= 3) {
                fallbackMatch = usableServings.find(s => servingMatchesNoun(s, fallbackNoun));
                if (fallbackMatch) matchedNoun = fallbackNoun;
            }
            // HEAD-NOUN-ONLY WAS TOO NARROW. The scan above asks only whether a
            // serving names the request's LAST token, but FatSecret routinely
            // labels the piece with a MODIFIER of the product name instead of its
            // head noun. `fs_519595` "Cherry Tomatoes" carries `1 cherry` at 17 g
            // — the record's own per-piece row, and exactly the answer golden
            // n-serv-13 wants (5 x 17 = 85 g, band [50, 120]) — while the request
            // head noun is `tomatoes`. Nothing matched, so resolution fell through
            // to the declared `1 serving (123 g)` row and `5 cherry tomatoes`
            // billed 5 x 123 = 615 g / 110 kcal.
            //
            // `labelPieceMatchesItem` is the predicate for this and count-label.ts
            // has owned it since the OFF lane adopted it: is the label's piece word
            // literally one of the words the user is counting? This branch simply
            // never called it — its only caller is the cache escape in
            // map-ingredient-with-fallback (re-derive: `grep -rn labelPieceMatchesItem src/`).
            //
            // It is also the guard, which is why no measure-word exclusion list is
            // needed here: `1 cup` (149 g) and `1 oz` (26 g) sit on this very
            // record and are rejected because neither `cup` nor `oz` is a word in
            // "cherry tomatoes". A serving must be named by the request itself to
            // be billed per-piece against it.
            if (!fallbackMatch) {
                for (const s of usableServings) {
                    const labelWord = extractLabelServingUnit(s.description);
                    if (labelWord && labelWord.length >= 3
                        && labelPieceMatchesItem(labelWord, requestName)) {
                        fallbackMatch = s;
                        matchedNoun = labelWord;
                        break;
                    }
                }
            }
            if (fallbackMatch && matchedNoun) {
                const declaredOneServing = bareSingular
                    ? usableServings.find(s =>
                        EXPLICIT_ONE_SERVING_RE.test(s.description)
                        && usableBareLabelServing(
                            s.grams, extractLabelServingUnit(s.description)) != null)
                    : undefined;
                if (declaredOneServing) {
                    logger.info('fs.build_result.bare_fallback_yielded_to_declared_serving', {
                        foodId: candidate.id,
                        fallbackNoun: matchedNoun,
                        fallbackServing: fallbackMatch.description,
                        declaredServing: declaredOneServing.description,
                    });
                } else {
                    noun = matchedNoun;
                    match = fallbackMatch;
                }
            }
        }
        if (noun) {
            if (match) {
                // `numberOfUnits` counts SERVINGS, not pieces, so it is 1 on a
                // serving whose label already enumerates the pieces. fs_63588
                // reads `13 chips` at 28.35 g with numberOfUnits 1: dividing by
                // numberOfUnits calls the whole 13-chip serving one chip, and
                // `13 tortilla chips` bills 13 x 28.35 = 368.55 g / 1950 kcal
                // (golden n-serv-35, n-tot-05; band [28, 70]).
                //
                // When the label enumerates the matched noun, ITS count is the
                // authority. count-label.ts has owned that predicate since the
                // OFF lane adopted it — its header names this exact query — and
                // this branch simply never called it, which is why the same line
                // is right through buildOffResult and wrong here.
                //
                // Guarded, not substituted: `servingLabelCountsPiece` requires a
                // count >= 2 naming this noun (or a generic piece word) and a
                // sane per-piece weight, so `1 thin slice` and `1 serving (123 g)`
                // still fall through to numberOfUnits untouched.
                const labelPieceCount = servingLabelCountsPiece(match.description, match.grams, noun)
                    ? labelLeadingCount(match.description)
                    : null;
                const unitsPerServing = labelPieceCount
                    ?? (match.numberOfUnits && match.numberOfUnits > 0 ? match.numberOfUnits : 1);
                const perUnitGrams = match.grams! / unitsPerServing;
                if (bareSingular && perUnitGrams < BARE_MIN_PIECE_SERVING_GRAMS) {
                    // Rule (2): leave `grams` null so resolution falls through
                    // to the default serving, where the bare-query guard can
                    // apply the category default.
                    logger.info('fs.build_result.bare_tiny_piece_skipped', {
                        foodId: candidate.id,
                        noun,
                        serving: match.description,
                        perUnitGrams,
                    });
                } else {
                    grams = qty * perUnitGrams;
                    servingDescription = `${qty} ${noun} (${perUnitGrams.toFixed(1)}g each)`;
                    servingTier = 'fs_label_count';
                    pickedServing = match;
                    logger.info('fs.build_result.label_count_matched', {
                        foodId: candidate.id,
                        noun,
                        serving: match.description,
                        perUnitGrams,
                        // Which divisor won. Without it the tier alone cannot
                        // distinguish a label-enumerated serving from a
                        // numberOfUnits one, and that is the whole defect.
                        labelPieceCount,
                    });
                }
            }
        }

        // (c2) AMBIGUOUS / COUNT UNIT — the step the other two cascades have and
        // this one did not.
        //
        // "1 handful almonds", "1 sleeve saltine crackers", "1 bowl cereal",
        // "1 knob of butter": the unit is a real request the label cannot answer,
        // and `buildOffResult()` and `buildFdcResult()` both resolve it through
        // `getOrCreateAmbiguousServing()` (deterministic sub-piece defaults,
        // then the per-food cache, then an estimate). `buildFatSecretResult()`
        // never called it, so these fell straight to the declared default —
        // whatever single piece the record happens to lead with.
        //
        // That was invisible while the FatSecret lane reached the reranker on
        // 16.9% of queries. Fixing the lane starvation made FatSecret the winner
        // for these lines and the gate measured the cost immediately
        // (2026-08-02, regression pool): `1 handful almonds` 30g -> 1.2g and
        // `1 sleeve saltine crackers` 113g / 490kcal -> 3g / 13kcal, both
        // billing ONE almond and ONE cracker.
        //
        // Banding the default serving would NOT have fixed these. This builder
        // is terminal — it always bills something — so a rejection lands on the
        // flat per-100g tier, and the bare-query guard cannot rescue it either
        // because its digit gate excludes every one of these lines by design.
        // 100g for a handful of almonds is not better than 1.2g, it is just
        // wrong in the other direction. The request needs an ANSWER, not a veto,
        // and the answer already exists in a module this file can import.
        //
        // Ordered after the noun match and before the declared default,
        // mirroring `buildOffResult()`: a serving the label genuinely enumerates
        // still wins ("2 bars" on a record with a "1 bar" serving never reaches
        // here), and a resolved container weight outranks a lead piece.
        if (grams == null && unit
            && (isAmbiguousUnit(unit) || classifyUnit(unit) === 'count')) {
            const ambiguous = await getOrCreateAmbiguousServing(
                candidate.id, foodName, unit, brandName
            );
            if ((ambiguous.status === 'success' || ambiguous.status === 'cached')
                && ambiguous.grams && ambiguous.grams > 0) {
                grams = qty * ambiguous.grams;
                servingDescription = `${qty} ${unit} (${ambiguous.grams.toFixed(1)}g each)`;
                servingTier = ambiguous.status === 'cached' ? 'count_unit_cached' : 'count_unit_ai';
                logger.info('fs.build_result.unit_serving_resolved', {
                    foodId: candidate.id,
                    unit,
                    perUnitGrams: ambiguous.grams,
                    status: ambiguous.status,
                });
            } else {
                logger.warn('fs.build_result.unit_serving_unresolved', {
                    foodId: candidate.id,
                    unit,
                    error: ambiguous.error,
                });
            }
        }

        // Default-serving fallback for serving-billed requests the noun match
        // couldn't resolve (bare qty-1, "1 serving", unmatched nouns).
        //
        // BAND ON THE BARE PATH. A record's declared default is not necessarily
        // single-serving-scale: FatSecret's own `defaultServingId` for `Almonds`
        // (fs_37040) is the 1.2g "1 almond" row, so suppressing the count branch
        // above changed only which TIER billed 1.2g, not the number — measured
        // by the winner-gate, 2026-08-01. OFF gates its equivalent step on
        // `usableBareLabelServing()` and routes onward when it fails; this
        // cascade had no band and no successor, so an out-of-band serving was
        // simply billed.
        //
        // AND THE FALLBACK BELOW THE DECLARED DEFAULT WAS A COIN FLIP, with a
        // measurable population. `defaultServingId` resolves for 23,837 of
        // 23,837 FatSecret foods, so `?? usableServings[0]` fires in exactly
        // one situation: the declared default IS the per-100g panel row that
        // `isPer100gPanelServing` demotes out of `usableServings` above. That is
        // 569 foods, 568 of which have another serving to land on positionally
        // (measured 2026-08-02, box). `Chicken` (fs_1623) is one: its declared
        // default is the shared "100 g" row, and the positional pick billed
        // whichever serving the include happened to return first — 85g before
        // this branch was ordered, 7g ("1 thin slice") after. Ordering made it
        // reproducible without making it right; reproducible-and-wrong is worse,
        // because it stops being noticed.
        //
        // 278 of those 569 records answer the question themselves with an
        // explicit "1 serving (Xg)" row, and 3,422 of the 3,565 such rows
        // corpus-wide are inside the 3-400g band. Preferring it is the record's
        // own statement of what a serving is, which is the whole hierarchy this
        // branch implements; position is not evidence of anything.
        //
        // No lexicon rescue exists for this class, which is why it matters:
        // `getBareQueryDefault` returns NOTHING for chicken, beef, steak,
        // salmon, pork, turkey, rice, pasta, bread, egg, ham or sausage
        // (measured 2026-08-02). The staple proteins and grains have no category
        // default, so falling through to the bare-query guard would not have
        // corrected `chicken` either — it would have billed the flat 100g.
        //
        // Reject, do NOT substitute. Picking "the next in-band serving" looks
        // better and is not safe: `usableServings` comes from an unordered
        // include, and fs_37040's other in-band servings are 28.35g AND 143g.
        // Falling through is deterministic — the request lands on the fabricated
        // per-100g tier, which the bare-query guard REPLACEs with the category
        // default (`almonds` -> 28g, `coca cola` -> 355g). That only ever fires
        // where the current answer is already outside 3–400g or is the flat-100g
        // placeholder, i.e. exactly the answers that were wrong.
        const bareServingUsable = (s: FsServingView): boolean =>
            !bareSingular && !barePlural
                ? true
                : usableBareLabelServing(s.grams, extractLabelServingUnit(s.description)) != null;
        if (grams == null) {
            const declaredDefault =
                (row?.defaultServingId
                    ? usableServings.find(s => s.servingId === row!.defaultServingId)
                    : undefined)
                ?? usableServings.find(s => EXPLICIT_ONE_SERVING_RE.test(s.description))
                ?? usableServings[0];
            const defaultServing = declaredDefault && bareServingUsable(declaredDefault)
                ? declaredDefault
                : undefined;
            if (declaredDefault && !defaultServing) {
                logger.info('fs.build_result.bare_default_serving_out_of_band', {
                    foodId: candidate.id,
                    serving: declaredDefault.description,
                    grams: declaredDefault.grams,
                });
            }
            if (defaultServing) {
                grams = qty * defaultServing.grams!;
                servingDescription = qty === 1
                    ? `${defaultServing.description} (${defaultServing.grams}g)`
                    : `${qty} x ${defaultServing.description} (${defaultServing.grams}g each)`;
                servingTier = 'fs_default_serving';
                pickedServing = defaultServing;
            }
        }

        // Macro-only-serving fallback: FatSecret's generic "1 serving"
        // restaurant records carry per-serving macros but no gram weight and no
        // per-100g panel, so every gram-anchored path above found nothing. The
        // serving IS the unit the user is logging, so bill its macros directly.
        // The reported grams is a secondary energy-density estimate anchored on
        // the serving so the per-serving macro scaling below bills exactly
        // `qty x` this serving's authoritative macros.
        if (grams == null) {
            const macroServing =
                (row?.defaultServingId
                    ? servings.find(s => s.servingId === row!.defaultServingId
                        && servingMacros(s.nutrients) != null)
                    : undefined)
                ?? servings.find(s => servingMacros(s.nutrients) != null);
            if (macroServing) {
                const m = servingMacros(macroServing.nutrients)!;
                // Invert the record's own per-100g panel when it has one: that
                // recovers the real weight instead of estimating it, so a tall
                // flat white bills 340g rather than the 85g a 2.0 kcal/g solid
                // -food density implies, and a brewed coffee ~477g rather than
                // 2.5g. Falls back to the estimate for records with no panel at
                // all (Impossible Whopper and friends), which is what it was
                // written for.
                const fromPanel = per100 ? gramsFromPer100gPanel(m, per100) : null;
                const estPerServingGrams = fromPanel ?? estimateServingGrams(m);
                // FLOOR ONLY — not the label band. This tier is the next thing
                // to catch a bare request the default-serving band just
                // rejected, and it reaches the identical answer by a different
                // route: inverting the 1-almond serving's 7 kcal against a 578
                // kcal/100g panel is 1.2g again. Banding one branch and not the
                // other would have made the fix inert while looking like it
                // worked.
                //
                // But only the FLOOR transfers. The first version applied the
                // full 3–400g label band here and the existing panel-inversion
                // tests killed it: a brewed coffee legitimately inverts to
                // ~477g, and a 400g ceiling sent it to the flat 100g default.
                // These grams are not a label — they are arithmetic on the
                // record's own panel, validated at 98.1% within 5% — so the
                // upper bound has no basis on this tier. The defect being fixed
                // is a 1.2g UNDER-bill.
                if ((bareSingular || barePlural) && estPerServingGrams < BARE_LABEL_MIN_GRAMS) {
                    logger.info('fs.build_result.bare_macro_serving_out_of_band', {
                        foodId: candidate.id,
                        serving: macroServing.description,
                        estGrams: estPerServingGrams,
                    });
                } else {
                macroServing.grams = estPerServingGrams;
                grams = qty * estPerServingGrams;
                servingDescription = qty === 1
                    ? macroServing.description
                    : `${qty} x ${macroServing.description}`;
                // TWO BRANCHES, TWO TIERS. `fromPanel` recovered a REAL weight by
                // inverting the record's own panel; the fallback FABRICATED one at a
                // flat 2.0 kcal/g. They are stamped separately so the fabricated half
                // is queryable — and so no consumer has to pattern-match its way to
                // the distinction, which the single name made impossible. Measured on
                // the 76 tier-firing records that carry a panel (so true grams are
                // recoverable): the estimate lands within +-25% of the truth on 11,
                // and its median est/true is 0.273 — it under-states weight by 3.7x,
                // p10 0.033 / p90 1.105. See the owner report.
                // Membership predicate: `isSyntheticGramsTier()` in ./serving-ai-tiers.
                servingTier = fromPanel != null
                    ? 'fs_serving_macros_only'
                    : FS_SERVING_MACROS_ONLY_EST_TIER;
                pickedServing = macroServing;
                logger.info('fs.build_result.serving_macros_only', {
                    foodId: candidate.id,
                    serving: macroServing.description,
                    kcalPerServing: m.kcal,
                    estGrams: estPerServingGrams,
                    gramsSource: fromPanel != null ? 'per100g_panel_inversion' : 'energy_density',
                });
                }
            }
        }
    }

    // (d) Per-100g fallback — no serving data usable for this request.
    if (grams == null || servingDescription == null) {
        if (!per100) {
            logger.warn('fs.build_result.no_usable_serving_or_per100g', { foodId: candidate.id });
            return null;
        }
        grams = 100 * qty;
        servingDescription = `${grams.toFixed(1)}g`;
        servingTier = 'fs_per100g_fallback';
        pickedServing = null;
    }

    // Bare-query guard parity (PR D pt3 Lever A, reused generically): the
    // guard's entry point is tier-keyed on the OFF tier names, so map the two
    // fs tiers it should police onto their OFF semantic twins —
    //   fs_default_serving  → 'label_serving_default' (CAP-only: fires when the
    //     default serving is package-scale, >2x the category default);
    //   fs_per100g_fallback → 'flat_100g_default' (REPLACE: a fabricated 100g
    //     yields to the category default / discrete-piece floor).
    // Guard eligibility (bare unitless qty-1, digitless raw line) is checked
    // inside applyOffBareQueryGuard itself; non-bare requests pass through.
    const GUARD_TIER_ALIAS: Record<string, string> = {
        'fs_default_serving': 'label_serving_default',
        'fs_per100g_fallback': 'flat_100g_default',
    };
    if (servingTier && GUARD_TIER_ALIAS[servingTier]) {
        const bareOverride = applyOffBareQueryGuard({
            grams,
            servingTier: GUARD_TIER_ALIAS[servingTier],
            parsed,
            rawLine,
            queryName: parsed?.name || '',
            foodName,
            servingDescription: pickedServing?.description ?? servingDescription,
        });
        if (bareOverride) {
            logger.info('fs.build_result.bare_category_default', {
                foodId: candidate.id,
                previousTier: servingTier,
                previousGrams: grams,
                grams: bareOverride.grams,
            });
            grams = bareOverride.grams;
            servingDescription = bareOverride.servingDescription;
            servingTier = bareOverride.servingTier;
        }
    }

    // 4. Macros: per-serving macros scaled by grams are the most accurate
    // (they ARE this serving's label panel); per-100g rescale is the fallback.
    const pickedMacros = pickedServing?.grams && pickedServing.grams > 0
        ? servingMacros(pickedServing.nutrients) : null;
    let macros: Macros;
    if (pickedMacros) {
        const factor = grams / pickedServing!.grams!;
        macros = {
            kcal: pickedMacros.kcal * factor,
            protein: pickedMacros.protein * factor,
            carbs: pickedMacros.carbs * factor,
            fat: pickedMacros.fat * factor,
        };
    } else if (per100) {
        const factor = grams / 100;
        macros = {
            kcal: per100.kcal * factor,
            protein: per100.protein * factor,
            carbs: per100.carbs * factor,
            fat: per100.fat * factor,
        };
    } else {
        logger.warn('fs.build_result.no_macros_for_serving', { foodId: candidate.id });
        return null;
    }

    return {
        source: 'fatsecret',
        foodId: `fs_${fsId}`,
        foodName,
        brandName,
        servingId: pickedServing?.servingId ?? null,
        servingDescription,
        grams,
        kcal: macros.kcal,
        protein: macros.protein,
        carbs: macros.carbs,
        fat: macros.fat,
        confidence,
        quality: confidence >= 0.8 ? 'high' : confidence >= 0.6 ? 'medium' : 'low',
        rawLine,
        servingTier,
    };
}
