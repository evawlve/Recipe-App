/**
 * Ambiguous Serving Estimator
 * 
 * Estimates weight for ambiguous units (container, scoop, bowl, etc.)
 * that don't have standard weights.
 * 
 * Uses AI to estimate the typical weight based on product type and context.
 */

import {
    FATSECRET_CACHE_AI_ENABLED,
    FATSECRET_CACHE_AI_BACKFILL_CONFIDENCE_MIN,
} from '../mapping/config';
import { callStructuredLlm } from './structured-client';
import { getFdcServingWeight } from '../fdc/fdc-servings';
import { logger } from '../logger';

// Units that are inherently ambiguous and require AI estimation
export const AMBIGUOUS_UNITS = new Set([
    'container', 'containers',
    'scoop', 'scoops',
    'bowl', 'bowls',
    'handful', 'handfuls',
    'packet', 'packets',
    'package', 'packages',    // "1 package spinach"
    'envelope', 'envelopes',
    'can', 'cans',
    'jar', 'jars',
    'bottle', 'bottles',
    'carton', 'cartons',
    'tub', 'tubs',
    'box', 'boxes',
    'bag', 'bags',
    'pouch', 'pouches',
    // Eggs: API often returns 100g/egg instead of actual ~50g
    'egg', 'eggs',
    // Stock/bouillon cubes: API inconsistently uses dry vs prepared liquid weights
    'cube', 'cubes',
    // Count units: "18 piece olives", "14 mango chunks" — 100g default is wrong
    'piece', 'pieces', 'pc', 'pcs',
    'chunk', 'chunks',
    'each',
    // Size descriptors for whole produce (when no serving data exists)
    'mini', 'medium', 'large', 'small', 'whole',
    // Whole-produce units (head of cabbage, lettuce, etc.)
    'head', 'heads',
    // Bunch units (bunch of spinach, herbs, etc.)
    'bunch', 'bunches',
    // Discrete count units (meat parts, baked goods, slices)
    'breast', 'breasts', 'thigh', 'thighs', 'wing', 'wings', 'fillet', 'fillets',
    'roll', 'rolls', 'tortilla', 'tortillas', 'biscuit', 'biscuits',
    'patty', 'patties', 'slice', 'slices',
    // Sub-piece units that vary wildly by food (e.g., strips of bacon = 12g, strips of pepper = 10g)
    'strip', 'strips',
    // Spray/squirt units (for cooking spray, oil sprays)
    'spray', 'sprays', 'squirt', 'squirts',
    // Micro-volume units (inherently subjective, AI-route preferred)
    'splash', 'splashes',
    'drizzle', 'drizzles',
    'dollop', 'dollops',
]);

// Unit-specific weight sanity floors (Cluster A pt2 Defect 4, Jul 2026).
// A "handful" or "bowl" is inherently a multi-piece/portion quantity — an
// estimate (or poisoned cached serving) below these is a per-piece weight in
// disguise ("handful of almonds" = 1.2g) and must not be served.
export const UNIT_MIN_GRAMS: Record<string, number> = {
    handful: 10, handfuls: 10,
    bowl: 25, bowls: 25,
    plate: 50, plates: 50,
    // Discrete-piece nouns (count-noun sibling routing, Track 3 Jul 2026):
    // a cached "bar" of 1.5g is a poisoned per-nut weight in disguise
    // (barebells 1.5g class) — reject it so sibling-borrow/AI re-resolve.
    // "slice" is deliberately ABSENT: genuine slices span 2g (pepperoni) to
    // 30g+ (bread), so no single floor is safe.
    bar: 15, bars: 15,
    patty: 15, patties: 15,
    link: 10, links: 10,
    tortilla: 15, tortillas: 15,
    cookie: 4, cookies: 4,
};

/**
 * A SCOOP OF POWDER IS NOT A SCOOP OF FOOD (s459 pd-sc). `UNIT_MAX_GRAMS.scoop`
 * below is calibrated on protein powder (30-35 g, competition scoops 45 g), but
 * it was applied to every food: an ice-cream / mashed-potato / rice / casserole
 * scoop is a disher or serving-spoon portion, and the estimator's own answer for
 * those was clamped to 50 g. MEASURED in the box app log 2026-07-21 -> 2026-11-15:
 * 54 of 54 `scoop` clamps were non-powder foods (ice cream 60-100 -> 50, mashed
 * potatoes 120-150 -> 50, rice 150 -> 50, cottage cheese 120-150 -> 50,
 * casseroles 150-200 -> 50) and 0 were powders.
 *
 * So the powder cap stays exactly where it was for any name that LOOKS like a
 * powder (a false positive keeps today's behaviour, the safe direction), and
 * every other name gets FOOD_SCOOP_MAX_GRAMS. The cap still exists for the
 * reason it always did: a hallucinated 400 g "scoop" must not bill.
 */
