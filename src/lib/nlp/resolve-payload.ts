import { prisma } from '../db';
import { deriveServingOptions } from '../units/servings';
import { extractCacheNutrients, buildServingOptionsForCacheFood } from '../mapping/cache-search';
import { recoverMacroOnlyServing, flattenPersistedServings } from '../mapping/fs-serving-macros';
import { portionProvenanceForTier, type PortionProvenance } from '../mapping/serving-ai-tiers';

export function getServingType(label: string): 'weight' | 'volume' | 'count' {
  const normalized = label.toLowerCase().trim();
  
  // Volume units
  if (/\b(cup|cups|tbsp|tablespoon|tablespoons|tsp|teaspoon|teaspoons|ml|milliliter|milliliters|fl\s*oz|floz|fluid\s*oz|pint|pints|quart|quarts|gal|gallon|gallons|liter|liters|l)\b/i.test(normalized)) {
    return 'volume';
  }
  
  // Weight units
  if (/\b(g|gram|grams|kg|kilogram|kilograms|oz|ounce|ounces|lb|lbs|pound|pounds)\b/i.test(normalized)) {
    return 'weight';
  }
  
  // Everything else is a count unit
  return 'count';
}

/**
 * Per-100g block as resolveFoodDetails returns it.
 *
 * UNITS — kcal100 is kilocalories; EVERY OTHER FIELD, `sodium100` INCLUDED, is
 * GRAMS per 100 g. Stated here because this one type is emitted by four
 * branches reading four different stores, and one of them used to disagree:
 * `AiGeneratedFood.sodiumMgPer100g` is milligrams (correctly named) and was
 * assigned straight through, so `sodium100` carried two units 1000x apart,
 * separable only by `source`. The mobile client renders this field with a fixed
 * `mg` label and one conversion factor, so it can only ever be right for one of
 * two conventions. Grams is the one that holds: three of the four branches
 * already emitted it, the sibling fields (`protein100`/`carbs100`/`fat100`) are
 * grams, and `/api/foods/search` divides mg by 1000 in both
 * `derivePer100gFromServings()` and `recoverMacroOnlyServing()` — so grams is
 * what makes the parse and search lanes agree on the same record.
 *
 * Reaches the client from `/api/nlp/parse`, `/api/foods/barcode` and (computed
 * separately, same convention) `/api/foods/search`. `/api/foods/[id]` emits no
 * sodium at all.
 */
export interface ResolvedNutritionPer100g {
  kcal100: number;
  protein100: number;
  carbs100: number;
  fat100: number;
  /**
   * Grams per 100 g, or NULL when the source panel does not DECLARE fibre.
   *
   * `null` and `0` are two different facts and both reach the wire as they
   * are: a declared 0 stays 0, an undeclared value is null, never a
   * manufactured 0. Every store this function reads can be silent about
   * fibre — OFF carries the key present-and-null (264,671 of 1,085,527
   * `OffFood` rows; 807 of the 3,574 behind a `FoodMapping`), FatSecret omits
   * the key (1,393 rows with a non-empty panel), the FS macro-only recovery
   * can find no `fiber` on the serving row, and `AiGeneratedFood.fiberPer100g`
   * is nullable. Folding those to 0 displayed a fabricated "0 g" and, because
   * the client subtracts fibre from carbs, inflated Net carbs on every such
   * row. FDC is the one store that always carries a number (0 of 4,133 rows
   * null or absent), so its `?? null` is inert by measurement. All measured
   * on the box 2026-09-05; re-derive the OFF figure with
   *   SELECT count(*) FILTER (WHERE "nutrientsPer100g" ? 'fiber' AND
   *     "nutrientsPer100g"->>'fiber' IS NULL), count(*) FROM "OffFood";
   * Arithmetic consumers (`/api/nlp/parse`'s billed `nutrition.fiber`) carry
   * the null through rather than fold it: the wire says "no claim", never
   * "zero grams". `sugar100`/`sodium100` keep their 0 fallback — the same
   * shape, deliberately NOT changed here.
   */
  fiber100: number | null;
  /** Grams per 100 g. */
  sugar100: number;
  /** GRAMS per 100 g — never milligrams. See the type doc. */
  sodium100: number;
}

