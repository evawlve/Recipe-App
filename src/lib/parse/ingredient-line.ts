import { parseQuantityTokens } from './quantity';
import { normalizeUnitToken, convertUnit } from './unit';
import { extractQualifiers, extractQualifiersFromParentheses } from './qualifiers';
import { extractUnitHint } from './unit-hint';
import { isDigitBrandToken, matchDigitBrandTokens } from '../mapping/digit-brands';
import { detectBrandInQuery } from '../mapping/brand-detector';
import { isIdentityWholePhrase } from '../mapping/normalization-rules';

/**
 * Flavor/product words that mark "rocket" as part of a branded product name
 * (e.g. "rocket pop", a red-white-and-blue popsicle flavor) rather than the
 * British produce term for arugula.
 */
const ROCKET_FLAVOR_ADJACENT = new Set([
  'pop', 'pops', 'popsicle', 'popsicles', 'freeze', 'fuel', 'blast', 'candy',
]);

/**
 * Apply the British "rocket" -> "arugula" produce synonym, guarded against
 * branded/flavor contexts. Returns the line unchanged when the query names a
 * known brand (the whole line is a product name, not produce), and keeps
 * "rocket <flavor-word>" intact ("rocket pop"). Genuine produce phrasing
 * ("rocket salad", "wild rocket", "rocket leaves") is rewritten as before.
 */
export function guardedRocketToArugula(text: string): string {
  if (!/\brocket\b/i.test(text)) return text;
  // A brand anywhere in the line means "rocket" is almost certainly a product
  // or flavor name, not the salad green — leave it untouched.
  if (detectBrandInQuery(text).isBranded) return text;
  return text.replace(/\brocket\b(\s+([a-z]+))?/gi, (match, _spaceWord, nextWord) => {
    if (nextWord && ROCKET_FLAVOR_ADJACENT.has(nextWord.toLowerCase())) {
      return match; // "rocket pop"/"rocket popsicle" flavor — keep as-is
    }
    // Preserve whatever trailing word/space the regex captured after "rocket".
    return 'arugula' + match.slice('rocket'.length);
  });
}

export type ParsedIngredient = {
  qty: number;
  multiplier: number;
  unit?: string | null;
  rawUnit?: string | null;
  name: string;
  notes?: string | null;
  qualifiers?: string[];
  unitHint?: string | null;
  isEstimatedQuantity?: boolean;  // True when qty is AI-estimated (e.g., "to taste" -> 1 tsp)
};

function resolvePackageMultipliers(line: string): string {
  // Pattern to match: qty1 [delimiter] ( qty2 unit ) [package_type]
  // e.g. 1/2 (12 oz) package, 2 x 15-ounce cans, 3 (4 oz) containers, 2 15 oz cans
  //
  // TWO GUARDS, both load-bearing — removing either one reopens a live defect:
  //
  //   (a) `(?:\s*[-x×*(]\s*|\s+)` — the qty1/qty2 separator is REQUIRED. It used to
  //       be `\s*[-x×*(\s]?\s*`, fully optional, so a single contiguous number was
  //       split against itself: "100" became qty1="10" x qty2="0" = 0.
  //
  //   (b) the trailing `\b` after the container alternation. Without it, `can`
  //       matched the first three letters of `canned`/`cantaloupe`/`candy`/`canola`,
  //       `bag` matched `baguette`, `box` matched `boxed`, `bottle` matched
  //       `bottled`, `tub` matched `tube`.
  //
  // Together they billed silently wrong. "100g canned tuna in water" parsed as
  // { qty: 0, unit: null, name: "gned tuna in water" } — a garbage name that
  // poisons deriveMustHaveTokens, plus qty 0 that starves serving selection.
  // Live examples: "150g cantaloupe" -> "gtaloupe", "100g candy" -> "gdy",
  // "340g bottled water" -> "gd water", "30g packet oatmeal" -> 0 g.
  //
  // Each guard alone is insufficient: (a) alone still corrupts "100g cans of tuna";
  // (b) alone still corrupts "2 15 oz canned tomatoes". Keep both.
  const packageRegex = /\b(\d+(?:\s+(?:and\s+)?\d+\/\d+|\/\d+|\.\d+)?)(?:\s*[-x×*(]\s*|\s+)(\d+(?:\/\d+|\.\d+)?)\s*-?(oz|ounce|ounces|g|gram|grams|ml|milliliter|milliliters|floz|fl\s*oz|fluid\s*oz|fluid\s*ounces?|lb|lbs|pound|pounds|kg|kilogram|kilograms)\b(?:\s*\))?\s*(?:cans|can|packages|package|containers|container|pouches|pouch|boxes|box|bags|bag|bottles|bottle|packets|packet|envelopes|envelope|sachets|sachet|jars|jar|tubs|tub|cartons|carton)\b/gi;

  return line.replace(packageRegex, (match, qty1Str, qty2Str, unit) => {
    const qty1 = parseFraction(qty1Str);
    if (qty1 === 1) {
      return match; // Do not resolve if quantity is 1 to preserve package count structure (e.g. 1 (14 oz) can)
    }
    const qty2 = parseFraction(qty2Str);
    const product = qty1 * qty2;
    const formattedProduct = Number(product.toFixed(3));
    return `${formattedProduct} ${unit}`;
  });
}

function parseFraction(str: string): number {
  const trimmed = str.trim().toLowerCase();
  if (trimmed.includes('and')) {
    const parts = trimmed.split(/\s+and\s+/);
    return parseFraction(parts[0]) + parseFraction(parts[1]);
  }
  if (trimmed.includes(' ') && trimmed.includes('/')) {
    const parts = trimmed.split(/\s+/);
    return parseFraction(parts[0]) + parseFraction(parts[1]);
  }
  if (trimmed.includes('/')) {
    const parts = trimmed.split('/');
    const num = parseFloat(parts[0]);
    const den = parseFloat(parts[1]);
    if (!isNaN(num) && !isNaN(den) && den !== 0) {
      return num / den;
    }
  }
  const parsed = parseFloat(trimmed);
  return isNaN(parsed) ? 1 : parsed;
}

/**
 * Tokens classified as count units that are really HINTS about the food, not
 * portions ("3 egg whites" — `white` describes the egg, it is not a measure).
 *
 * Hoisted to module scope because `parseIngredientLine()` consumes count units
 * at THREE separate sites and two of them carried byte-identical private copies
 * of this list. A hint added to one copy and not the other silently changes
 * behaviour depending on which site a given line happens to reach.
 */
const POSSIBLE_UNIT_HINTS = [
  'cloves', 'clove', 'leaves', 'leaf', 'yolks', 'yolk',
  'whites', 'white', 'sheets', 'sheet', 'stalks', 'stalk',
];

