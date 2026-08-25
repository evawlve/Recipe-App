// No database import here, deliberately. This module computes the cache keys that
// AiNormalizeCache and FoodMapping are stored under; if it can read a table, the table
// can move its own keys. See the note on mergedPrepPhrases.
import fs from 'fs';
import path from 'path';
import { logger } from '../logger';

export type SynonymRewrite = {
  from: string;
  to: string;
  /**
   * Whole words that, when one of them immediately follows `from`, veto the
   * rewrite. `hamburger -> ground beef` must not fire on `hamburger bun`: the
   * rewritten query `ground beef bun` matched no bun and resolved to a
   * gpt-4o-mini stub "85% Lean 15% Fat Beef Bun" at 150 g / 270 kcal (measured
   * live on 3JD249AyleJUI2qu0ZERF, 2026-08-24). Case-insensitive like `from`;
   * absent or empty means the rule is unguarded, byte-identical to before.
   */
  unlessFollowedBy?: string[];
};

type NormalizationRules = {
  prep_phrases: string[];
  size_phrases: string[];
  synonym_rewrites: SynonymRewrite[];
};

const DEFAULT_RULES: NormalizationRules = {
  prep_phrases: [
    // Physical preparation (cutting/shaping)
    'beaten',
    'thinly',
    'parboiled',
    'bone and skin removed',
    'boneless skinless',
    'cut into [0-9]+\\s*(inch|inches|in|cm|centimeter|centimeters)\\b',
    'cut into ".+?"',
    'cut into \'.+?\'',
    'cut into .+',
    'links [0-9]+\\s*/?\\s*lb',
    // 'less sodium' and 'low sodium' were removed on 2026-08-14. They are the
    // same defect the cooking verbs were, one nutrient over: stripping them
    // collapsed the modifier-bearing line onto the bare line's cache key, so
    // 'low sodium soy sauce' and 'soy sauce' shared one FoodMapping row.
    // MEASURED live before the change: both served off_0074261182164
    // (4.467 g Na/100 g) at funnelStage=cache_hit on the solo AND composite
    // paths, against a truth cluster of 2.85-3.58 for genuine reduced-sodium
    // soy sauce -- a ~1.4x warm over-bill on the one nutrient the modifier
    // names, and ~1.8x cold (fs_3272, 5.637). Sodium IS the panel here.
    //
    // Load-bearing for the KEY, like the cooking verbs and for the same
    // reason: 'low sodium' is absent from QUALIFIERS, so this strip was the
    // last place the state existed. Deliberately NOT fixed by adding it to
    // IDENTITY_QUALIFIERS -- that set is the cache-key discriminator and its
    // own header asks for it to stay tiny. Shipped with the RULES_VERSION
    // 2 -> 3 bump it needs, or AiNormalizeCache replays the old collapse
    // while every unit test stays green (the #211 precedent).
    //
    // The siblings are already safe and deliberately NOT touched: 'reduced
    // sodium', 'sodium free', 'no salt added', 'low fat', 'reduced fat',
    // 'fat free' and 'unsalted' were all measured to pass through unchanged.
    'extra',
    'whole',
    'split',
    'cubed',
    'diced',
    'sliced',
    'chopped',
    'minced',
    'roughly',
    'trimmed',
    'halves',
    'mashed',
    'grated',
    'shredded',
    'crushed',
    'ground',
    'julienned',
    'peeled',
    'cored',
    'seeded',
    'deveined',
    'deboned',
    'pitted',

    // Cooking methods that do not move the panel BASIS.
    //
    // The methods that DO move it were removed on 2026-08-01 — 'grilled',
    // 'scrambled', 'steamed', 'boiled' (+hard/soft), 'poached', 'baked',
    // 'roasted', 'broiled', 'sauteed'/'sautéed', 'smoked'. They lived here
    // under the premise "no added fat/calories, so scrambled eggs ≈ eggs",
    // which is true per EGG and false per 100 GRAMS: cooking drives off water
    // and concentrates every macro. Stripping them collapsed the modifier-
    // bearing line onto the bare line's cache key, so 'grilled chicken' and
    // 'chicken' shared one FoodMapping row and proteins billed raw with no
    // escape (chicken breast 116 kcal/100g against ~165 intended).
    //
    // These entries are load-bearing for the KEY, not just the name: the
    // parser does not capture them (they are absent from QUALIFIERS), so a
    // strip here is the last place the state exists. Deliberately fixed HERE
    // rather than by adding them to QUALIFIERS — that would also strip them
    // from the retrieval text, and retrieval needs the word to find a cooked
    // record. Owner: sync-docs/reports/2026-08-01_cooking-state-key-collision.md
    'blanched',
    'microwaved',
    'dried',
    'dehydrated',
    'raw',
    'fresh',
    'frozen',
    'thawed',
    'canned',
    'drained',

    // Texture/state descriptions
    'until fluffy',
    'until tender',
    'until soft',
    'until crisp',
    'lightly',
    'well done',
    'medium rare',
    'rare',
    'al dente',

    // NOTE: These cooking methods CHANGE nutritional profile, do NOT strip:
    // - fried, deep-fried, pan-fried (adds significant fat)
    // - breaded, battered (adds carbs/calories)
    // - candied, glazed, caramelized (adds sugar)
    // - creamed, buttered (adds fat/calories)
  ],
  size_phrases: [
    '[0-9]+\\s*(inch|inches|in|cm|centimeter|centimeters)\\b',
    '1\\s*\\"',
    '1\\s*inch',
    '1\\s*cm',
  ],
  synonym_rewrites: [
    { from: 'stberry', to: 'strawberries' },
    { from: 'single cream', to: 'light cream' },
    { from: 'double cream', to: 'heavy cream' },
    { from: 'cherries tomatoes', to: 'cherry tomatoes' },
    { from: 'cherries tomato', to: 'cherry tomatoes' },
    { from: 'green pepper', to: 'bell pepper' },
    { from: 'green peppers', to: 'bell pepper' },
    { from: 'hot sausage', to: 'spicy sausage' },
    { from: 'mostaccioli', to: 'mostaccioli pasta' },
    // Canonicalises the two shopper spellings onto one key. KEPT.
    { from: 'less sodium soy sauce', to: 'low sodium soy sauce' },
    // 'low sodium soy sauce' -> 'soy sauce low sodium' was removed 2026-08-14.
    // These two rules were entangled: the rewrite ran FIRST (synonym_rewrites
    // precede the prep strip in normalizeIngredientName), moving the modifier
    // to the tail, and the prep strip then deleted it -- so the word-order
    // shuffle's only consumer was the strip that is now gone. Removing the
    // strip alone would have left the odd tail form. MEASURED on the live
    // search lane: the natural order retrieves BETTER -- 'low sodium soy
    // sauce' -> fs_1146892 (2.848 g Na/100 g) vs 'soy sauce low sodium' ->
    // fs_38416 (3.333). Both find a genuine low-sodium record; neither needs
    // the shuffle.
    { from: 'cube chicken bouillon', to: 'chicken bouillon cube' },
    { from: 'polish beef sausage', to: 'polish sausage' },
    { from: 'polish sausage', to: 'kielbasa' },
    { from: 'yellow deli mustard', to: 'yellow mustard' },
    { from: 'hot sausage', to: 'spicy sausage' },
    { from: 'hot sauce', to: 'hot pepper sauce' },
    { from: 'red curry paste', to: 'thai red curry paste' },
    { from: 'links 4/lb', to: '' },
    // Part-whole stripping (when part is assumed by default)
    { from: 'parsley leaves', to: 'parsley' },
    { from: 'cilantro leaves', to: 'cilantro' },
    { from: 'basil leaves', to: 'basil' },
    { from: 'mint leaves', to: 'mint' },
    { from: 'celery stalks', to: 'celery' },
    { from: 'celery stalk', to: 'celery' },
    { from: 'garlic cloves', to: 'garlic' },
    { from: 'garlic clove', to: 'garlic' },
    // Spice-form rewrites: whole vs ground spices are nutritionally equivalent
    // APIs only have "ground cinnamon" or branded snacks called "cinnamon sticks"
    { from: 'cinnamon sticks', to: 'cinnamon' },
    { from: 'cinnamon stick', to: 'cinnamon' },
    { from: 'lemon zest', to: 'lemon peel' },
    { from: 'lime zest', to: 'lime peel' },
    { from: 'orange zest', to: 'orange peel' },
    // Rare citrus peel → common citrus peel (nutritionally equivalent)
    { from: 'blood orange peel', to: 'orange peel' },
    { from: 'blood orange zest', to: 'orange peel' },
    { from: 'cara cara orange peel', to: 'orange peel' },
    { from: 'navel orange peel', to: 'orange peel' },
    { from: 'meyer lemon peel', to: 'lemon peel' },
    { from: 'meyer lemon zest', to: 'lemon peel' },
    { from: 'key lime peel', to: 'lime peel' },
    { from: 'key lime zest', to: 'lime peel' },
    // Mixed product rewrites (guide toward correct product category)
    { from: 'tomato and green chili mix', to: 'diced tomatoes with green chilies' },
    { from: 'tomato & green chili mix', to: 'diced tomatoes with green chilies' },
    { from: 'tomato green chili mix', to: 'diced tomatoes with green chilies' },
    { from: 'matcha green tea', to: 'matcha tea' }, // Preserve beverage context to prevent powder matches
    // Complex Niche Ingredients -> Standard mappings
    { from: 'dry mustard', to: 'mustard powder' },
    { from: 'veggie sausage', to: 'vegetarian sausage' },
    { from: 'vegetarian sausages', to: 'vegetarian sausage' },
    { from: 'flaxseed milk', to: 'flax milk' },
    { from: 'file powder', to: 'gumbo file' },
    { from: 'gumbo file powder', to: 'gumbo file' },
    { from: 'arrowroot powder', to: 'arrowroot starch' },
    { from: 'spagetti sauce', to: 'spaghetti sauce' }, // Typo fix
    { from: 'balsamic gravy sauce', to: 'balsamic glaze' },
    { from: 'salad seasoning', to: 'salad dressing' },
    { from: 'peas and carrots', to: 'mixed vegetables' },
    { from: 'vegetable skallops', to: 'vegetarian scallops' },
    { from: 'vegetable scallops', to: 'vegetarian scallops' },
    // Fat level synonyms — IMPORTANT: these must be SCOPED to avoid over-matching.
    // DO NOT rewrite bare "extra light" → "fat free" as it incorrectly maps
    // "extra light mayonnaise" to fat-free products (wrong macro profile).
    { from: 'extra light mayonnaise', to: 'light mayonnaise' },
    { from: 'extra-light mayonnaise', to: 'light mayonnaise' },
    // Semantic inversion guards: these prevent matching against unrelated branded products
    // e.g. "gluten" → "Gluten Free (Oreo)", "apple pie spice" → "apple chips"
    { from: 'apple pie spice', to: 'apple pie spice blend' },
    { from: 'pie spice', to: 'pumpkin pie spice' },
    { from: 'lasagna', to: 'lasagna noodles' },
    { from: 'ground thyme', to: 'dried thyme powder' },
    { from: 'spice blend mustard', to: 'mustard powder' },
    { from: 'lean hamburger', to: 'lean ground beef' },
    // Scoped 2026-08-24 (D-A9 rider): a hamburger BUN is bread, not beef.
    { from: 'hamburger', to: 'ground beef', unlessFollowedBy: ['bun', 'buns'] },
    { from: 'mixed herbs', to: 'italian seasoning' },
    { from: 'celtic salt', to: 'sea salt' },
    { from: 'stroganoff mix', to: 'beef stroganoff seasoning mix' },
    { from: 'non fat', to: 'nonfat' },
    { from: 'cottage cheese non fat', to: 'nonfat cottage cheese' },
    { from: 'skim yogurt', to: 'nonfat yogurt' },
    // Audit Fix: "cilantro seeds" is a lay term; correct culinary term is coriander
    { from: 'cilantro seeds', to: 'coriander seeds' },
    { from: 'cilantro seed', to: 'coriander seeds' },
    // Audit Fix: Steer green beans away from Ranch Style pinto beans
    { from: 'green beans', to: 'green string beans' },
    { from: 'green bean', to: 'green string bean' },
  ],
};