/**
 * True when a resolved per-100g block carries no nutrition at all.
 *
 * resolveFoodDetails starts from a literal whose four macros are zero (its
 * `fiber100` starts NULL — see the type) and overwrites it only if the food
 * row is found AND that row has nutrients, so all-zero macros are how this
 * module spells "unknown" — it cannot distinguish that from a genuine zero.
 * Fibre is not consulted: it is null on an unresolved row by construction.
 */
export function isDegenerateNutrition(n: ResolvedNutritionPer100g): boolean {
  return n.kcal100 === 0 && n.protein100 === 0 && n.carbs100 === 0 && n.fat100 === 0;
}

/**
 * True when the per-100g block cannot be reconciled with what the line bills.
 *
 * The client rescales a portion as `per100g x grams`, so the response carries
 * the calorie count twice and the two must agree. They come apart when grams is
 * not a real weight: a serving billed from its OWN macros (FatSecret's
 * "1 serving" restaurant rows) reports grams as an energy-density estimate, so
 * a tall flat white bills its true 170 kcal beside a kcal100 that implies 42.
 *
 * Compared on calories alone — it is the figure the split actually corrupts,
 * and the one every client path reads. The tolerance is deliberately loose:
 * ordinary rounding through `toFixed(1)` and per-100g storage drifts by a few
 * tenths, and re-deriving in that case would be churn. Both an absolute and a
 * relative floor must be cleared, so small totals (a 5 kcal black coffee)
 * cannot trip it on rounding alone.
 */
export function isPer100gInconsistentWithBilled(
  n: ResolvedNutritionPer100g,
  billed: { grams: number; kcal: number },
): boolean {
  if (!(billed.grams > 0)) return false;
  if (!(billed.kcal > 0)) return false;
  const implied = (n.kcal100 ?? 0) * (billed.grams / 100);
  const diff = Math.abs(implied - billed.kcal);
  return diff > 5 && diff > billed.kcal * 0.1;
}

/**
 * Per-100g values implied by a line's own billed macros.
 *
 * Used when the food row can't supply nutrition. The mapper is authoritative
 * for the line — it billed these macros off the candidate that actually won —
 * whereas resolveFoodDetails re-reads the food row, and the two disagree
 * whenever the row isn't there yet.
 *
 * That gap is routine, not exotic: fatsecret hits are written by a background
 * task (persistFatSecretHits), so the FIRST-EVER sighting of a fatsecret food
 * resolves against a row that does not exist or is still empty. Measured on
 * the box: a cold "kohlrabi fritters" returned a correct serving value of 53.5
 * kcal alongside kcal100 = 0; the very next identical request returned 357.
 * Since the mobile client rescales portions by multiplying kcal100
 * (api-contract §4), the user could log a food correctly and then zero it out
 * just by nudging the portion control.
 *
 * per100g * grams == the billed macros by construction, so a portion change
 * stays exactly consistent with what was shown even when `grams` is itself an
 * estimate (fatsecret restaurant items with no metric serving, where grams
 * comes from an energy-density guess). The absolute weight may be approximate;
 * the ratio is not.
 *
 * Returns null when there is nothing to derive from.
 */
export function per100gFromBilledMacros(billed: {
  grams: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}): Pick<ResolvedNutritionPer100g, 'kcal100' | 'protein100' | 'carbs100' | 'fat100'> | null {
  if (!(billed.grams > 0)) return null;
  if (!(billed.kcal > 0) && !(billed.protein > 0) && !(billed.carbs > 0) && !(billed.fat > 0)) {
    return null;
  }
  const factor = 100 / billed.grams;
  const round2 = (v: number) => Math.round(v * factor * 100) / 100;
  return {
    kcal100: round2(billed.kcal),
    protein100: round2(billed.protein),
    carbs100: round2(billed.carbs),
    fat100: round2(billed.fat),
  };
}