// `egg` leading a unit-less line is almost always an ADJECTIVE naming a
// product ("egg noodles", "egg salad sandwich", "egg drop soup"), not a count
// of eggs: 16 of the 17 `egg `-leading corpus seeds are adjectival, and eating
// the word bills ~50 g whatever the food is AND drops `egg` from the derived
// cache key ("egg salad sandwich" -> key "salad sandwich"). Same defect shape
// as `whole` (#242), commoner word. The EXCEPTION is the egg-part lines
// ("egg whites", "egg yolk"): there the count-unit reading is load-bearing —
// extractUnitHint()'s egg-scoped 'white'/'yolk' gates rebuild name='egg' from
// the consumed unit, and suppressing it would push those lines into the
// token-side white-hint path that produces the "pasteurized egg whites" ->
// "pasteurized white" misroute (a separate, unfixed mechanism). The denylist
// is exactly the egg-part subset of POSSIBLE_UNIT_HINTS, kept a separate
// const: the hint list also carries cloves/leaves/etc., which must NOT exempt.
// Owner: sync-docs/reports/2026-08-09_egg-is-eaten-as-a-count-unit.md.
const EGG_PART_TOKENS = new Set(['white', 'whites', 'yolk', 'yolks']);
function leadingEggIsAdjectival(mergedTokens: string[]): boolean {
  if (mergedTokens.length < 2) return false;           // bare "egg"/"eggs" keep the count reading
  const t0 = mergedTokens[0].toLowerCase();
  if (t0 !== 'egg' && t0 !== 'eggs') return false;     // an explicit qty ("2 eggs", "3 egg whites")
                                                       // puts a number at [0] -> unaffected
  return !EGG_PART_TOKENS.has(mergedTokens[1].toLowerCase());
}

// Leading hedge words that a prose log puts IN FRONT of the quantity: "about 1
// cup of egg whites", "roughly 2 tbsp olive oil", "like 3 eggs". Every arm of
// parseQuantityTokens() reads tokens[0], so a hedge at [0] costs the line its
// quantity AND its unit (name becomes "about 1 cup of"), and the mapper then
// spends a `parse` model call to recover what the line already said.
//
// The strip is POSITIONAL and NUMBER-GATED: only mergedTokens[0], and only when
// the owner (parseQuantityTokens) recognises the rest as opening with a
// quantity. That keeps "about time seasoning" (no number follows) and every
// food whose name merely contains one of these words intact, and it keeps
// `roughly` in QUALIFIERS for "roughly chopped" — no number follows, so the
// strip never sees it. Not a numeric regex: the owner decides what a quantity
// is (word numbers, fractions, ranges), so the two cannot drift apart.
//
// Lives here, not in quantity.ts: parseQuantityTokens() has a second consumer
// (build-fatsecret-result.ts runs it on FatSecret serving descriptions) that
// must not learn to swallow leading words.
// Owner: mobile sync-docs/reports/2026-08-17_the-prose-log-is-clean-at-the-split-and-lost-at-the-portion.md §2.
const LEADING_HEDGES = new Set([
  'about', 'around', 'roughly', 'approximately', 'approx',
  'nearly', 'almost', 'like', 'maybe',
]);
function leadingHedgePrecedesQuantity(mergedTokens: string[]): boolean {
  if (mergedTokens.length < 2) return false;
  if (!LEADING_HEDGES.has(mergedTokens[0].toLowerCase())) return false;
  return parseQuantityTokens(mergedTokens.slice(1)) !== null;
}

// The partitive "of" in "<portion> of <food>" belongs to the MEASURE, not to
// the food: once the unit token is consumed the "of" is a leftover that lands
// at the front of `parsed.name`. That name is the search query
// (preflightIngredientLine -> normalizeIngredientName -> gatherCandidates) AND
// the input to canonicalizeCacheKey(), which sorts and singularises with no
// stopword list — so the stray token survives into the FoodMapping key and
// forks the cache ("of bacon" -> key "bacon of", a different row from "bacon").
// It also breaks preflight's zero-calorie fast path, a whole-string
// ZERO_CALORIE_INGREDIENTS.includes(baseName) test: "1 cup of water" arrives as
// "of water" and misses it.
//
// Two guards, both load-bearing:
//   - AT MOST ONE. A single non-looping skip, so "1 cup of cream of wheat"
//     keeps the food's own "of" ("cream of wheat", not "cream wheat").
//   - ONLY WITH A FOLLOWER. "2 slices of" is a truncated line with no food in
//     it; skipping there would empty the name and change what the line means.
//
// Hoisted because parseIngredientLine() consumes units at several independent
// sites and only two of them carried this skip inline — the same
// copy-drift shape as POSSIBLE_UNIT_HINTS above.
function consumePartitiveOf(tokens: string[], i: number): number {
  if (i >= tokens.length) return i;
  if (tokens[i].toLowerCase() !== 'of') return i;
  if (i + 1 >= tokens.length) return i;   // "2 slices of" — nothing follows
  return i + 1;
}

// Indefinite article standing in for the quantity: "a slice of texas toast",
// "a handful of almonds", "an ounce of cheese". Every arm of
// parseQuantityTokens() reads tokens[0] and none of them reads a bare article,
// so the article costs the line its unit exactly as a leading hedge did — the
// unit is demoted to a unitHint (or left in the name outright) and the name
// comes back as "a of texas toast".
//
// Same POSITIONAL + OWNER-GATED discipline as leadingHedgePrecedesQuantity
// above: only mergedTokens[0], and only when the unit table (normalizeUnitToken,
// the owner of what a measure word is) recognises what follows as a real
// portion. That keeps "a couple of eggs" (couple is not a unit — quantity.ts
// owns that line and reads it as 2) and every food merely containing the word.
// Deliberately NOT global: "half a cup of rice" puts the article at [1], and
// that shape is a separate documented limitation (see leading-hedge-strip.test.ts).
//
// Unlike the hedge strip this REMOVES the token rather than advancing `i`: the
// three decide-once reads below (wholeIsIdentity, eggIsAdjectival,
// startsWithUnit) all read mergedTokens[0] literally, and the whole point here
// is that they must see the UNIT. Once they do, startsWithUnit turns true and
// the partitive skip already living in that branch handles the "of" for free.
/**
 * The number words `parseQuantityTokens()` reads as quantities. Restated here
 * rather than exported from quantity.ts on purpose: this guard must fire on
 * exactly the tokens that function would consume, so the two lists being
 * separate is the bug, not the design. Kept in sync by
 * `word-number-brand.test.ts`, which asserts the intersection directly.
 */
const QUANTITY_WORD_NUMBERS = new Set([
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'dozen', 'couple',
]);