let cachedRules: NormalizationRules | null = null;

// ============================================================================
// AI-Learned Prep Phrase Sync (Hybrid In-Memory Cache)
// ============================================================================

/**
 * In-memory cache for the active prep phrases.
 * Refreshed at pipeline start via refreshNormalizationRules().
 *
 * Until 2026-08-01 this was "static + AI-learned", where AI-learned meant a findMany over
 * the WHOLE of AiNormalizeCache. That closed a loop: normalizeIngredientName consumes this
 * list, normalizeIngredientName computes AiNormalizeCache's own keys, so the table mutated
 * the function that keys it. Rows written while the loop was armed became unreachable the
 * moment it was disarmed and vice versa — MEASURED 2026-08-01, arming it today would
 * strand 89 of 2864 rows. The blast radius was never limited to this table either:
 * normalizeIngredientName also produces the normalizedName fed to deriveMappingCacheKey(),
 * i.e. the key space of FoodMapping (3509 rows).
 *
 * The 22 phrases the table held were not harmless. MEASURED by running the real refresh
 * against the real 22: 'chicken sandwich' -> 'chicken', 'fried rice' -> 'rice',
 * 'breaded chicken' -> 'chicken' — bare generic keys, the same class of repointing that
 * broke five golden cases in PR #143.
 *
 * Wanted phrases are hand-added to data/fatsecret/normalization-rules.json one at a time,
 * with `npm run eval:golden` as the gate. The prepPhrases COLUMN stays populated; it is an
 * inert LLM observation now, not an input to key computation.
 */
