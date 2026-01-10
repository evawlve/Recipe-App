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
    { from: 'lemon zest', to: 'lemon peel' },
    { from: 'lime zest', to: 'lime peel' },
    { from: 'orange zest', to: 'orange peel' },
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

  // Remove prep/size phrases using merged prep phrases (static + AI-learned)
  // Sort by length (longest first) to match compound patterns like "hard-boiled" before "boiled"
  const allPhrases = [...getMergedPrepPhrases(), ...rules.size_phrases];
  const sortedPhrases = allPhrases.sort((a, b) => b.length - a.length);

  for (const phrase of sortedPhrases) {
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