/**
 * Returns how many tokens starting at `startIdx` form a detected MULTI-token
 * brand whose first token is a quantity word (0 when none do) — the "five
 * guys" / "two good" / "six star" class.
 *
 * `detectedBrand` is the line-level detection, passed in rather than re-run:
 * the lexicon already knows these brands, so the only question here is whether
 * the brand it found actually STARTS at `startIdx` and opens with the number
 * word. A single-token brand can never qualify, which is what leaves the
 * genuine count in `one bar birthday cake` alone.
 */
function matchWordNumberBrandTokens(
  tokens: string[],
  startIdx: number,
  detectedBrand: string | null
): number {
  if (!detectedBrand || startIdx >= tokens.length) return 0;
  const brandTokens = detectedBrand.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (brandTokens.length < 2) return 0;
  if (!QUANTITY_WORD_NUMBERS.has(brandTokens[0])) return 0;
  if (startIdx + brandTokens.length > tokens.length) return 0;
  for (let k = 0; k < brandTokens.length; k++) {
    if (tokens[startIdx + k].toLowerCase() !== brandTokens[k]) return 0;
  }
  return brandTokens.length;
}

/**
 * The unit-map members that name a PART of a plant or animal rather than a
 * container or a portion. Every one of them is an ordinary noun that can open
 * a product name — `crown royal`, `breast`, `strip steak` — which containers
 * (`can`, `bottle`, `scoop`, `bar`) are not: nobody sells a product called
 * "Scoop Something".
 *
 * That asymmetry is why P1(c) below is scoped to this list. A leading `scoop`
 * on a brand-led line ("scoop optimum nutrition whey") really is a measure and
 * must keep parsing as one; a leading `crown` ("crown royal") is the whisky.
 */
const PRODUCE_ANATOMY_UNITS = new Set([
  'bunch', 'bunches', 'head', 'heads', 'stalk', 'stalks', 'sprig', 'sprigs',
  'clove', 'cloves', 'leaf', 'leaves', 'ear', 'ears', 'rib', 'ribs',
  'bulb', 'bulbs', 'crown', 'crowns', 'floret', 'florets', 'strip', 'strips',
  'breast', 'breasts', 'thigh', 'thighs',
]);

const LEADING_ARTICLES = new Set(['a', 'an']);
function leadingArticlePrecedesUnit(mergedTokens: string[]): boolean {
  if (mergedTokens.length < 2) return false;
  if (!LEADING_ARTICLES.has(mergedTokens[0].toLowerCase())) return false;
  const next = normalizeUnitToken(mergedTokens[1]);
  return next.kind === 'mass' || next.kind === 'volume' || next.kind === 'count';
}