let mergedPrepPhrases: string[] | null = null;

/**
 * Refresh the prep phrases cache from the static rules file.
 * Call this at the start of each pipeline run (auto-map, pilot import).
 *
 * Kept async and kept as a call site: the in-process pipelines (src/lib/nutrition/auto-map.ts,
 * scripts/warm-names.ts, scripts/pilot-batch-import.ts) call it to pick up an edited rules
 * file, and it is the hook a future curated merge would go back into.
 */
export async function refreshNormalizationRules(): Promise<void> {
  const staticRules = readRulesFile();

  // Static file only. Nothing read from the database may enter this list — see the note
  // on mergedPrepPhrases.
  mergedPrepPhrases = [...new Set<string>(staticRules.prep_phrases)];

  logger.info('normalization_rules.refreshed', {
    static: staticRules.prep_phrases.length,
    merged: mergedPrepPhrases.length,
  });
}

/**
 * Get the merged prep phrases list.
 * Returns merged cache if available, otherwise falls back to static rules only.
 */
export function getMergedPrepPhrases(): string[] {
  if (mergedPrepPhrases) {
    return mergedPrepPhrases;
  }
  // Fallback: use static rules only (no AI phrases merged yet)
  return readRulesFile().prep_phrases;
}

function readRulesFile(): NormalizationRules {
  if (cachedRules) return cachedRules;
  const rulesPath = path.resolve(process.cwd(), 'data/fatsecret/normalization-rules.json');
  try {
    const raw = fs.readFileSync(rulesPath, 'utf8');
    const parsed = JSON.parse(raw);
    // Basic shape validation; fall back to defaults if unexpected
    if (
      parsed &&
      Array.isArray(parsed.prep_phrases) &&
      Array.isArray(parsed.size_phrases) &&
      Array.isArray(parsed.synonym_rewrites)
    ) {
      cachedRules = parsed as NormalizationRules;
      return cachedRules;
    }
  } catch {
    // ignore and fall back to defaults
  }
  cachedRules = DEFAULT_RULES;
  return cachedRules;
}

/**
 * Clear the cached rules to force re-reading from the JSON file.
 * Also clears the merged prep phrases cache.
 * Useful for testing or if the JSON file is updated at runtime.
 */
export function clearRulesCache(): void {
  cachedRules = null;
  mergedPrepPhrases = null;
}

export type NormalizationResult = {
  cleaned: string;
  nounOnly: string;
  stripped: string[];
};