const POWDER_SCOOP_NAME_RE = /\b(protein|whey|casein|collagen|peptides?|creatine|pre[- ]?workouts?|powders?|bcaas?|eaas?|aminos?|greens|isolate|gainer|electrolytes?|supplements?|formula)\b/i;
export const POWDER_SCOOP_MAX_GRAMS = 50;
export const FOOD_SCOOP_MAX_GRAMS = 120;

/** Per-unit cap for `scoop`, by whether the food is a powder. Null for every other unit. */
export function scoopMaxGrams(unit: string, foodName: string | null | undefined): number | null {
    const u = unit.toLowerCase().trim();
    if (u !== 'scoop' && u !== 'scoops') return null;
    if (foodName == null || POWDER_SCOOP_NAME_RE.test(foodName)) return POWDER_SCOOP_MAX_GRAMS;
    return FOOD_SCOOP_MAX_GRAMS;
}

/**
 * A PACKET OF FOOD IS NOT A PACKET OF SUGAR (s461 PKT-FOOD). `UNIT_MAX_GRAMS.packet` (10 g, and
 * `envelope` 15 g) is a condiment / sweetener cap — "sweetener packet = 1g, ketchup packet = 9g max" —
 * but it clamps every food, so the estimator's own answer for a single-serve food packet is thrown
 * away. MEASURED in the box app log (`ambiguous_estimation.clamped` + the two per-unit guards,
 * 2026-10-17 -> 2026-11-17): 38 packet/envelope clamps, 25 of them on meal-sized foods, e.g. instant
 * oats 40 -> 10, ramen 85 -> 10, tuna 140 -> 10, hot cocoa 28 -> 10, crisps 30 -> 10, grits 28 -> 10,
 * almond butter 32 -> 10 (truth: an instant oatmeal packet is 28-43 g, a tuna pouch 74-85 g, a ramen
 * block 85 g; USDA FdcServing `packet` rows say the same, e.g. instant oats 28-45 g, onion soup mix
 * 39 g). The other 13 (honey, jelly, coffee, sugar, ranch, and literal packs of bacon, tortillas and
 * biscuits) keep the condiment cap below.
 *
 * So a record name that reads as a food sold in a meal-sized packet gets a food cap, by class: a
 * POUCH food (tuna, salmon, chicken, ramen / instant noodles) POUCH_PACKET_MAX_GRAMS — the model
 * reads "packet of tuna" as a 113-150 g can and "packet of chicken" as 227-500 g, and 85 g is a
 * 3 oz pouch / a Maruchan block — and a DRY single-serve food (instant oats, grits, cocoa, crisps,
 * nut butter, soup mix, ...) DRY_PACKET_MAX_GRAMS, because the model sometimes reads those as the
 * retail tin (`Milo` drew 25, 40, 44, 240 and 250 g; a sachet is 22-33 g). A name that also reads as
 * a small-dose packet (PACKET_DOSE_NAME_RE: `Chicken Bouillon`, `Ramen Seasoning`, `Coffee`) keeps
 * the condiment cap, and so does every other name, so a miss keeps today's behaviour (the safe
 * direction). A positive list on purpose: the model also answers 85 g for a `packet of jelly`
 * (truth 14 g) and 340 g for a `packet of bacon`, so "everything but condiments" would bill those.
 * The seed rung of getOrCreateAmbiguousServing() does not read this cap: a word-matched seed is a
 * piece weight (nugget, wing, cookie), never a packet, so it keeps the condiment bound there.
 * Kill-switch: SERVING_PACKET_FOOD_CAP="0" restores the condiment cap for every name (no build; the
 * service reads it at the next restart).
 */
const PACKET_UNITS = new Set(['packet', 'packets', 'sachet', 'sachets', 'envelope', 'envelopes']);
const POUCH_PACKET_NAME_RE = /\b(?:tuna|salmon|chicken|sardines?|ramen|noodles?|applesauce)\b/i;
const DRY_PACKET_NAME_RE = /\b(?:oats?|oatmeal|porridge|grits|cream of wheat|farina|cocoa|hot chocolate|milo|ovaltine|chips|crisps|crackers?|pretzels?|popcorn|fruit snacks?|gummies|trail mix|nuts|almonds|peanuts|cashews|(?:peanut|almond|cashew|nut|sunflower(?: seed)?) butter|jerky|protein|gels?|soup)\b/i;
const PACKET_DOSE_NAME_RE = /\b(?:seasonings?|bouillon|broth|stock|gravy|flavou?rings?|dressing|creamer|coffee)\b/i;
export const POUCH_PACKET_MAX_GRAMS = 85;
export const DRY_PACKET_MAX_GRAMS = 45;