export function parseIngredientLine(line: string): ParsedIngredient | null {
  if (!line || line.trim().length === 0) return null;

  // Pre-process package multipliers (e.g. "1/2 (12 oz) package" -> "6 oz")
  const processedLine = resolvePackageMultipliers(line);

  // Handle non-ingredient noise: separators, emojis, etc.
  const trimmed = processedLine.trim();
  if (trimmed === '---' || trimmed === '---' || trimmed.match(/^[-=]{3,}$/)) {
    return null; // Separator line
  }

  // Handle "to taste" specially for spices/seasonings - default to 1 tsp
  // This provides a reasonable nutritional estimate while flagging as estimated
  const isToTaste = trimmed.toLowerCase().includes('to taste');
  if (isToTaste) {
    // Extract ingredient name: remove "to taste", commas, and any leading qty patterns
    const cleaned = trimmed
      .replace(/,?\s*to taste/i, '')         // Remove "to taste"
      .replace(/^\d+[\s\/\.]*\d*\s*/, '')    // Remove leading numbers like "1 1" or "1.5"
      .trim();

    if (cleaned.length > 0) {
      return {
        qty: 1,
        multiplier: 1,
        unit: 'tsp',
        rawUnit: 'tsp',
        name: cleaned,
        notes: 'to taste (estimated as 1 tsp)',
        qualifiers: undefined,
        unitHint: null,
        isEstimatedQuantity: true,
      };
    }
    return null;
  }


  // Normalize unicode spaces (thin space, non-breaking space, etc.) to regular spaces
  // This handles cases like "2 ½" where there might be a thin space
  let normalizedLine = processedLine
    .replace(/\u2009/g, ' ') // thin space
    .replace(/\u00A0/g, ' ') // non-breaking space
    .replace(/\u2000/g, ' ') // en quad
    .replace(/\u2001/g, ' ') // em quad
    .trim();

  // Strip dimension patterns like 5", 7", 3/4" from ingredient names
  // These are physical size descriptors (e.g., "1 5" long sweet potato" means "1 five-inch-long sweet potato")
  // The dimension itself is not the food - "sweet potato" is the food
  // Pattern: number (optionally with fraction) followed by " or '
  // Examples: 5", 7", 3/4", 1/2", 10"
  normalizedLine = normalizedLine
    .replace(/\b\d+(?:\/\d+)?['"]\s*/g, '') // Remove "5" ", "3/4" ", etc.
    .replace(/\b\d+(?:\.\d+)?['"]\s*/g, '') // Remove "5.5" ", etc.
    .trim();

  // Tokenize the line (split on whitespace, but also separate commas, parentheses, and handle "x" multipliers)
  // This handles "1 cup, packed" -> ["1", "cup", ",", "packed"]
  // Also handles "2x200g" -> ["2", "x", "200g"] and "2 x 200g" -> ["2", "x", "200", "g"]
  // Normalize "x" multipliers: "2x200" or "2 x 200" -> "2 x 200"
  // Also handle "2x200g" -> "2 x 200g" (we'll split the number+unit later)
  // Separate parentheses: "1 (14 oz)" -> "1 ( 14 oz )"
  // IMPORTANT: Handle parentheses carefully to avoid splitting "oz)" incorrectly
  // Strategy: separate parentheses first, then split number+unit on remaining tokens

  // === NEW: Handle compound volume unit patterns like "5 floz" or "8 fl oz" ===
  // These need to be recognized as a single quantity+unit, not "qty=1" + "name=5 floz..."
  // Pattern: when we see "1 5 floz ...", the "5 floz" is the actual measure, "1" is serving count
  // Convert "N floz" -> join as compound for later parsing
  // Also normalize "fl oz" -> "floz" and "fl. oz" -> "floz"
  let unitNormalized = normalizedLine
    .replace(/\bfl\.?\s*oz\b/gi, 'floz')  // Normalize "fl oz" and "fl. oz" to "floz"
    .replace(/\bfluid\s+oz\b/gi, 'floz')  // Normalize "fluid oz" to "floz"
    .replace(/\bfluid\s+ounces?\b/gi, 'floz'); // Normalize "fluid ounce(s)" to "floz"

  // === NEW: Fix "1 5 floz serving X" pattern ===
  // When we have "N N unit serving", the first N is a recipe serving count, not ingredient qty
  // Pattern: "1 5 floz serving" -> strip the leading "1" to get "5 floz serving"
  // Also handles: "1 8 oz serving", "2 4 tbsp", etc.
  const servingCountPattern = /^(\d+)\s+(\d+(?:\.\d+)?)\s+(floz|oz|ml|cup|cups|tbsp|tsp|g|lb|lbs)\s+serving\b/i;
  const servingMatch = unitNormalized.match(servingCountPattern);
  if (servingMatch) {
    // Strip the leading serving count, keep the actual quantity+unit
    unitNormalized = unitNormalized.replace(servingCountPattern, '$2 $3');
  }

  // === NEW: British to American term normalization ===
  unitNormalized = unitNormalized
    .replace(/\btinned\b/gi, 'canned')     // British "tinned" -> American "canned"
    .replace(/\bcourgettes?\b/gi, 'zucchini')  // British "courgette(s)" -> American "zucchini"
    .replace(/\baubergines?\b/gi, 'eggplant')  // British "aubergine(s)" -> American "eggplant"
    // NOTE: rocket -> arugula is handled by guardedRocketToArugula() below so it
    // never fires inside a branded/flavor name ("bucked up rocket pop ...").
    .replace(/\bcoriander\b/gi, 'cilantro')
    .replace(/\bspring onions?\b/gi, 'green onion')  // British "spring onion(s)" -> American
    // Synonym: "calorie free" → "sugar free" (many products labeled as sugar free, not calorie free)
    .replace(/\bcalorie[- ]free\b/gi, 'sugar free');

  // rocket -> arugula (British produce term), context-guarded. The bare synonym
  // mis-fired inside branded flavor names: "bucked up rocket pop pre workout"
  // became "...arugula pop..." and then matched an "Arugula Lettuce" record.
  // Skip the rewrite when the line names a known brand, or when "rocket" is
  // immediately followed by a flavor/product word ("rocket pop"/"popsicle").
  // Genuine produce ("rocket salad", "wild rocket", "rocket leaves") is kept.
  unitNormalized = guardedRocketToArugula(unitNormalized);

  // === NEW: Spelling corrections for common misspellings ===
  // These would otherwise return 0 API results and fail with 0.00 confidence
  unitNormalized = unitNormalized
    .replace(/\bcanellini\b/gi, 'cannellini')   // "Canellini" → "Cannellini" (double-n)
    .replace(/\bchick\s+peas?\b/gi, 'chickpeas') // "chick pea(s)" → "chickpeas"
    .replace(/\bchilli\b/gi, 'chili')            // British "chilli" → American "chili"
    .replace(/\bjalape[nñ]o\b/gi, 'jalapeno');   // Accent variants → unaccented

  // === NEW: Compound word normalization ===
  // Some ingredients are written as one word but APIs expect two words
  unitNormalized = unitNormalized
    .replace(/\bsnowpeas?\b/gi, 'snow peas')         // "snowpeas" → "snow peas"
    .replace(/\bsugarsnaps?\b/gi, 'sugar snap peas')  // "sugarsnap" → "sugar snap peas"
    .replace(/\bmustardpowder\b/gi, 'mustard powder'); // "mustardpowder" → "mustard powder"

  // === NEW: Brand name → generic ingredient synonyms ===
  // Brand names that don't exist in FatSecret/FDC search results
  unitNormalized = unitNormalized
    .replace(/\bswerve\b/gi, 'erythritol sweetener')  // Swerve → erythritol sweetener
    .replace(/\bsplenda\b/gi, 'sucralose sweetener');  // Splenda → sucralose sweetener

  // === NEW: Normalize "juice/zest from N fruit" → "N fruit juice/zest" ===
  // Common recipe phrasing: "1 juice from 1 lemon" → "1 lemon juice"
  // Also handles: "juice from 2 limes", "zest from 1 orange", "juice of 1 lemon"
  // Pattern: (optional qty) (juice|zest) (from|of) (qty) (fruit name) → (qty) (fruit) (juice|zest)
  unitNormalized = unitNormalized
    .replace(/^(\d*\s*)(juice|zest)\s+(?:from|of)\s+(\d+)\s+(.+)$/i,
      (_, _leadingQty, type, fruitQty, fruit) => `${fruitQty} ${fruit.trim()} ${type}`)
    .trim();

  // === NEW: Strip "or N unit" alternative measurement patterns ===
  // Recipes sometimes offer alternatives: "1 tsp or 1 packet dry mustard"
  // The "or N unit" part is an alternative the cook can choose, not part of the ingredient name
  // Pattern: "or N unit" where unit is a measurement word
  unitNormalized = unitNormalized
    .replace(/\s+or\s+\d+(?:\.\d+)?\s+(?:packet|packets|package|packages|serving|servings|piece|pieces|envelope|envelopes|sachet|sachets|stick|sticks|tsp|tbsp|cup|cups|oz|g|ml|lb|lbs)\b/gi, '')
    .trim();

  // === NEW: Strip alternative measurement noise appended after a dash ===
  // Recipes sometimes include alternative measures like "2 cup water - 1 to 2 cups"
  // or cooking instructions like "1 tbsp parmesan - per serving sprinkle..."
  // Strip everything from " - " onwards when it looks like a range or instruction
  unitNormalized = unitNormalized
    // " - N to N unit" pattern → alternative quantity range (e.g. "- 1 to 2 cups")
    .replace(/\s+-\s+\d[\d\s\/]*to\s+\d[^,]*/gi, '')
    // " - N unit ..." pattern → single alternative (e.g. "- 1 teaspoon basil")
    .replace(/\s+-\s+\d+\s+(?:teaspoon|tablespoon|tsp|tbsp|cup|oz|g|ml)[^\w]*.*/gi, '')
    // " -per serving..." and other instruction fragments
    .replace(/\s+-\s*per\s+serving.*/gi, '')
    .trim();

  let preprocessed = unitNormalized
    .replace(/(\d+)\s*[x×]\s*(\d+[a-z]*)/gi, '$1 x $2') // Normalize "2x200" or "2x200g" or "2 x 200g" to "2 x 200g"
    .replace(/\(/g, ' ( ') // Separate opening parentheses
    .replace(/\)/g, ' ) ') // Separate closing parentheses
    .replace(/,/g, ' , ') // Separate commas
    .split(/\s+/)
    .filter(t => t.length > 0);

  // Post-process: split number+unit tokens (but preserve parentheses as separate tokens)
  const tokens: string[] = [];
  for (const token of preprocessed) {
    // Skip parentheses and commas - they're already separated
    if (token === '(' || token === ')' || token === ',') {
      tokens.push(token);
    } else {
      // Check if token is like "200g" (number+unit) — but NOT a digit-leading
      // brand token ("7up"): splitting that would turn the brand's digit into
      // a quantity ("7up" -> 7 x "up").
      const match = token.match(/^(\d+(?:\.\d+)?)([a-z]+)$/i);
      if (match && !isDigitBrandToken(token)) {
        tokens.push(match[1]); // number
        tokens.push(match[2]); // unit
      } else {
        tokens.push(token);
      }
    }
  }

  // Merge compound units like "fl" + "oz" → "floz", "fluid" + "ounce" → "floz"
  // This must happen before unit parsing
  const COMPOUND_UNITS: Array<{ parts: string[]; merged: string }> = [
    { parts: ['fl', 'oz'], merged: 'floz' },
    { parts: ['fluid', 'ounce'], merged: 'floz' },
    { parts: ['fluid', 'ounces'], merged: 'floz' },
  ];

  const mergedTokens: string[] = [];
  for (let j = 0; j < tokens.length; j++) {
    let merged = false;
    for (const compound of COMPOUND_UNITS) {
      if (j + compound.parts.length - 1 < tokens.length) {
        const match = compound.parts.every(
          (part, k) => tokens[j + k].toLowerCase() === part
        );
        if (match) {
          mergedTokens.push(compound.merged);
          j += compound.parts.length - 1; // Skip the merged tokens (loop will increment j)
          merged = true;
          break;
        }
      }
    }
    if (!merged) {
      mergedTokens.push(tokens[j]);
    }
  }


  if (mergedTokens.length === 0) return null;

  // Positional leading-article strip (see leadingArticlePrecedesUnit above).
  // Must run BEFORE the decide-once reads of mergedTokens[0] below, and must
  // remove the token rather than advance `i`, so those reads see the unit.
  if (leadingArticlePrecedesUnit(mergedTokens)) {
    mergedTokens.shift();
  }

  let i = 0;
  let qty = 1; // Default quantity
  // True only when parseQuantityTokens actually consumed a quantity token —
  // NOT when qty merely holds its default of 1. The unknown-unit partitive
  // inference below is gated on this: "<qty> <unknown> of <food>" is a measure
  // signal, but on a quantity-less line the leading token is the food's own
  // first word ("chicken of the sea" -> name "the sea", "cream of mushroom
  // soup" -> name "mushroom soup") and consuming it destroys identity.
  let hadExplicitQty = false;

  // Positional leading-hedge strip (see leadingHedgePrecedesQuantity above):
  // advance past "about"/"roughly"/... when a quantity follows, so the line
  // parses exactly as its un-hedged form. The three decide-once reads of
  // mergedTokens[0] below (wholeIsIdentity, eggIsAdjectival, startsWithUnit)
  // are unaffected: on a stripped line [0] is the hedge, on the un-hedged form
  // [0] is the quantity token, and none of the three recognises either.
  if (leadingHedgePrecedesQuantity(mergedTokens)) {
    i = 1;
  }

  // Check if first token is a unit (e.g., "pinch of salt")
  // If so, we'll use default qty of 1
  // `whole` is classified as a count unit (alongside small/medium/large) so that
  // "1 whole banana" routes to the AI weight estimator. On a UNIT-LESS identity
  // line that is wrong: "whole milk" loses the word entirely, so it never reaches
  // extractQualifiers() and derives the same cache key as bare "milk".
  //
  // Decide once, here, and have ALL THREE consumption sites below honour it:
  // the `startsWithUnit` branch, the `kind === 'count'` branch, and the
  // after-parentheses check. They consume count units independently, so guarding
  // any subset leaves the defect intact — and the third is the one that actually
  // fires here, because it is gated on `!unit` and therefore reached precisely
  // when the first two decline. Measured while building this: guarding only the
  // first two left `whole milk` completely unchanged.
  // ---------------------------------------------------------------------------
  // A BRAND-LED LINE IS A PRODUCT NAME, NOT A RECIPE INGREDIENT.
  //
  // Every heuristic in this file was written for recipe prose, where a leading
  // word-number is a count and a word like `boneless`/`fresh`/`chunk` says how
  // the cook prepared the food. On a product name none of that holds: the
  // tokens ARE the identity. `zaxbys boneless wings` is a menu item, not wings
  // that happen to be boneless, and stripping the word deletes the only thing
  // separating it from `zaxbys traditional wings`.
  //
  // Decided ONCE here, on the same contract as wholeIsIdentity/eggIsAdjectival
  // below, and honoured at every recipe-ingredient site further down. Measured
  // 2026-08-26 on the 4,102-line coverage corpus: 1,770 lines are brand-led,
  // 46 of them lose an identity token today (44 to the qualifier/hint strips,
  // 2 to a count-unit consumption) and 11 lose their brand's own first token
  // to the word-number quantity parse.
  //
  // Deliberately gated on DETECTION, not on hasDecisiveBrandContext(): 21 of
  // the 44 are single-token brands and therefore never decisive, and they
  // include most of the chain rows this exists to fix (zaxbys, wingstop,
  // mcdonalds, hooters, dominos). Measured cost of the looser gate on a
  // 30-line genuine-recipe control set: 2 fire (`jumbo shrimp`, `fresh
  // sprouts`), both on a single-token junk lexicon entry, and both outcomes
  // are benign — the kept word is true of the food. Lexicon precision is
  // brand-detector work, not a reason to narrow this gate past its own rows.
  const brandDetection = detectBrandInQuery(normalizedLine);
  const brandLed = !!brandDetection.matchedBrand;

  const wholeIsIdentity =
    mergedTokens.length > 0 &&
    mergedTokens[0].toLowerCase() === 'whole' &&
    isIdentityWholePhrase(mergedTokens.join(' '));
  // Same decide-once/honour-at-all-three-sites contract as wholeIsIdentity,
  // for a leading adjectival `egg`/`eggs` (see leadingEggIsAdjectival above).
  const eggIsAdjectival = leadingEggIsAdjectival(mergedTokens);

  // P1(c). A leading produce-anatomy word on a brand-led line is the product's
  // first token, not a measure: `crown royal` parsed to unit=crown / name=royal
  // and billed a crown of broccoli's weight against the whisky. The partitive
  // `of` is the exemption, because it marks a genuine measure explicitly
  // ("crown of broccoli", "leaf of basil") — and the scope is deliberately the
  // anatomy list only, so containers keep measuring. Fires on 2 of the 4,102
  // corpus lines (`crown royal`, `crown royal peach`), measured 2026-08-26.
  const leadingIsBrandedAnatomy =
    brandLed &&
    mergedTokens.length > 1 &&
    PRODUCE_ANATOMY_UNITS.has(mergedTokens[0].toLowerCase()) &&
    mergedTokens[1].toLowerCase() !== 'of';

  let startsWithUnit = false;
  if (mergedTokens.length > 0 && !wholeIsIdentity && !eggIsAdjectival && !leadingIsBrandedAnatomy) {
    const firstToken = mergedTokens[0];
    const firstNormalized = normalizeUnitToken(firstToken);
    if (firstNormalized.kind === 'mass' || firstNormalized.kind === 'volume' || firstNormalized.kind === 'count') {
      startsWithUnit = true;
    }
  }

  // Digit-leading brand guard ("7up", "7 up", "5 hour energy", "3 musketeers"):
  // when the line STARTS with a known digit-leading brand, the digits are part
  // of the food name — skip quantity extraction entirely (qty stays 1) and let
  // the brand tokens flow into the name. An explicit count before the brand
  // still parses normally ("2 7up" -> qty 2 of "7up"), because then the brand
  // no longer sits at the quantity position.
  const startsWithDigitBrand = matchDigitBrandTokens(mergedTokens, i) > 0;

  // Word-number-leading brand guard ("five guys", "two good", "six star"): the
  // same defect as the digit guard above, one spelling over. WORD_NUMBERS in
  // parseQuantityTokens() reads `five guys little cheeseburger` as 5 of
  // `guys little cheeseburger`, which then bills 5x the wrong record (1,135 g
  // / 1,169 kcal of Fries, Little, measured 2026-08-25).
  //
  // Only a MULTI-token brand qualifies, and that is what keeps the genuine
  // counts parsing: `one bar birthday cake` (n-brand-02) matches the
  // single-token lexicon entry `one` and is excluded by construction, while
  // `two eggs` / `three slices of bacon` match no brand at all. Fires on
  // exactly 11 of the 4,102 corpus lines (five guys x7, two good x3, six star
  // x1), measured 2026-08-26 — each one a brand whose first token IS the
  // number word. Not a digit-brands.ts list addition: the lexicon already
  // knows all three, and the defect is that the quantity parse runs first.
  const startsWithWordNumberBrand =
    matchWordNumberBrandTokens(mergedTokens, i, brandDetection.matchedBrand) > 0;

  // Parse quantity (if not starting with a unit, or with a brand whose own
  // first token looks like a quantity)
  if (!startsWithUnit && !startsWithDigitBrand && !startsWithWordNumberBrand) {
    const qtyResult = parseQuantityTokens(mergedTokens.slice(i));
    if (qtyResult) {
      qty = qtyResult.qty;
      i += qtyResult.consumed;
      hadExplicitQty = true;
    }
    // If no quantity found, default to qty=1 and continue parsing
    // This handles cases like "egg" or "butter" from FatSecret API
  }

  // Parse unit and multiplier
  let unit: string | null = null;
  let rawUnit: string | null = null;
  let multiplier = 1;

  // Check for "x" multiplier pattern: "2 x 200g" or "2x200g" (already normalized to "2 x 200")
  // Pattern: qty "x" number unit
  if (i < mergedTokens.length && mergedTokens[i].toLowerCase() === 'x') {
    // We have a quantity followed by "x", check if next token is a number
    if (i + 1 < mergedTokens.length) {
      const nextToken = mergedTokens[i + 1];
      const nextNum = parseFloat(nextToken);
      if (!isNaN(nextNum) && nextNum > 0) {
        // Found "qty x number", the number is the multiplier
        multiplier = nextNum;
        i += 2; // Consume "x" and the number

        // Check if there's a unit after the multiplier (e.g., "2 x 200g")
        if (i < mergedTokens.length) {
          const unitToken = mergedTokens[i];
          const unitNormalized = normalizeUnitToken(unitToken);
          if (unitNormalized.kind === 'mass' || unitNormalized.kind === 'volume') {
            unit = unitNormalized.unit;
            rawUnit = unitToken;
            if (i + 1 < mergedTokens.length) {
              i++; // Consume the unit
            }
            i = consumePartitiveOf(mergedTokens, i); // "2 x 200 g of flour"
          }
        }
      }
    }
  }

  // Check first token for multiplier or unit (if we haven't already handled "x" multiplier)
  // Also handle case where we start with a unit (e.g., "pinch of salt")
  // Skip parentheses when looking for units
  while (i < mergedTokens.length && multiplier === 1 && (mergedTokens[i] === '(' || mergedTokens[i] === ')')) {
    i++; // Skip parentheses
  }

  if (i < mergedTokens.length && multiplier === 1) {
    const firstToken = mergedTokens[i];
    const firstNormalized = normalizeUnitToken(firstToken);

    // If we started with a unit, consume it now
    if (startsWithUnit && (firstNormalized.kind === 'mass' || firstNormalized.kind === 'volume' || firstNormalized.kind === 'count')) {
      unit = firstNormalized.unit;
      rawUnit = firstToken;
      i++; // Consume the unit

      // Skip "of" if present (e.g., "pinch of salt", "a slice of texas toast"
      // once the leading article is gone). This site already had the skip
      // inline; consumePartitiveOf is that same code, now shared.
      i = consumePartitiveOf(mergedTokens, i);
    } else if (firstNormalized.kind === 'multiplier') {
      multiplier *= firstNormalized.factor;
      i++;

      // Look for unit in next mergedTokens (up to 2 more mergedTokens)
      for (let j = 0; j < 2 && i + j < mergedTokens.length; j++) {
        const token = mergedTokens[i + j];
        const normalized = normalizeUnitToken(token);
        if (normalized.kind === 'mass' || normalized.kind === 'volume' || normalized.kind === 'count') {
          unit = normalized.unit;
          rawUnit = token;
          // Only consume the unit token if it's not the last token (to preserve compound names)
          if (i + j + 1 < mergedTokens.length) {
            i = i + j + 1;
          }
          break;
        }
      }
      // "1 half of onion" (no unit found) and "1 half cup of milk" (unit found)
      // both leave the partitive at `i`.
      i = consumePartitiveOf(mergedTokens, i);
    } else if (firstNormalized.kind === 'mass' || firstNormalized.kind === 'volume') {
      // Only process if we didn't already handle it as a starting unit
      if (!startsWithUnit || i > 0) {
        unit = firstNormalized.unit;
        rawUnit = firstToken;
        // Only consume the unit token if it's not the last token (to preserve compound names)
        if (i + 1 < mergedTokens.length) {
          i++;
        }
        i = consumePartitiveOf(mergedTokens, i); // "1 cup of milk", "4 oz of chicken breast"
      }
    } else if (firstNormalized.kind === 'count') {
      // For count units like "piece", "slice", "scoop", consume them as units
      // But we'll check later if they're actually unit hints (like "leaves", "cloves")
      // First check if it's a unit hint - if so, don't consume as unit
      const lowerToken = firstToken.toLowerCase();
      if (POSSIBLE_UNIT_HINTS.includes(lowerToken)
          || (lowerToken === 'whole' && wholeIsIdentity)
          || ((lowerToken === 'egg' || lowerToken === 'eggs') && eggIsAdjectival)
          || (i === 0 && leadingIsBrandedAnatomy)) {
        // Don't consume - it's a unit hint, `whole` acting as identity
        // ("whole milk"), or an adjectival `egg` ("egg noodles") — not a
        // portion. See wholeIsIdentity above: this is the SECOND branch that
        // consumes count units, and it is the one a unit-less line actually
        // reaches once startsWithUnit has been suppressed.
        //
        // A hint word can still take a partitive ("2 cloves of garlic" ->
        // name "of garlic", which canonicalises to the live forked key
        // "garlic of"). `i` cannot be advanced past the "of" here — the hint
        // token stays in the name on purpose, because extractUnitHint() is what
        // pulls it back out. So drop the "of" from the stream instead and leave
        // the hint word exactly where that owner expects it. Same two guards:
        // consumePartitiveOf decides, this only acts on its answer.
        if (consumePartitiveOf(mergedTokens, i + 1) > i + 1) {
          mergedTokens.splice(i + 1, 1);
        }
      } else {
        unit = firstNormalized.unit;
        rawUnit = firstToken;
        // Consume count units - we'll handle unit hints separately in name tokens
        if (i + 1 < mergedTokens.length) {
          i++;
        }
        i = consumePartitiveOf(mergedTokens, i); // "three slices of bacon", "1 sprig of rosemary"
      }
    } else if (firstNormalized.kind === 'unknown') {
      // Unknown tokens are normally left in the name (e.g. "5 romaine leaves" —
      // "romaine" is not a unit). BUT a partitive "of" is a reliable signal that
      // the unknown token IS a measure word: "1 knob of butter", "3 rashers of
      // bacon". In that case consume it as the (unknown) unit so serving
      // resolution routes it to AI estimation (isAmbiguousUnit now covers
      // unrecognised units) instead of swallowing the portion into the name.
      // Without a following "of" we keep the old name-token behavior.
      //
      // ONLY when an explicit quantity preceded (hadExplicitQty). The signal is
      // "<qty> <token> of" as a whole; on a quantity-less line "<token> of" is
      // just a food name that contains "of", and consuming the token eats the
      // food's identity: "chicken of the sea" parsed to name "the sea" and
      // "cream of mushroom soup" to name "mushroom soup" until this guard.
      const nextIsOf = hadExplicitQty
        && i + 1 < mergedTokens.length && mergedTokens[i + 1].toLowerCase() === 'of';
      if (nextIsOf) {
        unit = firstNormalized.raw;
        rawUnit = firstToken;
        i += 2; // consume the unknown unit token and the "of"
      }
    }
  }

  // Check for compound ingredients like "0.25 cup & 1 tbsp"
  // Must convert the second part to the first unit and add to qty
  if (unit && i < mergedTokens.length) {
    const connector = mergedTokens[i].toLowerCase();
    if (connector === '&' || connector === '+' || connector === 'and' || connector === 'plus') {
      // SAME-UNIT FRACTIONAL CONTINUATION: "a scoop and a half of whey".
      //
      // The compound branch below handles "<qty> <unit> and <qty> <OTHER unit>"
      // — it requires a mass/volume unit after the second quantity, and calls
      // parseQuantityTokens() on tokens that here begin with an article it
      // never reads. So BOTH of its preconditions fail on this phrasing, and
      // the connector tokens then fell through into the NAME: measured on
      // 2026-08-26, `a scoop and a half of whey protein` parsed to qty 1,
      // unit scoop, name `and a half of whey protein` — under-billing by a
      // third AND corrupting the retrieval string. Diego reported it from the
      // device as "a scoop and a half bills one scoop".
      //
      // "and a half" / "and a quarter" after a unit continues the SAME unit, so
      // there is no conversion to do: add the fraction and consume. Anchored on
      // the optional article + an explicit fraction word so it cannot swallow a
      // genuine second ingredient ("rice and a banana" — `banana` is not a
      // fraction word, so this declines and the branch below runs unchanged).
      const fracIdx = mergedTokens[i + 1]?.toLowerCase() === 'a' ? i + 2 : i + 1;
      const SAME_UNIT_FRACTIONS: Record<string, number> = {
        half: 0.5, quarter: 0.25, third: 1 / 3,
      };
      const sameUnitFraction = SAME_UNIT_FRACTIONS[mergedTokens[fracIdx]?.toLowerCase() ?? ''];
      if (sameUnitFraction !== undefined) {
        qty += sameUnitFraction;
        i = fracIdx + 1;
        // "of" after the fraction is partitive ("and a half OF whey"), not a name token.
        if (mergedTokens[i]?.toLowerCase() === 'of') i++;
      } else {

      // Look ahead for another quantity and unit
      const lookaheadTokens = mergedTokens.slice(i + 1);
      const nextQtyResult = parseQuantityTokens(lookaheadTokens);

      if (nextQtyResult && nextQtyResult.qty > 0) {
        const consumed = nextQtyResult.consumed;
        // Check for unit after the quantity
        if (i + 1 + consumed < mergedTokens.length) {
          const nextUnitToken = mergedTokens[i + 1 + consumed];
          const nextUnitNorm = normalizeUnitToken(nextUnitToken);

          if (nextUnitNorm.kind === 'mass' || nextUnitNorm.kind === 'volume') {
            // Try to convert
            const converted = convertUnit(nextQtyResult.qty, nextUnitToken, unit);
            if (converted !== null) {
              qty += converted;
              // Consume the connector, qty, and unit mergedTokens
              i += 1 + consumed + 1;

              // Skip "of" if present after the second unit
              if (i < mergedTokens.length && mergedTokens[i].toLowerCase() === 'of') {
                i++;
              }
            }
          }
        }
      }
      }
    }
  }

  // After processing units, skip any remaining parentheses before name mergedTokens
  // Also check if there's a unit after parentheses (e.g., "1 (14 oz) can tomatoes")
  while (i < mergedTokens.length && (mergedTokens[i] === '(' || mergedTokens[i] === ')')) {
    i++;
  }

  // Check if there's a unit right after parentheses (e.g., "can" in "1 (14 oz) can tomatoes")
  if (i < mergedTokens.length && !unit) {
    const afterParenToken = mergedTokens[i];
    const afterParenNormalized = normalizeUnitToken(afterParenToken);
    if (afterParenNormalized.kind === 'mass' || afterParenNormalized.kind === 'volume' || afterParenNormalized.kind === 'count') {
      // Check if it's not a unit hint
      const lowerToken = afterParenToken.toLowerCase();
      // THIRD count-unit consumption site. It is guarded on `!unit`, so it is
      // reached precisely when the two branches above declined — which makes it
      // the one that actually fires for a unit-less identity line.
      // leadingIsBrandedAnatomy is honoured HERE as well as at startsWithUnit,
      // for the reason the wholeIsIdentity comment above records: this site is
      // gated on `!unit`, so it fires precisely when the first branch declined
      // — guarding only the first leaves the defect fully intact.
      if (!POSSIBLE_UNIT_HINTS.includes(lowerToken)
          && !(lowerToken === 'whole' && wholeIsIdentity)
          && !((lowerToken === 'egg' || lowerToken === 'eggs') && eggIsAdjectival)
          && !(i === 0 && leadingIsBrandedAnatomy)) {
        unit = afterParenNormalized.unit;
        rawUnit = afterParenToken;
        i++; // Consume the unit
        i = consumePartitiveOf(mergedTokens, i);
      }
    }
  }

  // Remaining mergedTokens are the name (may contain qualifiers, unit hints, parentheses, commas)
  // Filter out standalone commas and parentheses (they're handled separately)
  let nameTokens = mergedTokens.slice(i).filter(t => t !== ',' && t !== '(' && t !== ')');

  // Special case: if no name tokens but we have a count unit (like "egg" or "eggs"),
  // use the raw unit as the name since it IS the ingredient
  if (nameTokens.length === 0 && unit && rawUnit) {
    nameTokens = [rawUnit];
  }

  if (nameTokens.length === 0) return null;

  // Join tokens and handle commas (e.g., "cilantro, finely chopped" or "1 cup, packed, brown sugar")
  const fullNameText = nameTokens.join(' ');

  // Extract qualifiers from parentheses first (e.g., "onion (diced)")
  const parenQualifiers = extractQualifiersFromParentheses(fullNameText);

  // Remove parentheses content from text for further processing
  let nameWithoutParens = fullNameText.replace(/\([^)]+\)/g, '').trim();

  // Handle comma-separated qualifiers (e.g., "cilantro, finely chopped" or "1 cup, packed, brown sugar")
  // Split by commas and identify qualifiers in later parts
  const commaParts = nameWithoutParens.split(',').map(p => p.trim()).filter(p => p.length > 0);
  let coreNamePart = commaParts[0] || '';
  const commaQualifiers: string[] = [];

  // Check parts after the first comma for qualifiers
  for (let j = 1; j < commaParts.length; j++) {
    const part = commaParts[j];
    const partTokens = part.split(/\s+/).filter(t => t.length > 0);
    const { qualifiers: partQualifiers, remainingTokens: partRemaining } = extractQualifiers(partTokens);

    if (partQualifiers.length > 0) {
      // This part contains qualifiers, add them
      commaQualifiers.push(...partQualifiers);
      // If there's remaining text, it might be part of the name (e.g., "brown sugar" in "1 cup, packed, brown sugar")
      if (partRemaining.length > 0) {
        coreNamePart += ' ' + partRemaining.join(' ');
      }
    } else {
      // No qualifiers found, treat as part of the name
      coreNamePart += ' ' + part;
    }
  }

  // Extract qualifiers from the core name part tokens
  // P1(a). On a brand-led line the qualifier strip is suppressed: `boneless`,
  // `fresh`, `frozen`, `shredded`, `large`, `short`, `jumbo` are the product's
  // own words there, and removing them is what turns `zaxbys boneless wings`
  // into `zaxbys wings` and `pure leaf iced tea` into `pure iced tea` — the
  // second deleting half the BRAND. See the brandLed read above for the
  // measured population and the false-positive cost.
  //
  // Scope note: the parenthetical and comma-part qualifier paths above are
  // deliberately NOT gated. A writer who set a word aside in `(...)` or after
  // a comma marked it as an aside themselves, and neither path appears in the
  // 46-line measured population.
  const coreTokens = coreNamePart.split(/\s+/).filter(t => t.length > 0);
  const { qualifiers: extractedQualifiers, remainingTokens } = brandLed
    ? { qualifiers: [] as string[], remainingTokens: coreTokens }
    : extractQualifiers(coreTokens);

  // Extract unit hint (e.g., "egg yolks" -> unitHint: "yolk", name: "egg")
  // This should happen after qualifier extraction
  // Pass the parsed unit as context: in "3 egg whites", "egg" was consumed as
  // a count unit above, so the egg-scoped 'white' gate needs it as context.
  // P1(b). Same reasoning as the qualifier strip: `chunk`, `piece`, `leaf`
  // and `stalk` are identity on a product name (`bumble bee chunk light
  // tuna`, `mcdonalds 10 piece chicken mcnuggets`, `pure leaf sweet tea`).
  const hintResult = brandLed
    ? { unitHint: null, coreName: remainingTokens.join(' ') }
    : extractUnitHint(
      remainingTokens,
      [unit, rawUnit].filter((t): t is string => typeof t === 'string' && t.length > 0)
    );
  const unitHint = hintResult.unitHint;
  let finalRemainingTokens = hintResult.coreName.split(/\s+/).filter(t => t.length > 0);

  // If we found a unit hint and we had a count unit that matches, clear the unit
  // (e.g., "1 piece bread" keeps unit="piece", but "5 romaine leaves" should have unitHint="leaf", no unit)
  if (unitHint && unit) {
    // If the unit hint matches a count unit pattern, clear the unit
    const hintToUnitMap: Record<string, string> = {
      'leaf': 'piece',
      'clove': 'piece',
      'sheet': 'piece',
      'stalk': 'piece',
      'slice': 'slice',
      'piece': 'piece'
    };
    if (hintToUnitMap[unitHint] === unit) {
      // The unit was actually a hint, clear it
      unit = null;
      rawUnit = null;
    }
  }

  // Combine all qualifiers: parentheses, comma-separated, and extracted
  const allQualifiers = [...parenQualifiers, ...commaQualifiers, ...extractedQualifiers];

  // Final name is the core name (after removing qualifiers and unit hints)
  const name = finalRemainingTokens.join(' ').trim();
  if (!name) return null;

  return {
    qty,
    multiplier,
    unit: unit || null,
    rawUnit: rawUnit || null,
    name,
    notes: null,
    qualifiers: allQualifiers.length > 0 ? allQualifiers : undefined,
    unitHint: unitHint || null
  };
}