/**
 * PROTECTED PRODUCT PHRASES: compound phrases that must be preserved as-is.
 * These are phrases where the combination IS the product type.
 *
 * Module-scoped and exported so the parser can consult the same list instead of
 * re-deriving it. `parseIngredientLine()` needs the `whole` entries specifically
 * (see `isIdentityWholePhrase`), and a second copy would drift: the whole point
 * of these three strings is that they draw a product-judgement line, so the
 * judgement must live in exactly one place.
 */
export const PROTECTED_PRODUCT_PHRASES = [
  // Compound cooking method phrases
  'fire roasted',
  'fire-roasted',
  'oven roasted',
  'oven-roasted',
  'slow roasted',
  'slow-roasted',
  'sun dried',
  'sun-dried',
  'flame grilled',
  'flame-grilled',
  'char grilled',
  'char-grilled',
  'pan fried',
  'stir fried',
  'stir-fried',
  'deep fried',
  // Specific product names that contain prep words
  'smoked salmon',
  'tomato paste',
  'tomato sauce',
  'tomato puree',
  'cream cheese',
  'cottage cheese',
  'peanut butter',
  'apple sauce',
  'apple butter',
  'coconut milk',
  'coconut cream',
  // "whole" as identity (not prep): whole milk is a distinct product from
  // milk; whole wheat/grain are distinct from refined. Deliberately NOT
  // listed: "whole chicken"/"whole almonds" ("whole" is prep there).
  'whole milk',
  'whole wheat',
  'whole grain',
  // "ground" as identity (not prep) before a meat noun: ground chicken is a
  // different product from chicken (a cut, a whole bird), and stripping it
  // collapsed the two onto one cache key -- `ground lamb` derived key `lamb`
  // and was served the `lamb` row, a human-triage NZ SHOULDER cut (usedCount
  // 96, measured 2026-08-24). Only the meats the 85/15 leanness default below
  // does NOT cover are listed: beef and turkey take the default path, where
  // `ground` is deliberately consumed and the percentages carry the identity.
  // Deliberately NOT listed: "ground cinnamon"/"ground flaxseed"/"ground
  // coffee" (`ground` is prep there and the bare noun is the right key).
  // Substring match like the rest of this list, so `ground chicken breast`
  // and `lean ground pork` are covered by the two-word entries.
  'ground chicken',
  'ground pork',
  'ground lamb',
  'ground bison',
  'ground veal',
  'ground venison',
  'ground meat',
];

/**
 * Does this line use `whole` as IDENTITY rather than as a portion word?
 *
 * `whole` is polysemous and the two readings want opposite handling:
 *   - portion  — "1 whole banana", "whole roasted chicken": `whole` is a count
 *     unit, and dropping it would lose the serving size (a banana bills 118 g).
 *   - identity — "whole milk", "whole wheat bread": `whole` names a DIFFERENT
 *     PRODUCT from the bare noun, and eating it as a unit collapses the two onto
 *     one cache key. `whole milk` served a2 skim-ish "Milk" to 222 live events.
 *
 * The disambiguator is the `whole` half of PROTECTED_PRODUCT_PHRASES, which
 * already draws exactly this line and is guarded by shipped tests. Only these
 * three phrases are treated as identity; every other `whole` keeps the portion
 * reading, which is why the genuine counts above are untouched.
 *
 * Substring, not word-boundary, to match how the phrase list is used in
 * `normalizeIngredientName()`. The known failure mode is a longer product name
 * that merely CONTAINS one of them — `whole milk chocolate` reads as identity.
 * Not present in the coverage corpus, the seed corpora, or MappingEventLog as of
 * 2026-08-04, but that is the shape a regression here would take.
 */
export function isIdentityWholePhrase(line: string): boolean {
  const lower = line.toLowerCase();
  return PROTECTED_PRODUCT_PHRASES.some(
    (p) => p.startsWith('whole ') && lower.includes(p)
  );
}