/** Per-unit cap for a packet-like unit on a food record. Null for every other unit or name (the unit cap applies). */
export function packetMaxGrams(unit: string, foodName: string | null | undefined): number | null {
    const u = unit.toLowerCase().trim();
    if (!PACKET_UNITS.has(u) || foodName == null) return null;
    if (process.env.SERVING_PACKET_FOOD_CAP === '0') return null;
    if (PACKET_DOSE_NAME_RE.test(foodName)) return null;
    if (POUCH_PACKET_NAME_RE.test(foodName)) return POUCH_PACKET_MAX_GRAMS;
    if (DRY_PACKET_NAME_RE.test(foodName)) return DRY_PACKET_MAX_GRAMS;
    return null;
}

/**
 * Sanity bounds for an ambiguous unit's per-unit grams; either side may be undefined.
 * `foodName` moves only the `scoop` cap (scoopMaxGrams) and the packet-like caps (packetMaxGrams);
 * omitted, it reads as before.
 */
export function getAmbiguousUnitBounds(unit: string, foodName?: string | null): { min?: number; max?: number } {
    const u = unit.toLowerCase().trim();
    return {
        min: UNIT_MIN_GRAMS[u],
        max: (foodName != null ? scoopMaxGrams(u, foodName) ?? packetMaxGrams(u, foodName) : null) ?? UNIT_MAX_GRAMS[u],
    };
}

// Unit-specific weight sanity caps (safety net for AI hallucinations).
// These prevent catastrophic misestimates like 100g/spray or 86g/scoop.
// Module scope so getAmbiguousUnitBounds can validate cached servings too.
const UNIT_MAX_GRAMS: Record<string, number> = {
    // Micro-units: these should NEVER exceed a few grams
    spray: 2, sprays: 2, squirt: 5, squirts: 5,
    dash: 1, pinch: 0.5,
    // True micro-volume units (drops of hot sauce, liquid stevia)
    drop: 0.5, drops: 0.5,
    // Cooking spray duration (0.4 second = ~0.25g oil)
    second: 1, seconds: 1,
    // Packet-like units: sweetener packet = 1g, ketchup packet = 9g max
    packet: 10, packets: 10,
    sachet: 10, sachets: 10, envelope: 15, envelopes: 15,
    // Scoops: protein powder scoops are 30-35g max, competition scoops up to 45g
    scoop: 50, scoops: 50,
    // Pieces/strips/chunks/breasts: reasonable max for cut produce/meat
    piece: 200, pieces: 200, strip: 50, strips: 50, chunk: 50, chunks: 50,
    breast: 300, breasts: 300, thigh: 200, thighs: 200,
    // Discrete-piece nouns (count-noun sibling routing, Track 3 Jul 2026):
    // caps reject package-scale cached rows (a 340g "bar" is a multipack).
    bar: 150, bars: 150,
    patty: 250, patties: 250,
    link: 100, links: 100,
    tortilla: 120, tortillas: 120,
    cookie: 100, cookies: 100,
};

export interface AmbiguousServingRequest {
    foodName: string;
    brandName?: string | null;
    unit: string;
    foodType?: string | null;
}

export interface AmbiguousServingResult {
    status: 'success' | 'error';
    estimatedGrams?: number;
    confidence?: number;
    reasoning?: string;
    error?: string;
}

export const RESPONSE_SCHEMA = {
    name: 'ambiguous_serving_estimate',
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            estimatedGrams: { type: 'number' },
            confidence: { type: 'number' },
            reasoning: { type: 'string' },
            error: { type: ['string', 'null'] },
        },
        required: ['estimatedGrams', 'confidence', 'reasoning', 'error'],
    },
    strict: true,
};

const SYSTEM_PROMPT = [
    'You are a nutrition assistant that estimates serving sizes for ambiguous units.',
    'Given a food item and an ambiguous unit (like "container" or "scoop"), estimate the typical weight in grams.',
    'Consider common retail packaging sizes and typical serving patterns.',
    'Return your estimate with a confidence score (0-1) and brief reasoning.',
    'If you cannot make a reasonable estimate, return an error message.',
].join(' ');

// Deterministic units with EXACT conversions (mass, volume, dimensionless
// serving/portion) — these must NEVER be routed to AI estimation.
const DETERMINISTIC_UNITS = new Set([
    // mass
    'g', 'gram', 'grams', 'kg', 'kilogram', 'kilograms', 'oz', 'ounce', 'ounces',
    'lb', 'lbs', 'pound', 'pounds', 'mg', 'milligram', 'milligrams',
    // volume
    'cup', 'cups', 'c', 'tbsp', 'tablespoon', 'tablespoons', 'tbs',
    'tsp', 'teaspoon', 'teaspoons',
    'ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres',
    'l', 'liter', 'liters', 'litre', 'litres',
    'floz', 'fl oz', 'fluid ounce', 'fluid ounces',
    'pint', 'pints', 'quart', 'quarts', 'gallon', 'gallons',
    // dimensionless — already grams or a canonical serving
    'serving', 'servings', 'portion', 'portions',
]);