export async function resolveFoodDetails(foodId: string, matchedServingDescription?: string | null) {
  let name = '';
  let brandName: string | null = null;
  // NOT 'fatsecret'. Each of the four branches below assigns `source` only INSIDE its
  // `if (record found)` guard, so every unresolvable foodId — `water_default` (the
  // zero-calorie fast path, which matches no prefix and is not an AiGeneratedFood row), a
  // stale `fdc_` id, a purged `off_` barcode — kept this initializer and shipped
  // `source: 'fatsecret'`, putting FatSecret's licensed Web Badge on data they never
  // supplied while an attribution audit with them is open. An unidentified record must make
  // no provider claim; 'ai_estimated' is the only non-badging value in the contract union
  // (api-contract.md:506) and the only one the food_log_items CHECK accepts
  // (001_mobile_schema.sql:164), so it is the safe floor rather than a claim of AI origin.
  let source = 'ai_estimated';
  // Typed explicitly: an inferred literal type would narrow `fiber100` to `null`
  // from the initializer and refuse the numbers every branch assigns below.
  let nutritionPer100g: ResolvedNutritionPer100g = {
    kcal100: 0,
    protein100: 0,
    carbs100: 0,
    fat100: 0,
    // NULL, not 0. An unresolvable id (a stale `fdc_`, a purged `off_`,
    // `water_default`) declares nothing, and the parse route's degenerate-panel
    // repair re-derives only the four macros from the billed line, so this
    // initializer is the fibre value that ships for such a row.
    fiber100: null,
    sugar100: 0,
    sodium100: 0,
  };
  let rawServingOptions: Array<{ label: string; grams: number }> = [];
  // Set only by the fs_ macro-only recovery below. `recoverMacroOnlyServing`'s
  // header states the rule this exists to keep: the recovered per-100g figures
  // are a self-consistency term computed against an INVENTED weight, so they are
  // admissible only alongside a flag saying so — ship the pair or ship neither.
  // /api/nlp/parse does not read this: it already sources the same flag from
  // `mapped.servingTier` through `isSyntheticGramsTier()`, which is the owned
  // predicate and also covers records this function never sees. This field is
  // for the callers that have no mapper result to ask, i.e. /api/foods/barcode.
  let portionEstimated = false;
  // The badge's field, and the SAME limit as the flag above: this resolver has no
  // mapper result and so no `servingTier` — the only tier it can know is the one
  // the macro-only recovery returns (`recovered.tier`, a BORROWED_OR_DEFAULTED
  // member), so `'borrowed'` on that branch is the whole of what it can say.
  // Every other record resolves with NO field, which means "no provenance claim
  // from this resolver", NOT "own weight" — a caller that has a mapper result
  // (/api/nlp/parse) derives the field from `mapped.servingTier` and does not
  // read this. For the callers that do not (/api/foods/barcode) this is it.
  let portionProvenance: PortionProvenance | undefined;
  // THE RECORD'S OWN LABEL SERVING — the fallback default when nothing matched.
  // A barcode lookup passes no `matchedServingDescription` (it has no mapper
  // result and no typed line), so the default used to fall to `options[0]`,
  // which for an fs_ record is whatever row Prisma returned first: the Orgain
  // Diego scanned (`fs_74394899`) led with its `100 g` panel row while
  // `FatSecretFood.defaultServingId` named `1 scoop` / 21 g and never reached
  // the response. Each branch below sets this from the pointer the store
  // actually carries — FS: `defaultServingId`; OFF: the parsed label serving
  // (`servingGrams`/`servingSize`); FDC and AI carry no equivalent pointer and
  // leave it null, keeping today's `options[0]` fallback. A MATCHED description
  // still wins outright: the mapper resolved a typed line against a specific
  // row, which outranks a claim about which portion the package leads with.
  // Carried as label + grams, and re-applied against BOTH, because the options
  // list is deduped by LABEL alone and a record can hold two same-description
  // rows with different grams — a label-only match can land the default on the
  // sibling's grams while claiming to be the package serving (measured
  // 2026-08-30: 10 FS records, 14 OFF barcodes carry such a collision). When
  // the deduped list no longer holds the pointer's exact (label, grams), the
  // fallback stays `options[0]` — honest beats close.
  let labelServing: { label: string; grams: number } | null = null;

  if (foodId.startsWith('fdc_')) {
    const fdcId = parseInt(foodId.replace('fdc_', ''), 10);
    const fdcFood = await prisma.fdcFood.findUnique({
      where: { fdcId },
      include: { servings: true }
    });
    if (fdcFood) {
      name = fdcFood.description;
      brandName = fdcFood.brandName ?? null;
      source = 'fdc';
      const nutrients = (fdcFood.nutrientsPer100g as any) || {};
      nutritionPer100g = {
        kcal100: nutrients.calories ?? nutrients.kcal ?? nutrients.energy ?? 0,
        protein100: nutrients.protein ?? 0,
        carbs100: nutrients.carbs ?? nutrients.carbohydrate ?? 0,
        fat100: nutrients.fat ?? nutrients.totalFat ?? 0,
        // Inert on this store by measurement (every FdcFood row carries a
        // number — see the type doc); kept so the rule reads the same on every
        // branch and survives an ingest that starts writing null.
        fiber100: nutrients.fiber ?? null,
        sugar100: nutrients.sugar ?? 0,
        // Already grams per 100 g in this store. No conversion.
        sodium100: nutrients.sodium ?? 0,
      };

      const units = fdcFood.servings.map(s => ({
        label: s.description,
        grams: s.grams
      }));
      rawServingOptions = deriveServingOptions({
        units,
        densityGml: null,
        categoryId: null
      });
    }
  } else if (foodId.startsWith('off_')) {
    const barcode = foodId.replace('off_', '');
    const offFood = await prisma.offFood.findUnique({
      where: { barcode },
      include: { servings: true }
    });
    if (offFood) {
      name = offFood.name;
      brandName = offFood.brandName ?? null;
      source = 'openfoodfacts';
      const nutrients = (offFood.nutrientsPer100g as any) || {};
      nutritionPer100g = {
        kcal100: nutrients.kcal ?? nutrients.calories ?? nutrients.energy ?? 0,
        protein100: nutrients.protein ?? 0,
        carbs100: nutrients.carbs ?? nutrients.carbohydrate ?? 0,
        fat100: nutrients.fat ?? 0,
        // THE HEADLINE SITE. OFF stores an undeclared fibre as `"fiber": null`
        // (off_0850003023175 "Blueberry" is the measured row), and this read
        // used to fold it to 0 — the largest population behind the wire's
        // fabricated "0 g fibre". A declared 0 is a number and stays 0.
        fiber100: nutrients.fiber ?? null,
        sugar100: nutrients.sugar ?? nutrients.sugars ?? 0,
        // Already grams per 100 g in this store (OFF's own column unit). No conversion.
        sodium100: nutrients.sodium ?? 0,
      };

      const parseIntServingGrams = offFood.servingGrams ? Number(offFood.servingGrams) : null;
      const units = offFood.servings.map(s => ({
        label: s.description,
        grams: s.grams
      }));
      if (parseIntServingGrams && !units.some(u => u.label.toLowerCase().includes('serving'))) {
        units.push({
          label: offFood.servingSize || '1 serving',
          grams: parseIntServingGrams
        });
      }

      // OFF's label pointer is `servingGrams` (the parsed package serving
      // weight), not a serving-row id: mark the first unit whose grams agree
      // with it. The appended row above is grams-identical by construction, so
      // it qualifies when nothing else does; a record whose rows all disagree
      // with `servingGrams` keeps the null and today's `options[0]` fallback.
      if (parseIntServingGrams != null) {
        const match = units.find(u => Math.abs(u.grams - parseIntServingGrams) < 0.01);
        labelServing = match ? { label: match.label, grams: match.grams } : null;
      }

      rawServingOptions = deriveServingOptions({
        units,
        densityGml: null,
        categoryId: null
      });
    }
  } else if (foodId.startsWith('fs_')) {
    const fsId = foodId.replace('fs_', '');
    const fsFood = await prisma.fatSecretFood.findUnique({
      where: { fsId },
      include: { servings: true }
    });
    if (fsFood) {
      name = fsFood.name;
      brandName = fsFood.brandName ?? null;
      source = 'fatsecret';
      const nutrients = (fsFood.nutrientsPer100g as any) || {};
      nutritionPer100g = {
        kcal100: nutrients.calories ?? nutrients.kcal ?? 0,
        protein100: nutrients.protein ?? 0,
        carbs100: nutrients.carbs ?? nutrients.carbohydrate ?? 0,
        fat100: nutrients.fat ?? 0,
        // FatSecret OMITS the key rather than nulling it (fs_113183876 "7Up
        // Shirley Temple" has a full panel and no `fiber`); same rule, same null.
        fiber100: nutrients.fiber ?? null,
        sugar100: nutrients.sugars ?? nutrients.sugar ?? 0,
        // Already grams per 100 g in this store: fs_3272 "Soy Sauce" holds
        // 5.637, and its own "100 g" serving row holds 5637 mg. No conversion.
        sodium100: nutrients.sodium ?? 0,
      };

      const units = fsFood.servings
        .filter(s => s.grams != null && s.grams > 0)
        .map(s => ({
          label: s.description,
          grams: s.grams as number
        }));

      // The FS label pointer: `defaultServingId` names the serving the package
      // leads with (`1 scoop`, `15 chips`). Only a row that survived the
      // grams-filter above can be the default — a gram-less default (the
      // macro-only restaurant class) resolves nothing here and the fabricated
      // metric set keeps its `options[0]` fallback.
      if (fsFood.defaultServingId) {
        const declared = fsFood.servings.find(
          s => s.servingId === fsFood.defaultServingId && s.grams != null && s.grams > 0,
        );
        labelServing = declared
          ? { label: declared.description, grams: declared.grams as number }
          : null;
      }

      // MACRO-ONLY RECOVERY — the same repair /api/foods/search made in #324,
      // reading the same function, so the two lanes cannot bill one record two
      // ways. A FatSecret "1 serving" restaurant record stores its nutrition on
      // the serving row and leaves `nutrientsPer100g` an empty `{}`, so every
      // field above reads 0 and the parse wire billed a Whopper Jr. at fiber 0 /
      // sugar 0 / sodium 0 while search reported 1.18 / 4.12 / 0.329 for the
      // identical record. The macros survived only because the parse ROUTE
      // re-derives those four from the line's own billed totals
      // (`per100gFromBilledMacros`); it has no billed figure for the three
      // micros, so nothing downstream could repair them and the zeros shipped.
      //
      // THE GATE IS THE MIRROR OF SEARCH'S, field for field: a degenerate panel
      // (search: `!c.nutrition`) plus no serving carrying a usable weight
      // (search: `servingOptions.length === 0`). Both halves are required.
      // Measured on the box 2026-08-15: 3,472 of 24,124 `FatSecretFood` rows
      // have an empty panel, all 3,472 also have no weighed serving, and NO row
      // has one condition without the other — so the conjunction costs nothing
      // and buys a guarantee. It excludes the 291 rows that are all-macro-zero
      // WITH a weighed serving: bottled water and Coke Zero really are 0/0/0/0,
      // and a rule that "recovered" those would overwrite a correct panel. That
      // is the refutation §3 of the search-lane report records in full.
      //
      // WHAT MOVES AND WHAT DOES NOT. `nutritionPer100g` and the
      // `portionEstimated` flag, and nothing else. `servingOptions` is left
      // exactly as it was — for this class that is the fabricated metric set
      // deriveServingOptions() builds from an empty unit list (`100 g`, `1 oz`,
      // …), NOT an empty array, and NOT the record's own serving the way the
      // search lane now substitutes it. Deliberate: the mapper's `grams` already
      // carries the portion on the parse wire, and every mobile call site
      // re-injects metric options unconditionally, so changing this list is a
      // client-visible portion change rather than part of this defect. The
      // fabricated portion for these records is a REAL and separate defect,
      // still open on this lane. Re-derive the population:
      //   SELECT count(*) FROM "FatSecretFood" WHERE "nutrientsPer100g"::text = '{}';
      if (units.length === 0 && isDegenerateNutrition(nutritionPer100g)) {
        const recovered = recoverMacroOnlyServing(
          flattenPersistedServings(fsFood.servings, fsFood.defaultServingId),
        );
        if (recovered) {
          nutritionPer100g = {
            kcal100: recovered.per100.kcal,
            protein100: recovered.per100.protein,
            carbs100: recovered.per100.carbs,
            fat100: recovered.per100.fat,
            // Omitted rather than zeroed by the recovery when the serving is
            // silent about a micro — a manufactured zero is the defect being
            // fixed. Fibre stays NULL when the serving row is silent (the wire
            // rule in ResolvedNutritionPer100g); sugar and sodium keep today's 0
            // fallback, the same shape and deliberately not this change.
            // `sugars` is the recovery's key; `sodium` arrives already converted
            // mg -> g, matching the panel branch above.
            fiber100: recovered.per100.fiber ?? null,
            sugar100: recovered.per100.sugars ?? 0,
            sodium100: recovered.per100.sodium ?? 0,
          };
          portionEstimated = true;
          portionProvenance = portionProvenanceForTier(recovered.tier);
        }
      }

      rawServingOptions = deriveServingOptions({
        units,
        densityGml: null,
        categoryId: null
      });
    }
  } else {
    // AI generated food details lookup
    const aiFood = await prisma.aiGeneratedFood.findUnique({
      where: { id: foodId },
      include: { servings: true }
    });
    if (aiFood) {
      name = aiFood.displayName;
      brandName = null;
      source = 'ai_estimated';
      nutritionPer100g = {
        kcal100: aiFood.caloriesPer100g,
        protein100: aiFood.proteinPer100g,
        carbs100: aiFood.carbsPer100g,
        fat100: aiFood.fatPer100g,
        // `fiberPer100g` is `Float? @default(0)`: 0 of 241 rows are null today
        // (measured 2026-09-05; re-derive: SELECT count(*) FILTER (WHERE
        // "fiberPer100g" IS NULL), count(*) FROM "AiGeneratedFood";), so this
        // is inert until a writer stores null — and then it is the rule.
        fiber100: aiFood.fiberPer100g ?? null,
        sugar100: aiFood.sugarPer100g ?? 0,
        // THE ONLY BRANCH THAT CONVERTS, because it is the only store holding
        // milligrams — the column name says so and is accurate; the bug was the
        // unconverted assignment, which put mg on a grams-denominated wire field
        // and made `sodium100` mean two different things 1000x apart depending on
        // `source`. Measured on the box 2026-08-15: 213 rows, min 0, max 1200,
        // mean 427.5 — and 1200 is arithmetically impossible as grams per 100 g,
        // which is the falsifier that settles which unit the column holds.
        // Re-derive: SELECT max("sodiumMgPer100g") FROM "AiGeneratedFood";
        // The column is NOT renamed: it is correct about what it stores, and a
        // rename is a migration. See ResolvedNutritionPer100g for the contract.
        sodium100: (aiFood.sodiumMgPer100g ?? 0) / 1000,
      };
      
      const units = aiFood.servings.map(s => ({
        label: s.label,
        grams: s.grams
      }));
      rawServingOptions = deriveServingOptions({
        units,
        densityGml: null,
        categoryId: null
      });
    }
  }

  // Convert raw serving options to rich serving options
  let hasDefault = false;
  const servingOptions = rawServingOptions.map((o) => {
    const isMatched = matchedServingDescription && o.label.toLowerCase().trim() === matchedServingDescription.toLowerCase().trim();
    if (isMatched) hasDefault = true;
    return {
      label: o.label,
      grams: o.grams,
      type: getServingType(o.label),
      isDefault: !!isMatched,
    };
  });

  // No description matched: prefer the record's own label serving (the FS
  // `defaultServingId` row / OFF's parsed `servingGrams` row), and only when
  // the store names none fall to the first option — index 0 is Prisma's
  // arbitrary row order plus our appended metric set, not a claim by the food.
  // The pointer must agree on label AND grams: see `labelServing`'s comment.
  if (!hasDefault && servingOptions.length > 0) {
    const pointer = labelServing;
    const labelIdx = pointer
      ? servingOptions.findIndex(
          o =>
            o.label.toLowerCase().trim() === pointer.label.toLowerCase().trim() &&
            Math.abs(o.grams - pointer.grams) < 0.01,
        )
      : -1;
    servingOptions[labelIdx >= 0 ? labelIdx : 0].isDefault = true;
  }

  return {
    name,
    brandName,
    source: source as 'fatsecret' | 'fdc' | 'openfoodfacts' | 'ai_estimated',
    nutritionPer100g,
    servingOptions,
    // OMITTED, not `false`, when the weight behind nutritionPer100g is real —
    // the #314 convention, so every response an existing caller already gets
    // stays byte-identical and no client can read a new key as a claim.
    ...(portionEstimated ? { portionEstimated: true as const } : {}),
    // Same convention: omitted, never null, when the resolver has no tier to read.
    ...(portionProvenance ? { portionProvenance } : {}),
  };
}