export function normalizeIngredientName(raw: string): NormalizationResult {
  const rules = readRulesFile();
  const stripped: string[] = [];
  let working = raw;

  // ============================================================
  // PRE-PROCESSING: Clean up common input issues
  // ============================================================

  // Step 0: Strip accent characters (Unicode normalization)
  // e.g., "Jalapeño" → "Jalapeno", "crème" → "creme", "café" → "cafe"
  // This ensures consistent API search results regardless of accent usage
  working = working.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Step 1: Strip percentage patterns >= 50% (e.g., "100% liquid" → "liquid")
  // BUT preserve low percentages like "2% milk" which are nutritionally significant
  // AND preserve leanness percentages like "93% lean"
  working = working.replace(/\b(100|[5-9]\d)%(?!\s*lean\b)\s*/gi, '');

  // Step 2: Deduplicate consecutive repeated words/phrases
  // Handles typos like "ice cubes ice cubes" → "ice cubes"
  // First, normalize whitespace for consistent matching
  working = working.replace(/\s+/g, ' ').trim();

  // Deduplicate repeated 2-word phrases (e.g., "ice cubes ice cubes")
  working = working.replace(/\b(\w+\s+\w+)\s+\1\b/gi, '$1');

  // Deduplicate repeated single words (e.g., "egg egg" → "egg")
  working = working.replace(/\b(\w+)\s+\1\b/gi, '$1');

  // ============================================================
  // SYNONYM REWRITES
  // ============================================================

  // Apply synonym rewrites to stabilize wording
  for (const rewrite of rules.synonym_rewrites) {
    const re = new RegExp(`\\b${escapeRegex(rewrite.from)}\\b${followedByGuard(rewrite)}`, 'i');
    if (re.test(working)) {
      working = working.replace(re, rewrite.to);
    }
  }

  // ============================================================
  // CONTEXT-AWARE BARE-WORD REWRITES
  // These must NOT fire when the word is part of a compound term.
  // ============================================================

  // "pepper" alone → "black pepper" (American recipe default)
  // But NOT: red pepper, bell pepper, cayenne pepper, chili pepper, etc.
  const PEPPER_COMPOUNDS = /\b(red|bell|green|yellow|orange|cayenne|chili|chile|jalapeno|banana|hungarian|sweet|hot|white|black|crushed red)\s+pepper/i;
  const PEPPER_SUFFIXES = /\bpepper\s+(flakes|sauce|jack|corn)/i;
  if (!PEPPER_COMPOUNDS.test(working) && !PEPPER_SUFFIXES.test(working)) {
    working = working.replace(/\bpepper\b/i, 'black pepper');
  }

  // Audit Fix: "red pepper" alone → "red bell pepper" (American produce default)
  // But NOT: crushed red pepper, red pepper flakes, chili red pepper, cayenne red pepper, etc.
  const RED_PEPPER_SPICE_PREFIX = /\b(crushed|flake|flakes|cayenne|chili|chile|hot|dried|ground)\s+red\s+pepper/i;
  const RED_PEPPER_SPICE_SUFFIX = /\bred\s+pepper\s+(flakes|sauce|paste|powder|seeds)/i;
  if (!RED_PEPPER_SPICE_PREFIX.test(working) && !RED_PEPPER_SPICE_SUFFIX.test(working)) {
    working = working.replace(/\bred\s+pepper(s)?\b/gi, 'red bell pepper');
  }

  // NOTE: Bare "corn" mapping to kettle corn is now handled universally by the
  // extreme calorie mismatch penalty in simple-rerank.ts (>200% diff → -0.35 penalty).

  // "gluten" alone -> "vital wheat gluten" (prevent replacing in "gluten free" or "gluten-free")
  if (/\bgluten\b/i.test(working) && !/\bgluten[-\s]free\b/i.test(working)) {
    working = working.replace(/\bgluten\b/gi, 'vital wheat gluten');
  }

  // "vanilla" alone → "vanilla extract" (recipe default)
  // But NOT: vanilla extract, vanilla bean, vanilla ice cream, vanilla protein, etc.
  if (/\bvanilla\b/i.test(working) && !/\bvanilla\s+(extract|bean|ice|protein|pudding|wafer|cake|yogurt|cream|frosting|powder|paste)/i.test(working)) {
    working = working.replace(/\bvanilla\b/i, 'vanilla extract');
  }

  // "chicken breast" → "skinless chicken breast" (prevents branded seasoned products)
  // 'raw' gets stripped by prep_phrases, so we use 'skinless' which is preserved
  // But NOT: fried chicken breast, grilled chicken breast, skinless chicken breast, etc.
  // `ground` joined the exclusions 2026-08-24: `ground chicken breast` used to become
  // `ground skinless chicken breast`, which is not a protected phrase, so `ground` was
  // then prep-stripped and the line keyed as `skinless chicken breast` -- a breast.
  if (/\bchicken\s+breast\b/i.test(working) && !/\b(skinless|fried|grilled|baked|roasted|breaded|bbq|smoked|ground)\s+chicken\s+breast/i.test(working)) {
    working = working.replace(/\bchicken\s+breast\b/i, 'skinless chicken breast');
  }

  // Standardize ground meat leanness to deterministic default percentages if not explicitly specified.
  // We use both lean and fat percentages ("90% lean 10% fat") as FatSecret/FDC indexing often relies on the explicit full profile.
  //
  // BEEF AND TURKEY ONLY (2026-08-24). The default is a PHRASING injection: it only
  // helps where records are actually named "85% lean 15% fat <meat>". Census of the
  // three persisted corpora that day (name ~* '85\s*%\s*lean'): beef OFF 230 / FS 10 /
  // FDC 6 rows; turkey OFF 11 / FS 1 / FDC 3; pork OFF 1 / FS 0 / FDC 0 (FDC pork is
  // labelled 72/84/96); chicken 0 / 0 / 0. Until then the list was
  // `beef|turkey|chicken|pork|meat`, so bare `ground chicken` was searched as
  // `85% lean 15% fat chicken`, gathered 21-31 beef/turkey rows, admitted none, and
  // fell to the AI-stub lane (100 g / 165 kcal, `ai_estimated`) while the generic
  // "Ground Chicken" fs_1737, FDC 171116 "Chicken, ground, raw" and 219 OFF rows sat
  // unreached. The meats that leave this list keep `ground` as identity instead --
  // see the `ground <meat>` block in PROTECTED_PRODUCT_PHRASES. Re-derive the census:
  //   SELECT count(*) FROM "OffFood" WHERE name ~* '\mchicken\M' AND name ~* '85\s*%\s*lean'
  // Owner: sync-docs/reports/2026-08-24_the-leanness-default-fires-on-meats-the-corpus-never-labels.md (mobile repo).
  if (/(?:^|\s)lean ground\s+(beef|turkey)(?:\s|$)/i.test(working) && !/\b\d{2}%?\s*(?:lean|fat)/i.test(working)) {
    // "lean ground X" -> default to 90% lean 10% fat
    working = working.replace(/\blean ground\b/gi, '90% lean 10% fat ground');
  } else if (/(?:^|\s)ground\s+(beef|turkey)(?:\s|$)/i.test(working) && !/\b\d{2}%?\s*(?:lean|fat)/i.test(working) && !/\blean\b/i.test(working)) {
    // "ground X" (not lean) -> default to 85% lean 15% fat
    working = working.replace(/\bground\b/gi, '85% lean 15% fat ground');
  }

  // Remove prep/size phrases using merged prep phrases (static + AI-learned)
  // Sort by length (longest first) to match compound patterns like "hard-boiled" before "boiled"
  const allPhrases = [...getMergedPrepPhrases(), ...rules.size_phrases];
  const sortedPhrases = allPhrases.sort((a, b) => b.length - a.length);

  // ============================================================
  // PRODUCT-TYPE MODIFIERS
  // ============================================================
  // These modifiers, when appearing at the START of an ingredient name,
  // indicate a fundamentally different product type that should be preserved
  // in the normalized name for accurate API search.
  //
  // Examples where modifier IS the product type (preserve):
  // - "canned pineapple" → different product than fresh pineapple
  // - "dried apricots" → concentrated sugars, different nutrition
  // - "frozen pizza" → completely different product!
  // - "crushed tomatoes" → canned product, not fresh tomatoes
  //
  // Examples where modifier is just prep (strip):
  // - "chopped onion" → same nutrition as whole onion
  // - "diced, canned tomatoes" → "diced" is prep, "canned" comes after so strip too
  //
  // Rule: If the modifier is the FIRST word and followed by a base noun,
  // it's likely a product type. Otherwise, it's prep.
  const PRODUCT_TYPE_MODIFIERS = new Set([
    'canned',      // canned pineapple, canned beans, canned corn
    'frozen',      // frozen peas, frozen pizza, frozen berries
    'dried',       // dried apricots, dried cranberries, dried herbs
    'crushed',     // crushed tomatoes (the canned product)
    'diced',       // diced tomatoes (the canned product)
    'stewed',      // stewed tomatoes
    'pickled',     // pickled jalapeños, pickled ginger
    'roasted',     // roasted peppers (jarred product)
    'smoked',      // smoked salmon, smoked paprika
    'condensed',   // condensed milk
    'evaporated',  // evaporated milk
    'powdered',    // powdered sugar, powdered milk
    'instant',     // instant oatmeal, instant coffee
    'creamed',     // creamed corn
  ]);

  // Get lowercase version for all case-insensitive comparisons
  const workingLower = working.toLowerCase();

  // Check if input starts with a product-type modifier
  // e.g., "canned pineapple" → preserve "canned"
  // e.g., "pineapple, canned" → don't preserve (not at start)
  const firstWord = workingLower.split(/\s+/)[0]?.replace(/[^a-z]/g, '');
  const startsWithProductModifier = PRODUCT_TYPE_MODIFIERS.has(firstWord);

  const protectedPhrasesInInput = PROTECTED_PRODUCT_PHRASES.filter(p =>
    workingLower.includes(p)
  );

  for (const phrase of sortedPhrases) {
    // Skip stripping if this phrase is part of a protected product phrase
    const phraseLower = phrase.toLowerCase();
    const isProtected = protectedPhrasesInInput.some(protectedPhrase =>
      protectedPhrase.includes(phraseLower) && protectedPhrase !== phraseLower
    );
    if (isProtected) {
      continue; // Don't strip - it's part of a protected product phrase
    }

    // Skip stripping product-type modifiers when they're at the start
    // This preserves "canned pineapple" but still strips "pineapple, canned"
    if (startsWithProductModifier && PRODUCT_TYPE_MODIFIERS.has(phraseLower) && phraseLower === firstWord) {
      continue; // Don't strip - it's a product-type modifier at the start
    }

    // Add word boundaries to prevent partial matches (e.g., "raw" inside "strawberries")
    // But only for simple literal phrases, not for complex regex patterns
    const isComplexPattern = /[\[\]\(\)\*\+\?\|]/.test(phrase);
    const pattern = isComplexPattern ? phrase : `\\b${phrase}\\b`;
    const re = new RegExp(pattern, 'ig');
    if (re.test(working)) {
      stripped.push(phrase);
      working = working.replace(re, ' ');
    }
  }

  // Audit Fix: If after all stripping, the remaining string is ONLY "ground"
  // (a bare prep word left orphaned), clear it to avoid matching flaxseed/coffee.
  if (/^ground$/i.test(working.trim())) {
    working = '';
  }

  // Collapse whitespace
  const cleaned = collapseSpaces(working);

  // Noun-only fallback: drop common adjectives/verbs
  const STOP_WORDS = new Set([
    'extra',
    'beaten',
    'thinly',
    'cut',
    'into',
    'parboiled',
    'low',
    'less',
    'sodium',
    'links',
    'boneless',
    'skinless',
    'bone',
    'skin',
    'removed',
    'split',
    'cubed',
    'diced',
    'sliced',
    'chopped',
    'minced',
    'roughly',
    'trimmed',
  ]);
  const nounTokens = cleaned
    .split(/\s+/)
    .filter((t) => t && !STOP_WORDS.has(t.toLowerCase()));
  const nounOnly = collapseSpaces(nounTokens.join(' '));

  return {
    cleaned,
    nounOnly: nounOnly || cleaned,
    stripped,
  };
}