/**
 * A unit is "estimable-unknown" when it needs weight estimation but is NOT in
 * the curated AMBIGUOUS_UNITS set: a real, word-like unit token we've never
 * catalogued — e.g. "knob", "rasher", "glug", "sleeve", "ramekin", "floret".
 *
 * This is what makes the ambiguous-unit vocabulary self-extending: instead of a
 * frozen allowlist where any unseen unit silently falls back to a wrong flat
 * 100g default, an unrecognised unit routes to AI estimation (which is capped
 * and cached per food+unit, so the grams get learned once and reused forever).
 *
 * Excluded: deterministic mass/volume units (exact conversions), blank/numeric
 * tokens, and anything that doesn't look like a unit word (letters, optional
 * single internal space/hyphen, 2–20 chars).
 */
export function isEstimableUnknownUnit(unit: string | null | undefined): boolean {
    if (!unit) return false;
    const u = unit.toLowerCase().trim();
    if (!u) return false;
    if (AMBIGUOUS_UNITS.has(u)) return false;      // handled by the curated fast-path
    if (DETERMINISTIC_UNITS.has(u)) return false;  // exact conversion — never estimate
    if (/\d/.test(u)) return false;                // numeric tokens aren't units
    return /^[a-z][a-z .-]{1,19}$/.test(u);        // word-like unit only
}

/**
 * Checks if a unit requires AI weight estimation — either an explicitly
 * curated ambiguous unit OR an unrecognised (but word-like) unit. The curated
 * set is now a fast-path; unknown units are handled dynamically.
 */
export function isAmbiguousUnit(unit: string): boolean {
    const u = unit.toLowerCase().trim();
    return AMBIGUOUS_UNITS.has(u) || isEstimableUnknownUnit(u);
}

/**
 * The category words this lexicon reads that name an ingredient a PACKAGE ADVERTISES THE ABSENCE
 * OF. That property, not "is a modifier", is what makes the misread possible — and getting the
 * predicate this narrow is the whole point of the fix.
 *
 * "sugar free coke" is not sugar; "lactose free milk" IS still milk. Both are a category word
 * inside a modifier phrase, and only the first is a misread. So the rule *"a category detector
 * must never take its category from inside a modifier phrase"* is TOO WIDE — applied literally it
 * suppresses `lactose free milk` (240 g), `gluten free flour` (120 g), `fat free cheese` (28 g),
 * `caffeine free coke` (355 g), `unsweetened almond milk` (240 g), `low sodium bacon` (28 g) and
 * `light corn syrup` (14 g), every one of which is CORRECT today and live in traffic (measured
 * 2026-09-07 by calling this function on each). The defensible rule is the narrow one:
 *
 *     a category word that names an ingredient the phrase says is ABSENT is not that query's
 *     category.
 *
 * Membership is therefore a claim about the WORD, not about the phrase, and it is set by whether
 * the trade sells "<word>-free" versions of things that are not <word>. Measured over the live
 * lexicon (2026-09-07): `sugar` is the punch's case; `salt` fires the same way (`no salt added`
 * -> 2.5 g, the spice rule); `oil` and `butter` are constructible (`no oil added` and `butter free
 * popcorn` both -> 14 g, the condiment rule). Nothing else in the 17 rules has the property.
 * Adding a word here is a deliberate widening and is pinned by the tests.
 */
const ABSENCE_ADVERTISED_CATEGORY_WORDS = ['sugar', 'salt', 'oil', 'butter'] as const;

/**
 * The absence frames, BOTH DIRECTIONS — because the misread runs both ways and a lookahead alone
 * catches only one of them. Measured over the 12 misread lines (2026-09-07): the FOLLOWED shape
 * (`sugar free coke`) is 2 lines and the PRECEDED shape (`pepsi zero sugar`, `no sugar added
 * applesauce`) is 4, so a lookahead-only fix — the idiom this file already uses for `sugar snap`
 * and `honey nut` — reaches 3 of 12 lines and 3 of 46 events. Lookbehind is where the mass is.
 */
const ABSENCE_FRAMES: ReadonlyArray<(w: string) => RegExp> = [
    // FOLLOWED: "sugar free", "sugar-free", "sugarfree", "sugar less"
    w => new RegExp(`\\b${w}[\\s-]?(?:free|less)\\b`, 'gi'),
    // PRECEDED: "no sugar", "no added sugar", "zero sugar", "without sugar", "less sugar",
    // "reduced sugar", "low sugar", "0 sugar"
    w => new RegExp(`\\b(?:no|zero|0|without|less|reduced|low)\\s+(?:added\\s+)?${w}\\b`, 'gi'),
];

