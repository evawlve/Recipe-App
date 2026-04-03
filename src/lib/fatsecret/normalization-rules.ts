import fs from 'fs';
import path from 'path';
import { prisma } from '../db';
import { logger } from '../logger';

type NormalizationRules = {
  prep_phrases: string[];
  size_phrases: string[];
  synonym_rewrites: { from: string; to: string }[];
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
    'less sodium',
    'low sodium',
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

    // Cooking methods that DON'T significantly change nutritional profile
    // (no added fat/calories - scrambled eggs ≈ eggs, boiled chicken ≈ chicken)
    'scrambled',
    'boiled',
    'hard[-\\s]?boiled',
    'soft[-\\s]?boiled',
    'steamed',
    'poached',
    'grilled',
    'baked',
    'roasted',
    'broiled',
    'blanched',
    'sauteed',  // minimal oil typically
    'sautéed',
    'microwaved',
    'smoked',   // adds flavor, minimal calorie change
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
    { from: 'less sodium soy sauce', to: 'low sodium soy sauce' },
    { from: 'low sodium soy sauce', to: 'soy sauce low sodium' },
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
    // Fat level synonyms — IMPORTANT: these must be SCOPED to avoid over-matching.
    // DO NOT rewrite bare "extra light" → "fat free" as it incorrectly maps
    // "extra light mayonnaise" to fat-free products (wrong macro profile).
    { from: 'extra light mayonnaise', to: 'light mayonnaise' },
    { from: 'extra-light mayonnaise', to: 'light mayonnaise' },
    // Semantic inversion guards: these prevent matching against unrelated branded products
    // e.g. "gluten" → "Gluten Free (Oreo)", "apple pie spice" → "apple chips"
    { from: 'apple pie spice', to: 'apple pie spice blend' },
    { from: 'pie spice', to: 'pumpkin pie spice' },
    { from: 'gluten', to: 'vital wheat gluten' },
  ],
};

let cachedRules: NormalizationRules | null = null;

// ============================================================================
// AI-Learned Prep Phrase Sync (Hybrid In-Memory Cache)
// ============================================================================

/**
 * In-memory cache for merged prep phrases (static + AI-learned).
 * Refreshed once at pipeline start via refreshNormalizationRules().
 */
let mergedPrepPhrases: string[] | null = null;

/**
 * Query AiNormalizeCache for unique prep phrases discovered by AI.
 * These phrases were learned during previous AI normalization runs.
 */
export async function getAiLearnedPrepPhrases(): Promise<string[]> {
  try {
    const cached = await prisma.aiNormalizeCache.findMany({
      select: { prepPhrases: true },
    });

    const allPhrases = new Set<string>();
    for (const row of cached) {
      const phrases = row.prepPhrases as string[];
      if (Array.isArray(phrases)) {
        phrases.forEach(p => {
          const normalized = p.toLowerCase().trim();
          if (normalized) {
            allPhrases.add(normalized);
          }
        });
      }
    }

    return [...allPhrases];
  } catch (error) {
    logger.warn('normalization_rules.ai_phrases_error', { error });
    return [];
  }
}

/**
 * Refresh the merged prep phrases cache.
 * Call this at the start of each pipeline run (auto-map, pilot import).
 * Merges static rules from JSON file with AI-learned phrases from DB.
 */
export async function refreshNormalizationRules(): Promise<void> {
  const staticRules = readRulesFile();
  const aiPhrases = await getAiLearnedPrepPhrases();

  // Merge and deduplicate (static phrases may be regex patterns, AI phrases are literal)
  const combined = new Set<string>([
    ...staticRules.prep_phrases,
    ...aiPhrases,
  ]);

  mergedPrepPhrases = [...combined];

  logger.info('normalization_rules.refreshed', {
    static: staticRules.prep_phrases.length,
    aiLearned: aiPhrases.length,
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
  working = working.replace(/\b(100|[5-9]\d)%\s*/g, '');

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
    const re = new RegExp(`\\b${escapeRegex(rewrite.from)}\\b`, 'i');
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

  // NOTE: Bare "corn" mapping to kettle corn is now handled universally by the
  // extreme calorie mismatch penalty in simple-rerank.ts (>200% diff → -0.35 penalty).

  // "vanilla" alone → "vanilla extract" (recipe default)
  // But NOT: vanilla extract, vanilla bean, vanilla ice cream, vanilla protein, etc.
  if (/\bvanilla\b/i.test(working) && !/\bvanilla\s+(extract|bean|ice|protein|pudding|wafer|cake|yogurt|cream|frosting|powder|paste)/i.test(working)) {
    working = working.replace(/\bvanilla\b/i, 'vanilla extract');
  }

  // "chicken breast" → "skinless chicken breast" (prevents branded seasoned products)
  // 'raw' gets stripped by prep_phrases, so we use 'skinless' which is preserved
  // But NOT: fried chicken breast, grilled chicken breast, skinless chicken breast, etc.
  if (/\bchicken\s+breast\b/i.test(working) && !/\b(skinless|fried|grilled|baked|roasted|breaded|bbq|smoked)\s+chicken\s+breast/i.test(working)) {
    working = working.replace(/\bchicken\s+breast\b/i, 'skinless chicken breast');
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

  // PROTECTED PRODUCT PHRASES: Compound phrases that must be preserved as-is
  // These are phrases where the combination is the product type
  const PROTECTED_PRODUCT_PHRASES = [
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
  ];

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

function collapseSpaces(value: string): string {
  // Preserve hyphens (important for compound words like "all-purpose flour")
  // apostrophes (important for contractions and possessives)
  // and percent signs (important for "2% milk", nutritionally significant)
  return value.replace(/\s+/g, ' ').replace(/[^\w\s'%\-]/g, ' ').replace(/\s+/g, ' ').trim();
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
 * 6. -ses, -xes, -zes, -ches, -shes → strip -es
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
  if (lower.length > 4 && /(?:ses|xes|zes|ches|shes)$/.test(lower)) {
    return lower.slice(0, -2);
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
 */
export function canonicalizeCacheKey(normalizedName: string): string {
  if (!normalizedName) return '';

  return normalizedName
    .toLowerCase()
    .replace(/[^a-z0-9%\s\-']/g, ' ')  // Keep %, hyphens, apostrophes
    .split(/\s+/)
    .filter(w => w.length > 0)
    .map(singularize)
    .sort()
    .join(' ')
    .trim();
}