/**
 * Every apostrophe glyph a keyboard can produce.
 *
 * Deliberately the SAME set `canonicalizeCacheKey` folds. iOS Smart Punctuation
 * is on by default and rewrites `'` to `’` as the user types, so the curly form
 * is not an edge case — it is what the mobile client actually sends.
 *
 * `ʻ` (U+02BB MODIFIER LETTER TURNED COMMA) joined the set for the same reason
 * the others did: it was the last spelling that still forked the key. It is the
 * ʻokina, so it arrives with Hawaiian-spelled brand names. Being outside `\w`, it
 * fell through this fold and was then matched by the strip below (and by the
 * equivalent strip in `canonicalizeCacheKey`), so it became a SPACE and the
 * possessive `s` tokenized on its own: `Trader Joeʻs cookie butter` keyed as
 * "butter cookie joe s trader" while every other spelling keyed as
 * "butter cookie joe trader" — verified against a verbatim pre-change copy of
 * this module. Measured before adding it: 3 OffFood rows corpus-wide, 0
 * FatSecret rows, 0 of 3,246 FoodMapping keys, 0 of 4,165 logged query forms —
 * key-space hygiene with a zero-row migration, not a live incident. It closes
 * the fork before a Hawaiian brand walks into it.
 *
 * The two copies of this class (here and in `canonicalizeCacheKey`) MUST stay
 * byte-identical; every apostrophe defect fixed in this file so far has been
 * two folds disagreeing about which glyphs are apostrophes.
 */