/**
 * Blank out any ABSENCE_ADVERTISED_CATEGORY_WORDS occurrence that sits inside an absence frame,
 * so getBareQueryDefault() cannot read a category out of a claim that the ingredient is NOT there.
 *
 * QUERY SIDE ONLY, and the asymmetry is measured rather than stylistic. getBareQueryDefault() is
 * also called on the matched RECORD's name — `applyOffBareQueryGuard()`'s REPLACE path is
 * `queryDefault ?? getBareQueryDefault(foodName)` — and masking there makes one live line WORSE:
 * `trident spearmint gum` carries no `sugar` token at all, takes its 4 g from the record name
 * "Sugar Free Spearmint Gum", and 4 g is ~2 sticks of gum, i.e. very nearly right. Suppress it and
 * the line falls to the flat 100 g default: ~262 kcal for chewing gum. That is DNB-9's lesson read
 * backwards (`reports/2026-08-05_serving-fix-build-order.md`): the counterfactual for a rule that
 * STOPS firing is not "nothing", it is whatever the rungs below it bill instead. So the record-name
 * fallback keeps today's behaviour, deliberately.
 *
 * WHAT IT ACTUALLY REACHES: 3 of the 12 measured misread lines, 10 of the 46 misread events.
 * NOT 6 of 12 — an earlier revision of this comment said 6 and was wrong, and the arithmetic that
 * refutes it is this function's own scoping. `applyOffBareQueryGuard()`'s REPLACE path is
 * `queryDefault ?? getBareQueryDefault(foodName)`, and on THREE of the six lines the matched
 * record's own NAME carries the absence phrase, so the unmasked fallback re-supplies the identical
 * 4 g: `pepsi zero sugar` -> "Pepsi Cola Real Sugar" / "Pepsi max maximum taste no sugar",
 * `no sugar added applesauce` -> "No Sugar Added Applesauce", `sugar free vanilla latte` ->
 * "Hot Latte Sugar Free Vanilla - Large". Those three are INERT by construction as measured
 * 2026-09-07; `pepsi zero sugar` no longer is, since its masked query reaches the beverage rule
 * (2026-10-25). The three that
 * move are the ones whose record name is clean: `sprite zero sugar` -> "Sprite Zero",
 * `zero sugar pepsi` -> "Pepsi Zero", `sugar free coke` -> "Diet Coke Caffeine Free (Can)".
 * The gate's SERVING DIFF reports exactly three GRAMS-CHANGED rows, which is the same three.
 *
 * That is a real limit, not a rounding: this fix addresses 10 of 46 misread events, and the single
 * largest misread line in the corpus (`coffee with cream and sugar`, 17 events, all organic) is a
 * different shape entirely and is untouched.
 *
 * Blanking, not deleting: the frame is replaced with spaces so every other rule still sees the
 * words around it in their original positions. One of the six fixed lines landed on the CORRECT
 * 355 g for free that way as measured 2026-09-07, and four do since the 2026-10-25 beverage-rule
 * entry, because rule 4 was only ever pre-empting rule 17 (`sugar free coke` reaches the soda rule
 * via `coke`; `sprite zero sugar`, `pepsi zero sugar` and `zero sugar pepsi` via the brand, since
 * the 2026-10-25 beverage-rule entry).
 */
export function maskAdvertisedAbsence(query: string): string {
    if (!query) return query;
    const lower = query.toLowerCase();
    let out = query;
    for (const w of ABSENCE_ADVERTISED_CATEGORY_WORDS) {
        if (!lower.includes(w)) continue;
        for (const frame of ABSENCE_FRAMES) {
            out = out.replace(frame(w), m => ' '.repeat(m.length));
        }
    }
    return out;
}

/**
 * Returns a standard serving estimate for bare queries (no unit, qty=1).
 * Prevents "Baking Flour" from defaulting to a 454g package or "Mayonnaise" to a 340g jar.
 */