const APOSTROPHES = /['‘’ʼʻ`´]/g;

function collapseSpaces(value: string): string {
  // Preserve hyphens (important for compound words like "all-purpose flour")
  // apostrophes (important for contractions and possessives)
  // and percent signs (important for "2% milk", nutritionally significant)
  //
  // The apostrophe normalisation on the first line is load-bearing and was
  // missing: the strip below preserves only the STRAIGHT apostrophe, so every
  // other glyph became a space here — upstream of `canonicalizeCacheKey`, whose
  // whole job is to fold them. By the time it ran, `mcdonald’s` had already
  // become `mcdonald s` and the apostrophe it was written to collapse was gone,
  // leaving an orphan `s` token in the key and a brand the detector cannot see.
  return value
    .replace(APOSTROPHES, "'")
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s'%\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Negative lookahead for a rule's `unlessFollowedBy`; empty (no guard) when it has none. */
function followedByGuard(rewrite: SynonymRewrite): string {
  const words = (rewrite.unlessFollowedBy ?? []).map((w) => String(w).trim()).filter(Boolean);
  if (words.length === 0) return '';
  return `(?!\\s+(?:${words.map(escapeRegex).join('|')})\\b)`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================================
// Singularization & Canonical Cache Key
// ============================================================================

/**
 * Words that look plural (end in 's') but are already singular.
 * These MUST NOT be singularized by stripping the trailing 's'.
 */
const SINGULAR_BLACKLIST = new Set([
  // Grains & products that end in -s/-us/-ss
  'hummus', 'couscous', 'quinoa', 'falafel',
  'asparagus', 'molasses', 'citrus', 'hibiscus',
  'meringues', // keep as-is; "meringue" is the singular but rarely used in recipes
  // Herbs/plants ending in -s
  'lemongrass', 'wheatgrass', 'cress', 'watercress',
  // Cheese/dairy
  'swiss', 'bris', 'gruyeres',
  // Other food words ending in -s that are singular
  'tahini', 'tzatziki', 'miso', 'tofu', // don't end in s but just in case
  'jus', 'demiglace', 'fois', 'gras',
  'cannabis', 'anise', 'licorice',
  'aioli', 'chimichurris',
  // Common suffixes that aren't plural
  'plus', 'bonus', 'surplus', 'lotus', 'cactus', 'fungus', 'octopus',
  'floss', 'gloss', 'moss', 'cross', 'boss', 'toss', 'loss',
  'dress', 'press', 'stress', 'express',
  'dips', 'chips', 'strips', 'tips', // compound product terms: "pita chips", etc
]);

/**
 * Irregular plurals that need explicit mapping.
 */
const IRREGULAR_PLURALS: Record<string, string> = {
  leaves: 'leaf',
  halves: 'half',
  loaves: 'loaf',
  knives: 'knife',
  lives: 'life',
  wolves: 'wolf',
  calves: 'calf',
  shelves: 'shelf',
  selves: 'self',
  // Produce
  dice: 'die',  // but "diced" is already stripped as prep
  // The -ses branch below reads a doubled s as the signal that the stem really
  // ends in -ss. These are the words where that signal is absent but the stem
  // still is not -se, so the general rule would over-restore an e
  // ("buses" -> "buse"). Small and closed: English has very few single-s stems.
  buses: 'bus',
  gases: 'gas',
  // ...and the mirror case: a doubled s whose stem is -sse, not -ss.
  mousses: 'mousse',
};

/**
 * Singularize a single English word.
 * 
 * Rules (in priority order):
 * 1. Blacklist — return as-is
 * 2. Irregular plurals — explicit lookup
 * 3. -ies → -y (berries → berry)
 * 4. -ves → -f (leaves → leaf) — handled by irregular map
 * 5. -oes → -o (tomatoes → tomato, potatoes → potato)
 * 6. -xes, -zes, -ches, -shes and -sses → strip -es (boxes → box, glasses → glass);
 *    bare -ses → strip -s only, because the stem kept its e (cheeses → cheese)
 * 7. -es (general, word > 4 chars) → strip -es
 * 8. -s (word > 3 chars) → strip -s
 */
export function singularize(word: string): string {
  const lower = word.toLowerCase();

  // Too short to be plural
  if (lower.length <= 2) return lower;

  // Blacklist check
  if (SINGULAR_BLACKLIST.has(lower)) return lower;

  // Irregular plurals
  if (IRREGULAR_PLURALS[lower]) return IRREGULAR_PLURALS[lower];

  // -ies → -y (cherries → cherry, berries → berry)
  // But NOT: "series" → protect
  // But NOT: words where stem is -i (chilies → chili, NOT chily)
  if (lower.endsWith('ies') && lower.length > 4 && lower !== 'series') {
    // Known words ending in -i that pluralize with -es
    const I_STEM_WORDS = new Set(['chili', 'broccoli', 'pierogi', 'biscotti', 'gnocchi', 'ravioli', 'linguini', 'zucchini', 'manicotti']);
    const stem = lower.slice(0, -2); // "chilies" → "chili"
    if (I_STEM_WORDS.has(stem)) {
      return stem;
    }
    return lower.slice(0, -3) + 'y'; // "berries" → "berry"
  }

  // -oes → -o (tomatoes → tomato, potatoes → potato)
  // But NOT: "shoes" → protect
  if (lower.endsWith('oes') && lower.length > 4 && !['shoes', 'toes', 'hoes', 'does', 'goes'].includes(lower)) {
    return lower.slice(0, -2);
  }

  // -ses, -xes, -zes, -ches, -shes → strip -es
  //
  // Stripping two characters is right whenever the -es was added to a stem that
  // already ended in a sibilant: box->boxes, buzz->buzzes, church->churches,
  // dish->dishes, glass->glasses. It is wrong for -ses when the singular ends
  // in -e, because then only the s was added: cheese->cheeses, rose->roses,
  // house->houses, dose->doses. Chopping two there yields chees / ros / hous /
  // dos — and those are not even fixed points ("chees" -> "chee"), which
  // matters because cache-coverage.ts re-canonicalizes stored keys and would
  // under-report any row whose key moves on a second pass.
  //
  // The doubled s is the discriminator: "-sses" means the stem really is -ss,
  // anything else means the stem is -se. IRREGULAR_PLURALS carries the handful
  // of words where that signal misleads (buses, gases, mousses).
  if (lower.length > 4 && /(?:ses|xes|zes|ches|shes)$/.test(lower)) {
    if (lower.endsWith('ses') && !lower.endsWith('sses')) {
      return lower.slice(0, -1);  // cheeses -> cheese, roses -> rose
    }
    return lower.slice(0, -2);    // glasses -> glass, boxes -> box, dishes -> dish
  }

  // General -es (word > 4 chars) — but only if the stem looks like a real word
  // Covers: "olives" → "olive", "noodles" → "noodle"
  // Skip words already ending in double-s (e.g., "lemongrass") - caught by blacklist
  if (lower.endsWith('es') && lower.length > 4 && !lower.endsWith('ss')) {
    const stem = lower.slice(0, -1); // Try just stripping the final 's' first → "olives" → "olive"
    // If stem ends in a consonant + 'e', the singular is the stem (olive, noodle)
    return stem;
  }

  // General -s (word > 3 chars)
  if (lower.endsWith('s') && lower.length > 3 && !lower.endsWith('ss') && !lower.endsWith('us')) {
    return lower.slice(0, -1);
  }

  return lower;
}

/**
 * Produce a deterministic canonical cache key from a normalized ingredient name.
 * 
 * Transformations:
 * 1. Lowercase
 * 2. Split into tokens
 * 3. Singularize each token
 * 4. Sort alphabetically
 * 5. Join with space
 * 
 * This ensures:
 * - "sour cream light" == "light sour cream" (word order)
 * - "onions" == "onion" (singular/plural)
 * - "Greek Yogurt" == "greek yogurt" (case)
 * - "creamy peanut butter" != "peanut butter" (meaningful modifier preserved)
 * - "red bell pepper" != "bell pepper" (color variant preserved)
 * - "mcdonald's fries" == "mcdonalds fries" == "mcdonald’s fries" (possessive spelling)
 *
 * Apostrophes are DELETED before tokenizing, not kept and not turned into
 * separators. Keeping them fed the possessive `s` to singularize() and left a
 * dangling quote ("mcdonald's" -> "mcdonald'"), while the curly form was not in
 * the keep-list at all and split into a stray token ("mcdonald’s" -> "mcdonald s").
 * Three spellings of one brand therefore addressed three different cache rows, and
 * because the key basis is whatever spelling the LLM emitted, which row a user hit
 * was effectively random: "mcdonalds fries" resolved to McDonald's Fries Medium
 * (114g) while "mcdonald's fries" resolved to a generic unbranded Fries (250g).
 * Deleting the apostrophe collapses all three onto the apostrophe-free key, which
 * is the spelling the existing rows already agree on.
 */
export function canonicalizeCacheKey(normalizedName: string): string {
  if (!normalizedName) return '';

  return normalizedName
    .toLowerCase()
    // Possessives collapse: see above. Must stay byte-identical to APOSTROPHES.
    .replace(/['‘’ʼʻ`´]/g, '')
    .replace(/[^a-z0-9%\s\-]/g, ' ')  // Keep %, hyphens
    .split(/\s+/)
    .filter(w => w.length > 0)
    .map(singularize)
    .sort()
    .join(' ')
    .trim();
}