export function getBareQueryDefault(foodName: string): { grams: number, description: string } | null {
    const nameStr = foodName.toLowerCase();
    
    // Spices & Extracts: 1 tsp (approx 2.5g). Guards keep the rule off queries
    // that merely CONTAIN a spice token (warm-2026-07-21 regressions): bell
    // peppers are produce, 'cinnamon roll/toast/…' are flavor names, and bare
    // 'vanilla' is a flavor word on countless products ('vanilla extract'
    // stays covered by the extract token).
    if (/\b(spice|cinnamon(?!\s*(roll|bun|toast|crunch|swirl))|nutmeg|paprika|chili powder|cumin|salt|(?<!\b(?:bell|dr|dr\.|green|yellow|orange|roasted red|sweet|mini|jalapeno|jalapeño|poblano|serrano|anaheim|fresno|cubanelle|habanero|banana|shishito|padron|padrón|scotch bonnet)\s)pepper|extract|seasoning)\b/.test(nameStr)) {
        return { grams: 2.5, description: "1 tsp (standard bare query serving)" };
    }
    
    // Peanut/nut butters: 2 tbsp (approx 32g). Must precede the condiment rule:
    // the 14g condiment default would make the inflation cap fire on peanut
    // butter's legitimate 32g label serving (32 > 2x14).
    if (/\b(peanut butter|nut butter)\b/.test(nameStr)) {
        return { grams: 32, description: "2 tbsp (standard bare query serving)" };
    }

    // Condiments & Spreads: 1 tbsp (approx 14g)
    // 'honey' carries a lookahead so cereal/product names ('honey nut
    // cheerios', 'honey bunches of oats') keep their own categories — bare
    // honey otherwise flaps on the AI size estimate (21g vs the 340g bottle,
    // eval n-serv-49 2026-07-21).
    if (/\b(mayo|mayonnaise|mustard|ketchup|relish|jam|jelly|peanut butter|butter|oil|vinegar|sauce|dressing|syrup|ghee|lard|tallow|miso|mirin|tamari|tahini|pesto|hummus|nutella|hazelnut spread|honey(?!\s+(nut|bunche?s|smacks|graham|oats?|roasted|glazed|bbq|barbecue)))\b/.test(nameStr)) {
        return { grams: 14, description: "1 tbsp (standard bare query serving)" };
    }

    // Sugars & thick sweeteners: 1 tsp (approx 4g). The lookahead keeps
    // "sugar snap peas" (produce) out.
    if (/\b(sugar(?!\s*snap)|molasses)\b/.test(nameStr)) {
        return { grams: 4, description: "1 tsp (standard bare query serving)" };
    }

    // Flours (Baking Dry): 1 cup (approx 120-200g, using 120g as standard)
    if (/\b(flour|cornstarch|baking soda|baking powder|cocoa powder)\b/.test(nameStr)) {
        if (/\b(baking soda|baking powder)\b/.test(nameStr)) return { grams: 4, description: "1 tsp (standard bare query serving)" };
        return { grams: 120, description: "1 cup (standard bare query serving)" };
    }
    
    // Cheese (cream cheese, shredded): 1 oz / 28g. Cottage/ricotta are spoon
    // foods with a ~110-125g label serving — the 28g hard-cheese default would
    // make the inflation cap clobber a correct label (warm-2026-07-21).
    if (/\b(?<!cottage\s)(?<!ricotta\s)cheese\b/.test(nameStr)) {
        return { grams: 28, description: "1 oz (standard bare query serving)" };
    }

    // Muscle Milk is an RTD can (414ml), not dairy — must precede the \bmilk\b
    // liquids rule (first-match-wins would otherwise half-fix it at 240g).
    if (/\bmuscle milk\b/.test(nameStr)) {
        return { grams: 414, description: "1 can (standard bare query serving)" };
    }

    // Liquids (milk, juice, broth): 1 cup / 240g
    if (/\b(milk|juice|broth|stock|water)\b/.test(nameStr)) {
        return { grams: 240, description: "1 cup (standard bare query serving)" };
    }

    // --- Entries below are APPENDED (first-match-wins: previously-matching
    // names above keep their outputs byte-identical) ---

    // Nuts & seeds: 1 oz (approx 28g)
    if (/\b(almond|cashew|peanut(?!\s*butter)|pecan|walnut|pistachio|macadamia|hazelnut|(sunflower|pumpkin|chia|flax|sesame|hemp) seeds?|trail mix)s?\b/.test(nameStr)) {
        return { grams: 28, description: "1 oz (standard bare query serving)" };
    }

    // Pre-workout / creatine: 1 scoop (approx 12g)
    if (/pre.?workout|creatine/.test(nameStr)) {
        return { grams: 12, description: "1 scoop (standard bare query serving)" };
    }

    // Protein & supplement powders: 1 scoop (approx 35g)
    if (/\b(protein (powder|mix|shake mix)|whey|casein|collagen|greens powder|mass gainer)\b/.test(nameStr)) {
        return { grams: 35, description: "1 scoop (standard bare query serving)" };
    }

    // Salty snacks: 1 oz (approx 28g)
    if (/\b(chips?|crisps?|crackers?|pretzels?|goldfish|popcorn|cheetos|doritos)\b/.test(nameStr)) {
        return { grams: 28, description: "1 oz (standard bare query serving)" };
    }

    // Cured / breakfast meats: 1 oz (approx 28g)
    if (/\b(bacon|sausage link|salami|pepperoni|prosciutto|jerky)\b/.test(nameStr)) {
        return { grams: 28, description: "1 oz (standard bare query serving)" };
    }

    // Cereals: ~3/4 cup (approx 40g)
    if (/\b(cereal|granola|muesli)\b/.test(nameStr)) {
        return { grams: 40, description: "3/4 cup (standard bare query serving)" };
    }

    // Oats, dry basis: 1/2 cup (approx 40g)
    if (/\b(oats|oatmeal|rolled oats)\b/.test(nameStr)) {
        return { grams: 40, description: "1/2 cup dry (standard bare query serving)" };
    }

    // Dry grains: approx 45g dry (~1/4 cup)
    if (/\b(couscous|bulgur|barley|polenta|farro)\b/.test(nameStr)) {
        return { grams: 45, description: "1/4 cup dry (standard bare query serving)" };
    }

    // Canned/bottled beverages: 1 can (approx 355g)
    // Soft-drink BRANDS that name the drink (pepsi, sprite, mountain dew, dr pepper) are members
    // since 2026-10-25: before that, a bare 'pepsi zero sugar' masked to null and the REPLACE
    // fallback billed the record name's 'sugar' (4 g; s378 §Q1). Re-derive:
    // npx jest --roots=src --testPathPattern 'category-is-not-read|pepper-variety'.
    if (/\b(cola|coke|soda|soft drink|energy drink|sports drink|kombucha|lemonade|iced tea|pepsi|sprite|mountain dew|dr\.? ?pepper)\b/.test(nameStr)) {
        return { grams: 355, description: "1 can (standard bare query serving)" };
    }

    // Half-and-half: 2 tbsp (30 g), its US label serving. Anchored to the WHOLE
    // name (optionally + creamer/cream/milk), so drinks that merely contain the
    // phrase (`twisted tea half and half`, `half and half iced tea`) are not
    // creamer and keep their earlier result. S202 row HH.
    if (/^\s*half\s*(?:and|&|n|'n'?|n'|’n’)\s*half(?:\s+(?:creamer|cream|milk))?\s*$/.test(nameStr)) {
        return { grams: 30, description: "2 tbsp (standard bare query serving)" };
    }

    // Deliberately ABSENT categories — do not add: yogurt, bars, eggs, produce,
    // whole-meat cuts. Their label/hydrated servings (or the 100g floor) are the
    // better answer; a category default here would override real label data.
    return null;
}

/**
 * Returns a serving estimate for unitless leafy greens with high counts.
 * Prevents "8 lettuce" from defaulting to 8 full heads (4000g) by assuming leaves (10-15g).
 */
export function getDiscreteLeafyGreenDefault(foodName: string, qty: number): { grams: number, description: string } | null {
    const nameStr = foodName.toLowerCase();
    if (qty > 3 && /\b(lettuce|spinach|kale|cabbage|basil|mint|cilantro|parsley)\b/.test(nameStr)) {
        // Assume smaller individual leaves or sprigs when count is high
        return { grams: 10, description: "1 leaf/sprig (assumed from high unitless count)" };
    }
    return null;
}

/**
 * Estimates the weight of an ambiguous unit using AI
 * Step 8 optimization: Try FDC servings and count defaults before LLM
 */
export async function estimateAmbiguousServing(
    request: AmbiguousServingRequest
): Promise<AmbiguousServingResult> {
    const { foodName, brandName, unit, foodType } = request;


    // Step 8: Try FDC serving lookup (uses cache)
    // CRITICAL: Skip FDC for deceptive retail containers AND single-serve packets.
    // FDC often lists full-package serving data under these labels:
    // - "package" of tofu = 140g single serving (not ~400g full block)
    // - "packet" of sweetener = 100g (the full box!) not 1g (the actual sachet)
    const skipFdcUnits = new Set([
        'package', 'packages', 'container', 'containers', 'box', 'boxes',
        'bag', 'bags', 'tub', 'tubs', 'jar', 'jars', 'can', 'cans', 'bottle', 'bottles',
        'packet', 'packets', 'sachet', 'sachets', 'envelope', 'envelopes',
    ]);
    
    if (!skipFdcUnits.has(unit.toLowerCase())) {
        try {
            const sizeFromUnit = unit.toLowerCase() as 'small' | 'medium' | 'large';
            const isSize = ['small', 'medium', 'large'].includes(sizeFromUnit);
            
            const fdcResult = await getFdcServingWeight(
                foodName,
                unit,
                isSize ? sizeFromUnit : undefined
            );

            if (fdcResult) {
                return {
                    status: 'success',
                    estimatedGrams: fdcResult.grams,
                    confidence: 0.9, // High confidence for USDA data
                    reasoning: `From USDA FDC: ${fdcResult.label}`,
                };
            }
        } catch (err) {
            // FDC lookup failed, continue to LLM
        }
    }

    // Fall back to LLM if no defaults available
    if (!FATSECRET_CACHE_AI_ENABLED) {
        return { status: 'error', error: 'AI backfill disabled' };
    }

    if (!process.env.OPENAI_API_KEY && !process.env.OPENROUTER_API_KEY) {
        return { status: 'error', error: 'No API keys configured' };
    }

    const prompt = buildPrompt(request);

    try {
        const result = await callStructuredLlm({
            schema: RESPONSE_SCHEMA,
            systemPrompt: SYSTEM_PROMPT,
            userPrompt: prompt,
            purpose: 'ambiguous',
        });

        if (result.status === 'error') {
            return { status: 'error', error: result.error ?? 'unknown error' };
        }

        const parsed = result.content as Record<string, unknown>;

        if (typeof parsed.error === 'string' && parsed.error.length > 0) {
            return { status: 'error', error: parsed.error };
        }

        const estimatedGrams = typeof parsed.estimatedGrams === 'number' ? parsed.estimatedGrams : NaN;
        const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : NaN;
        const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined;

        if (Number.isNaN(estimatedGrams) || estimatedGrams <= 0) {
            return { status: 'error', error: 'Invalid gram estimate from AI' };
        }

        if (confidence < FATSECRET_CACHE_AI_BACKFILL_CONFIDENCE_MIN) {
            return {
                status: 'error',
                error: `Low confidence (${confidence.toFixed(2)} < ${FATSECRET_CACHE_AI_BACKFILL_CONFIDENCE_MIN})`,
            };
        }

        // Novel (estimable-unknown) units have no curated cap — bound them
        // generously so a hallucinated weight can't produce absurd calories,
        // while still allowing legitimately large portions (bowl, plate, etc.).
        const GENERIC_UNKNOWN_MAX = 600;
        const maxGrams = scoopMaxGrams(unit, foodName) ?? packetMaxGrams(unit, foodName) ?? UNIT_MAX_GRAMS[unit.toLowerCase()]
            ?? (isEstimableUnknownUnit(unit) ? GENERIC_UNKNOWN_MAX : undefined);
        let clampedGrams = estimatedGrams;
        if (maxGrams && estimatedGrams > maxGrams) {
            logger.warn('ambiguous_estimation.clamped', {
                foodName, unit, originalGrams: estimatedGrams, clampedTo: maxGrams,
                reasoning,
            });
            clampedGrams = maxGrams;
        }
        // Floor guard: a portion unit estimated below its floor is a per-piece
        // weight in disguise ("handful of almonds" → 1.2g). Clamp up.
        const minGrams = UNIT_MIN_GRAMS[unit.toLowerCase()];
        if (minGrams && clampedGrams < minGrams) {
            logger.warn('ambiguous_estimation.clamped_low', {
                foodName, unit, originalGrams: estimatedGrams, clampedTo: minGrams,
                reasoning,
            });
            clampedGrams = minGrams;
        }

        return {
            status: 'success',
            estimatedGrams: clampedGrams,
            confidence,
            reasoning,
        };
    } catch (error) {
        return { status: 'error', error: (error as Error).message };
    }
}

function buildPrompt(request: AmbiguousServingRequest): string {
    const { foodName, brandName, unit, foodType } = request;

    const lines = [
        `Food: ${foodName}`,
        brandName ? `Brand: ${brandName}` : 'Brand: Generic',
        foodType ? `Type: ${foodType}` : '',
        ``,
        `Question: What is the typical weight in grams for 1 ${unit} of "${foodName}"?`,
        ``,
        `Consider:`,
        `- Common retail packaging sizes for this type of product`,
        `- Single-serve vs family-size packaging`,
        `- If the brand is specified, consider brand-specific sizing`,
        ``,
        `Example reasoning for different units:`,
        `- "container" of yogurt: Usually 5.3oz (150g) for single-serve, 16oz (453g) for larger`,
        `- "package" of tofu: Typically 14oz (400g)`,
        `- "scoop" of protein powder: Typically 30-35g`,
        `- "bowl" of cereal: About 200-300g including milk, 30-60g dry`,
        `- "handful" of nuts, chips, or snacks: About 28-40g — a handful is MANY pieces, NEVER the weight of a single piece`,
        `- "can" of soda: Usually 355ml`,
        `- "packet" of sweetener: About 1g`,
        ``,
        `For "piece" units with produce, pay attention to the variety:`,
        `- 1 piece of GRAPE tomato: ~5-8g (tiny, bite-sized)`,
        `- 1 piece of CHERRY tomato: ~10-17g (small, bite-sized)`,
        `- 1 piece of regular tomato: ~123g (medium whole fruit)`,
        `- 1 piece of olive: ~3-5g`,
        `- 1 piece of baby carrot: ~8-10g`,
        `- 1 piece of garlic clove: ~3g`,
        `- CRITICAL: "grape" and "cherry" varieties are MUCH smaller than regular produce!`,
        ``,
        `Provide your best estimate with confidence level and reasoning.`,
    ].filter(Boolean);

    return lines.join('\n');
}

// ============================================================
// Batched Produce Size Estimation (single AI call for all 3 sizes)
// ============================================================

export const PRODUCE_SIZE_RESPONSE_SCHEMA = {
    name: 'produce_size_estimates',
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            small: { type: 'number', description: 'Weight in grams for a small item' },
            medium: { type: 'number', description: 'Weight in grams for a medium item' },
            large: { type: 'number', description: 'Weight in grams for a large item' },
            confidence: { type: 'number', description: 'Confidence score 0-1' },
            reasoning: { type: 'string', description: 'Brief explanation of estimates' },
            error: { type: ['string', 'null'] },
        },
        required: ['small', 'medium', 'large', 'confidence', 'reasoning', 'error'],
    },
    strict: true,
};
