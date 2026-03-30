import { parseIngredientLine, type ParsedIngredient } from '../parse/ingredient-line';
import { normalizeQuery } from '../search/normalize';
import { logger } from '../logger';
import {
  FatSecretClient,
  type FatSecretAutocompleteHit,
  type FatSecretFoodDetails,
  type FatSecretFoodSummary,
  type FatSecretServing,
} from './client';
import { FATSECRET_CACHE_MODE, FATSECRET_CACHE_MODE_HELPERS, FATSECRET_MIN_CONFIDENCE } from './config';
import {
  cacheFoodToDetails,
  cacheFoodToSummary,
  getCachedFoodWithRelations,
  searchFatSecretCacheFoods,
} from './cache-search';
import { ensureFoodCached } from './cache';
import { rerankFatsecretCandidates } from './ai-rerank';
import { aiNormalizeIngredient } from './ai-normalize';
import { normalizeIngredientName } from './normalization-rules';
import { insertAiServing } from './ai-backfill';
import { backfillOnDemand, isProduce as isProduceFn } from './serving-backfill';
import { debugLogger } from './debug-logger';
import { detectCookState } from './cook-state-detector';
import { validateMappingWithAI } from './ai-validation';
import {
  getValidatedMappingByNormalizedName,
  saveValidatedMapping,
  trackValidationFailure,
} from './validated-mapping-helpers';
import { refineSearchQuery } from './ai-search-refine';

export type FatsecretMappedIngredient = {
  source: 'fatsecret' | 'fdc' | 'cache' | 'ai_generated';
  foodId: string;
  foodName: string;
  brandName?: string | null;
  servingId?: string | null;
  servingDescription?: string | null;
  grams: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: number;
  quality: 'high' | 'medium' | 'low';
  rawLine: string;
  aiValidation?: {
    approved: boolean;
    confidence: number;
    reason: string;
    category?: string;
    detectedIssues?: string[];
  };
};

export interface MapIngredientOptions {
  client?: FatSecretClient;
  minConfidence?: number;
  allowLiveFallback?: boolean;
  debug?: boolean;
}

const defaultClient = new FatSecretClient();

interface MappingCandidate {
  food: FatSecretFoodSummary;
  source: 'search' | 'cache';
  baseScore: number;
  hydratedOverride?: FatSecretFoodDetails;
  query: string;
}

// Synonym table for pantry staples and produce
// Maps common ingredient variants to their search synonyms
const INGREDIENT_SYNONYMS: Record<string, string[]> = {
  'almond flour': ['almond meal'],
  'blueberry': ['blueberries'],
  'lettuce': ['romaine lettuce', 'cos'],
  'onion': ['onions'],
  'flour': ['white flour', 'all-purpose flour'],
  'whey powder': ['whey protein powder', 'whey protein', 'protein powder whey'],
  'whey protein powder': ['whey protein', 'protein powder whey', 'whey powder'],
  'protein powder': ['whey protein powder', 'protein powder whey'],
  'oil': ['vegetable oil'],
  'vegetable oil': ['vegetable oil', 'canola oil', 'sunflower oil'],
  'black pepper': ['pepper', 'ground black pepper'],
  'bell pepper': ['green pepper', 'red pepper'],
  'green pepper': ['bell pepper'],
  'chicken breast': ['chicken breast raw', 'chicken breast skinless', 'boneless chicken breast'],
  'chicken sausage': ['smoked chicken sausage', 'chicken link sausage'],
  'mushrooms': ['mushroom', 'mushroom raw'],
  'zucchini': ['courgette'],
  'parsley sprig': ['parsley', 'parsley leaf', 'parsley leaves'],
  // Nuts: add variants with "nuts" suffix and "raw" prefix
  'cashews': ['cashew nuts', 'raw cashews', 'cashew'],
  'cashew': ['cashew nuts', 'raw cashew', 'cashews'],
  'hazelnuts': ['filberts', 'hazelnuts filberts', 'raw hazelnuts', 'hazelnut'],
  'hazelnut': ['filberts', 'hazelnuts filberts', 'raw hazelnut', 'hazelnuts'],
  'pistachios': ['pistachio nuts', 'raw pistachios', 'pistachio'],
  'pistachio': ['pistachio nuts', 'raw pistachio', 'pistachios'],
  // UK synonyms
  'courgette': ['zucchini', 'zucchini squash'],
  'aubergine': ['eggplant'],
  // Tomato varieties: plum tomatoes are also called roma tomatoes or italian tomatoes
  'plum tomato': ['roma tomato', 'italian tomato', 'tomato'],
  'plum tomatoes': ['roma tomatoes', 'italian tomatoes', 'tomatoes'],
};


// Plural → singular mapping for meat cuts and common ingredients
const PLURAL_TO_SINGULAR: Record<string, string> = {
  eggs: 'egg',
  thighs: 'thigh',
  breasts: 'breast',
  onions: 'onion',
  tomatoes: 'tomato',
  blueberries: 'blueberry',
  cashews: 'cashew',
  hazelnuts: 'hazelnut',
  pistachios: 'pistachio',
  mushrooms: 'mushroom',
};

const DESCRIPTOR_STOPWORDS = new Set([
  'cut',
  'cutting',
  'cuttinginto',
  'cutinto',
  'thinly',
  'thin',
  'thick',
  'sliced',
  'slice',
  'slices',
  'diced',
  'chopped',
  'minced',
  'cubed',
  'cube',
  'shredded',
  'grated',
  'crushed',
  'peeled',
  'trimmed',
  'rinsed',
  'drained',
  'seeded',
  'deveined',
  'halved',
  'quartered',
  'into',
  'piece',
  'pieces',
  'inch',
  'inches',
  '\"',
  'dash',
  'pinch',
]);

const UNIT_STOPWORDS = new Set([
  'tsp',
  'teaspoon',
  'teaspoons',
  'tbsp',
  'tablespoon',
  'tablespoons',
  'cup',
  'cups',
  'ml',
  'milliliter',
  'milliliters',
  'l',
  'liter',
  'liters',
  'ounce',
  'ounces',
  'oz',
  'g',
  'gram',
  'grams',
  'lb',
  'pound',
  'pounds',
  'dash',
  'pinch',
  'clove',
  'cloves',
  'leaf',
  'leaves',
]);

const HERB_OR_SPICE_TOKENS = [
  'basil',
  'parsley',
  'cilantro',
  'coriander',
  'oregano',
  'thyme',
  'rosemary',
  'sage',
  'mint',
  'dill',
  'chive',
  'chives',
  'tarragon',
  'marjoram',
  'pepper',
  'paprika',
  'cumin',
  'turmeric',
  'ginger',
  'cinnamon',
  'nutmeg',
  'clove',
  'cardamom',
  'cayenne',
];

function cleanIngredientName(rawName: string): string {
  const normalized = normalizeQuery(rawName);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const cleaned: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    let token = tokens[i];
    if (!token || DESCRIPTOR_STOPWORDS.has(token) || UNIT_STOPWORDS.has(token)) {
      continue;
    }

    // Preserve leanness percentages for ground meat (e.g., "90 lean", "85%")
    // Check if next token is "lean" or if current token is a percentage
    const nextToken = tokens[i + 1];
    const isLeannessNumber = /^\d+$/.test(token) && nextToken === 'lean';
    const isPercentage = /^\d+%$/.test(token);

    // Remove inch markers like 1" or 1-inch, but NOT leanness numbers or percentages
    if (!isLeannessNumber && !isPercentage && /^\d+("?|-inch|inch)?$/.test(token)) {
      continue;
    }

    if (token === 'sprigs') token = 'sprig';
    if (token === 'leeks') token = 'leek';
    if (token === 'cubes') token = 'cube';
    // Singularize simple plurals and keep mapped forms
    const mapped = PLURAL_TO_SINGULAR[token];
    if (mapped) {
      token = mapped;
    } else if (token.endsWith('es') && token.length > 3) {
      token = token.slice(0, -2);
    } else if (token.endsWith('s') && token.length > 3) {
      token = token.slice(0, -1);
    }
    cleaned.push(token);
  }

  return cleaned.join(' ').trim();
}

function isHerbOrSpice(tokens: string[]): boolean {
  return tokens.some((t) => HERB_OR_SPICE_TOKENS.includes(t));
}

export function buildSearchExpressions(parsed: ParsedIngredient | null, rawLine: string): string[] {
  // Start from parsed name or raw line, strip qty/multiplier and normalize
  const baseName = parsed?.name?.trim() || rawLine.trim();
  // Clean up qty/unit/prep noise before generating expressions
  let normalized = cleanIngredientName(baseName);
  if (!normalized) {
    normalized = normalizeQuery(baseName);
  }

  // Remove any residual quantity/number patterns from normalized name
  // BUT preserve leanness indicators (e.g., "90 lean", "93%")
  // Don't strip numbers that are followed by "lean" or are percentages
  if (!/\d+%?\s+lean/.test(normalized) && !/\d+%/.test(normalized)) {
    normalized = normalized.replace(/^\d+[\s\.\-\d]*\s+/, '').trim();
  }

  const expressions: string[] = [];
  const seen = new Set<string>();

  // Extract important qualifiers (cooked/raw, preparation methods, unsweetened/whole)
  const importantQualifiers: string[] = [];
  const brandHints: string[] = [];
  const prepQualifiers: string[] = [];
  const sizeQualifiers: string[] = []; // large, medium, small

  if (parsed?.qualifiers) {
    for (const q of parsed.qualifiers) {
      const qLower = q.toLowerCase();
      // Important qualifiers for search
      if (/cooked|raw|diced|chopped|sliced|minced|unsweetened|sweetened|whole/.test(qLower)) {
        importantQualifiers.push(q);
        if (/diced|chopped|sliced|minced/.test(qLower)) {
          prepQualifiers.push(q);
        }
      }
      // Size qualifiers (for eggs: "large egg" even when parsed name is "eggs")
      if (/large|medium|small/.test(qLower)) {
        sizeQualifiers.push(q);
      }
      // Brand hints (almond breeze, fage, etc.)
      if (/breeze|fage|blue.?diamond|brand/i.test(q)) {
        brandHints.push(q);
      }
    }
  }

  // Special handling for "eggs"/"egg" patterns: add (qty?) + "egg" and singular/plural variants before qualifiers
  // This ensures "3 large eggs" generates "large egg", "egg large", "eggs large" etc.
  const normalizedLower = normalized.toLowerCase();
  if (/egg/.test(normalizedLower)) {
    // Extract base noun: "egg" or "eggs"
    const eggBase = normalizedLower.includes('eggs') ? 'eggs' : 'egg';
    const eggSingular = 'egg';
    const eggPlural = 'eggs';

    // Add variants with size qualifiers BEFORE other expressions (prepend to ensure priority)
    if (sizeQualifiers.length > 0) {
      for (const sizeQ of sizeQualifiers) {
        // "large egg" (singular + qualifier)
        if (!seen.has(`${sizeQ} ${eggSingular}`)) {
          expressions.unshift(`${sizeQ} ${eggSingular}`); // Prepend for priority
          seen.add(`${sizeQ} ${eggSingular}`);
        }
        // "egg large" (alternative order)
        if (!seen.has(`${eggSingular} ${sizeQ}`)) {
          expressions.unshift(`${eggSingular} ${sizeQ}`);
          seen.add(`${eggSingular} ${sizeQ}`);
        }
        // "large eggs" (plural + qualifier)
        if (!seen.has(`${sizeQ} ${eggPlural}`)) {
          expressions.unshift(`${sizeQ} ${eggPlural}`);
          seen.add(`${sizeQ} ${eggPlural}`);
        }
        // "eggs large" (alternative order)
        if (!seen.has(`${eggPlural} ${sizeQ}`)) {
          expressions.unshift(`${eggPlural} ${sizeQ}`);
          seen.add(`${eggPlural} ${sizeQ}`);
        }
      }
    }

    // Add base singular/plural variants
    if (!seen.has(eggSingular)) {
      expressions.unshift(eggSingular);
      seen.add(eggSingular);
    }
    if (!seen.has(eggPlural)) {
      expressions.unshift(eggPlural);
      seen.add(eggPlural);
    }
  }

  // Special handling for chicken parts: add explicit unit words and force search with just meat noun
  // e.g., "2 large chicken breasts" → "skinless chicken breast", "boneless chicken breast", "chicken breast", "breast"
  const chickenPattern = /chicken\s+(breast|thigh|wing|leg|drumstick)/i;
  const chickenMatch = normalized.match(chickenPattern);
  if (chickenMatch) {
    const cut = chickenMatch[1].toLowerCase();
    const cutPlural = cut.endsWith('s') ? cut : `${cut}s`;
    const cutSingular = cut.endsWith('s') ? cut.slice(0, -1) : cut;

    // Add explicit unit words before other expressions
    expressions.unshift(`skinless chicken ${cutSingular}`);
    seen.add(`skinless chicken ${cutSingular}`);
    expressions.unshift(`boneless skinless chicken ${cutSingular}`);
    seen.add(`boneless skinless chicken ${cutSingular}`);
    expressions.unshift(`chicken ${cutSingular}`);
    seen.add(`chicken ${cutSingular}`);
    expressions.unshift(`chicken ${cutPlural}`);
    seen.add(`chicken ${cutPlural}`);

    // Force search with just the meat noun before noun-only fallback
    expressions.unshift(cutSingular);
    seen.add(cutSingular);
    expressions.unshift(cutPlural);
    seen.add(cutPlural);
  }

  // Primary expression: base name + important qualifiers
  let primary = normalized;
  if (importantQualifiers.length > 0) {
    primary = `${normalized} ${importantQualifiers.join(' ')}`.trim();
  }
  if (primary && !seen.has(primary)) {
    expressions.push(primary);
    seen.add(primary);
  }

  // If brand hints exist, add expression with brand
  if (brandHints.length > 0) {
    const withBrand = `${normalized} ${brandHints.join(' ')}`.trim();
    if (withBrand && !seen.has(withBrand)) {
      expressions.push(withBrand);
      seen.add(withBrand);
    }
  }

  // Fallback: base name without qualifiers (if we added them)
  if (importantQualifiers.length > 0 && normalized !== primary) {
    if (normalized && !seen.has(normalized)) {
      expressions.push(normalized);
      seen.add(normalized);
    }
  }

  // Fallback: base name + unitHint if available and not already included
  if (parsed?.unitHint) {
    const unitHintLower = parsed.unitHint.toLowerCase();
    if (!normalized.includes(unitHintLower) && !primary.includes(unitHintLower)) {
      const withUnitHint = `${normalized} ${parsed.unitHint}`.trim();
      if (withUnitHint && !seen.has(withUnitHint)) {
        expressions.push(withUnitHint);
        seen.add(withUnitHint);
      }
    }
  }

  // Fallback: strip size/prep adjectives and try again (keep important ones)
  const stripped = normalized
    .replace(/\b(large|medium|small)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped && stripped !== normalized && !seen.has(stripped)) {
    expressions.push(stripped);
    seen.add(stripped);
  }

  // If we have prep qualifiers, add an expression with just prep (e.g., "onion diced")
  if (prepQualifiers.length > 0 && normalized) {
    const nameOnly = normalized.replace(/\b(diced|chopped|sliced|minced)\b/gi, '').replace(/\s+/g, ' ').trim();
    if (nameOnly && nameOnly !== normalized) {
      const withPrep = `${nameOnly} ${prepQualifiers.join(' ')}`.trim();
      if (withPrep && !seen.has(withPrep)) {
        expressions.push(withPrep);
        seen.add(withPrep);
      }
    }
  }

  // Add synonym-based variants
  for (const [key, synonyms] of Object.entries(INGREDIENT_SYNONYMS)) {
    // Check if the key matches the normalized name (as substring or full match)
    if (normalized.includes(key) || key.includes(normalized)) {
      for (const synonym of synonyms) {
        const synonymNormalized = normalizeQuery(synonym);
        if (!seen.has(synonymNormalized)) {
          expressions.push(synonymNormalized);
          seen.add(synonymNormalized);
        }
        // For lettuce/onion/tomato, add "<color> lettuce" AND "<color> lettuce raw" variants
        // Extract color adjectives from normalized (red, green, yellow, etc.)
        const colorPattern = /\b(red|green|yellow|white|purple|orange|black|brown)\b/i;
        const colorMatch = normalized.match(colorPattern);
        if (colorMatch && (key.includes('lettuce') || key.includes('onion') || key.includes('tomato'))) {
          const color = colorMatch[0].toLowerCase();
          // Add "<color> <synonym>"
          const coloredSynonym = `${color} ${synonymNormalized}`;
          if (!seen.has(coloredSynonym)) {
            expressions.push(coloredSynonym);
            seen.add(coloredSynonym);
          }
          // Always add "<color> <synonym> raw" for produce (most FatSecret entries are labeled "Red Onions, Raw")
          const coloredSynonymRaw = `${color} ${synonymNormalized} raw`;
          if (!seen.has(coloredSynonymRaw)) {
            expressions.push(coloredSynonymRaw);
            seen.add(coloredSynonymRaw);
          }
          // Also add raw variant without color if color is present
          const synonymRaw = `${synonymNormalized} raw`;
          if (!seen.has(synonymRaw)) {
            expressions.push(synonymRaw);
            seen.add(synonymRaw);
          }
        } else if (key.includes('lettuce') || key.includes('onion') || key.includes('tomato')) {
          // For produce without explicit color, still add "raw" variant if we have color/prep qualifiers
          if (importantQualifiers.some(q => /raw/i.test(q)) || colorMatch || prepQualifiers.length > 0) {
            const synonymRaw = `${synonymNormalized} raw`;
            if (!seen.has(synonymRaw)) {
              expressions.push(synonymRaw);
              seen.add(synonymRaw);
            }
          }
        }
      }
    }
  }

  // Add plural → singular mappings for meat cuts and common ingredients
  const normalizedLower2 = normalized.toLowerCase();
  for (const [plural, singular] of Object.entries(PLURAL_TO_SINGULAR)) {
    if (normalizedLower2.includes(plural) && !seen.has(singular)) {
      expressions.push(singular);
      seen.add(singular);
    }
  }

  // Add singular forms (plural -> singular)
  if (normalized.endsWith('ies')) {
    const singular = normalized.slice(0, -3) + 'y';
    if (!seen.has(singular)) {
      expressions.push(singular);
      seen.add(singular);
    }
  } else if (normalized.endsWith('es') && !normalized.endsWith('ses') && !normalized.endsWith('xes')) {
    const singular = normalized.slice(0, -2);
    if (!seen.has(singular) && singular.length > 2) {
      expressions.push(singular);
      seen.add(singular);
    }
  } else if (normalized.endsWith('s') && normalized.length > 3) {
    const singular = normalized.slice(0, -1);
    if (!seen.has(singular) && singular.length > 2) {
      expressions.push(singular);
      seen.add(singular);
    }
  }

  // Detect compound ingredients that should NOT be reduced to single-word fallbacks
  // e.g., "rice vinegar" should not add "vinegar", "soy sauce" should not add "sauce"
  const PROTECTED_COMPOUNDS = [
    'rice vinegar', 'apple cider vinegar', 'balsamic vinegar', 'red wine vinegar', 'white wine vinegar',
    'soy sauce', 'fish sauce', 'oyster sauce', 'worcestershire sauce', 'hot sauce',
    'peanut butter', 'almond butter', 'cashew butter',
    'coconut milk', 'almond milk', 'soy milk',
    'olive oil', 'coconut oil', 'sesame oil', 'vegetable oil', 'canola oil',
    'ground beef', 'ground turkey', 'ground chicken', 'ground pork',
  ];

  const normalizedLowerForCompound = normalized.toLowerCase();
  // Use exact match to check if this is a protected compound
  // Also check if the normalized name contains the full compound phrase as a substring
  const isProtectedCompound = PROTECTED_COMPOUNDS.some(compound => {
    return normalizedLowerForCompound === compound ||
      normalizedLowerForCompound.startsWith(compound + ' ') ||
      normalizedLowerForCompound.endsWith(' ' + compound) ||
      normalizedLowerForCompound.includes(' ' + compound + ' ');
  });

  // Final ultra-generic fallback: extract just the core noun (last significant word)
  // This helps with pantry staples like "all-purpose flour" -> "flour", "lettuce leaves" -> "lettuce"
  // BUT skip this for protected compound ingredients to avoid "rice vinegar" -> "vinegar"
  if (!isProtectedCompound) {
    const skipWords = new Set(['cooked', 'raw', 'diced', 'chopped', 'sliced', 'minced', 'unsweetened', 'sweetened', 'whole']);
    const words = normalized.split(/[^\w]+/).filter(w => w.length > 2 && !skipWords.has(w));
    if (words.length > 1) {
      const coreNoun = words[words.length - 1];
      if (coreNoun && !seen.has(coreNoun)) {
        expressions.push(coreNoun);
        seen.add(coreNoun);
      }
    } else if (words.length === 1 && !seen.has(words[0])) {
      expressions.push(words[0]);
      seen.add(words[0]);
    }
  }

  // Force ultra-generic queries for SINGLE-WORD pantry items only
  // Don't do this for compound ingredients like "rice" (part of "rice vinegar")
  const pantryNouns = ['powder', 'flour', 'lettuce', 'onion', 'garlic', 'pasta', 'noodle'];
  if (!isProtectedCompound) {
    for (const noun of pantryNouns) {
      if (normalized.endsWith(noun) && !normalized.includes(' ')) {
        if (!seen.has(noun)) {
          expressions.push(noun);
          seen.add(noun);
        }
      }
    }
  }

  // Final "noun only" fallback: extract the last significant word/token
  // BUT only if not a protected compound
  if (!isProtectedCompound) {
    const allWords = normalized.split(/[^\w]+/).filter(w => w.length > 2);
    if (allWords.length > 0) {
      const lastWord = allWords[allWords.length - 1];
      if (lastWord && !seen.has(lastWord)) {
        expressions.push(lastWord);
        seen.add(lastWord);
      }
    }
  }

  return expressions.length > 0 ? expressions : [normalized || rawLine.trim()];
}

export async function mapIngredientWithFatsecret(
  rawLine: string,
  options: {
    client?: FatSecretClient;
    minConfidence?: number;
    allowLiveFallback?: boolean;
    debug?: boolean;
  } = {}
): Promise<FatsecretMappedIngredient | null> {
  const { client = defaultClient, minConfidence = 0, allowLiveFallback = true, debug = false } = options;
  const trimmed = rawLine.trim();
  if (!trimmed) return null;

  // Step 0: Check validated cache by NORMALIZED name (not raw ingredient)
  // Parse first to get the base name, then normalize it for cache lookup
  const parsedForCache = parseIngredientLine(trimmed);
  const baseNameForCache = parsedForCache?.name?.trim() || trimmed;
  const normalizedForCache = normalizeIngredientName(baseNameForCache).cleaned || baseNameForCache;
  const validated = await getValidatedMappingByNormalizedName(normalizedForCache, 'fatsecret', trimmed);
  if (validated) {
    return validated;
  }

  const parsed = parseIngredientLine(trimmed);
  const baseName = parsed?.name?.trim() || trimmed;
  let normalization = normalizeIngredientName(baseName);
  let normalizedName = normalization.cleaned || baseName;

  // Extra safety: strip leading quantity/unit from normalizedName if parser failed to do so
  const stripLeadingQuantity = (value: string) => {
    // Patterns: numbers (with decimals/fractions) + optional units like cup, tbsp, tsp, oz, g, ml, packet(s)
    const UNIT_PATTERN = '(cups?|cup|tbsps?|tablespoons?|tbsp|tsps?|teaspoons?|tsp|oz|ounce?s?|g|gram?s?|kg|ml|l|liters?|packet?s?|packets?)';
    return value.replace(new RegExp(`^\\s*[\\d/.]+\\s*${UNIT_PATTERN}\\s+`, 'i'), '').trim();
  };
  normalizedName = stripLeadingQuantity(normalizedName);

  // Context-dependent normalization: bare "pepper" in spice context → "black pepper"
  // When the unit is a spice measure (dash, pinch, tsp, tbsp), the user means black pepper,
  // not bell/poblano/hungarian peppers. Rewriting the search query here ensures both
  // FatSecret and FDC APIs return spice results instead of vegetable varieties.
  const SPICE_CONTEXT_UNITS = new Set(['dash', 'pinch', 'tsp', 'tbsp', 'teaspoon', 'tablespoon']);
  const parsedUnitForContext = parsed?.unit?.toLowerCase() ?? '';
  if (/^pepper$/i.test(normalizedName.trim()) && SPICE_CONTEXT_UNITS.has(parsedUnitForContext)) {
    logger.info('fatsecret.map.pepper_spice_rewrite', { rawLine, originalName: normalizedName, unit: parsedUnitForContext });
    normalizedName = 'black pepper';
  }

  const extraSynonyms: string[] = [];
  const aiHint = await aiNormalizeIngredient(rawLine, normalization.cleaned);
  if (aiHint.status === 'success') {
    normalization = normalizeIngredientName(aiHint.normalizedName || baseName);
    normalizedName = stripLeadingQuantity(normalization.cleaned || baseName);
    extraSynonyms.push(...aiHint.synonyms);
    logger.info('fatsecret.map.ai_normalize_used', {
      rawLine,
      normalized: aiHint.normalizedName,
      synonyms: aiHint.synonyms,
      prepPhrases: aiHint.prepPhrases,
      sizePhrases: aiHint.sizePhrases,
    });
  } else if (aiHint.status === 'error' && aiHint.reason !== 'OPENAI_API_KEY missing') {
    logger.debug('fatsecret.map.ai_normalize_skipped', { rawLine, reason: aiHint.reason });
  }
  // const client = options.client ?? defaultClient; // Moved to destructuring
  // const minConfidence = options.minConfidence ?? 0; // Moved to destructuring
  const preferCache = FATSECRET_CACHE_MODE_HELPERS.shouldServeCache;
  // Always allow live FatSecret API fallback when cache is missing/weak
  // const allowLiveFallback = true; // Moved to destructuring

  let candidates: MappingCandidate[] = [];
  const seenFoodIds = new Set<string>();
  let cacheCandidateCount = 0;
  let apiCandidateCount = 0;
  let autocompleteBoostsApplied = 0;

  // Build multiple search expressions and try each
  const searchExpressions = buildSearchExpressions(parsed, normalizedName);
  if (normalization.nounOnly && !searchExpressions.includes(normalization.nounOnly)) {
    searchExpressions.push(normalization.nounOnly);
  }
  for (const syn of extraSynonyms) {
    if (syn && !searchExpressions.includes(syn)) {
      searchExpressions.push(syn);
    }
  }

  for (const query of searchExpressions) {
    // Allow up to 15 candidates per expression, but don't stop if we have enough total
    // We'll still check seenFoodIds to avoid duplicates across expressions

    let autocompleteSuggestions: FatSecretAutocompleteHit[] = [];
    if (preferCache) {
      try {
        autocompleteSuggestions = await client.autocompleteFoods(query, 5);
      } catch (error) {
        logger.debug('fatsecret.autocomplete_failed', { query, message: (error as Error).message });
      }
    }

    let cacheMatches = 0;
    if (preferCache) {
      try {
        const cachedFoods = await searchFatSecretCacheFoods(query, 20);
        for (const cached of cachedFoods) {
          if (seenFoodIds.has(cached.id)) continue;
          seenFoodIds.add(cached.id);
          const summary = cacheFoodToSummary(cached);
          candidates.push({
            food: summary,
            source: 'cache',
            baseScore: computeCandidateScore(summary, query, parsed),
            hydratedOverride: cacheFoodToDetails(cached),
            query,
          });
          cacheMatches += 1;
          cacheCandidateCount += 1;
        }
      } catch (error) {
        logger.warn('fatsecret.map.cache_search_failed', { message: (error as Error).message, query });
      }
    }

    const shouldCallApi = !preferCache || (cacheMatches === 0 && allowLiveFallback);
    if (!shouldCallApi) {
      continue;
    }

    try {
      const searchQueries = [query, ...autocompleteSuggestions.map((s) => s.value).slice(0, 3)];
      for (const searchQuery of searchQueries) {
        const foods = await client.searchFoodsV4(searchQuery, { maxResults: 15 });
        for (const food of foods) {
          // Avoid duplicates across all expressions
          if (seenFoodIds.has(food.id)) continue;
          seenFoodIds.add(food.id);

          candidates.push({
            food,
            source: 'search',
            baseScore: computeCandidateScore(food, searchQuery, parsed),
            query: searchQuery,
          });
          apiCandidateCount += 1;
        }
      }
      if (autocompleteSuggestions.length > 0) {
        autocompleteBoostsApplied += 1;
      }
    } catch (error) {
      logger.warn('fatsecret.map.search_failed', { message: (error as Error).message, query });
      // Continue to next expression
    }
  }

  // console.debug('DEBUG: candidates found', candidates.length);
  if (debug) {
    debugLogger.logDebug(`Candidates found for "${rawLine}"`, { count: candidates.length, candidates: candidates.map(c => c.food.name) });
  }
  if (candidates.length === 0) {
    // Retry Loop:
    // 1. If we haven't tried AI normalization yet, try it now
    if (aiHint.status !== 'success') {
      const retryAiHint = await aiNormalizeIngredient(rawLine, normalization.cleaned);
      if (retryAiHint.status === 'success') {
        logger.info('fatsecret.map.retry_with_ai_normalize', { rawLine, normalized: retryAiHint.normalizedName });
        if (retryAiHint.normalizedName && retryAiHint.normalizedName !== rawLine) {
          debugLogger.logAiUsage('normalize', { original: rawLine, normalized: retryAiHint.normalizedName });
          // Recursive call with the normalized name
          const retryResult = await mapIngredientWithFatsecret(retryAiHint.normalizedName, {
            client,
            minConfidence,
            allowLiveFallback,
            debug,
          });
          if (retryResult) {
            return retryResult;
          }
        }
      }
    }

    // 2. If still no candidates, try AI Search Refinement
    const refined = await refineSearchQuery(rawLine, []);
    if (refined) {
      logger.info('fatsecret.map.retry_with_refined_query', { rawLine, refined: refined.suggestedQuery });
      try {
        const refinedFoods = await client.searchFoodsV4(refined.suggestedQuery, { maxResults: 10 });
        for (const food of refinedFoods) {
          if (seenFoodIds.has(food.id)) continue;
          seenFoodIds.add(food.id);
          candidates.push({
            food,
            source: 'search',
            baseScore: computeCandidateScore(food, refined.suggestedQuery, parsed),
            query: refined.suggestedQuery,
          });
        }
      } catch (error) {
        logger.warn('fatsecret.map.refined_search_failed', { message: (error as Error).message });
      }
    }

    if (candidates.length === 0) {
      await trackValidationFailure(rawLine, {
        foodId: '', foodName: '', source: 'fatsecret', grams: 0, kcal: 0, protein: 0, carbs: 0, fat: 0, confidence: 0, quality: 'low', rawLine
      }, { approved: false, confidence: 0, reason: 'no_candidates_found' });
      return null;
    }
  }

  const normalizedQueryName = normalizeForMatch(parsed?.name || trimmed);
  const isTrivialSingleTokenQuery = TRIVIAL_SINGLE_TOKEN.has(normalizedQueryName);
  const isTrivialPhraseQuery = CLEAR_GENERIC_PHRASES.has(normalizedQueryName);
  const isTrivialQuery = isTrivialSingleTokenQuery || isTrivialPhraseQuery;
  const hasMeasurementInRaw = /^\s*[\d/.]+\s+\w+/.test(trimmed);

  // Require must-have tokens from the normalized name to be present in candidate names
  const mustHaveTokens = deriveMustHaveTokens(normalizedName);
  if (mustHaveTokens.length > 0) {
    const before = candidates.length;
    candidates = candidates.filter((c) => {
      const normalizedFoodName = normalizeForMatch(`${c.food.brandName ?? ''} ${c.food.name}`);
      return mustHaveTokens.every((t) => normalizedFoodName.includes(t));
    });
    if (debug && before !== candidates.length) {
      debugLogger.logDebug('Filtered candidates missing required tokens', {
        rawLine,
        required: mustHaveTokens,
        before,
        after: candidates.length,
      });
    }
    if (candidates.length === 0) {
      if (debug) {
        debugLogger.logDebug('All candidates removed by must-have tokens filter', {
          rawLine,
          required: mustHaveTokens,
        });
      }
      return null;
    }
  }

  // Prefer obvious generic matches for trivial queries (e.g., water, salt, vegetable oil) to avoid unnecessary rerank
  if (isTrivialQuery) {
    for (const candidate of candidates) {
      const normalizedFoodName = normalizeForMatch(`${candidate.food.brandName ?? ''} ${candidate.food.name}`);
      const isGeneric =
        (candidate.food.foodType ?? 'Generic').toLowerCase() === 'generic' && !candidate.food.brandName;
      if (isGeneric && normalizedFoodName === normalizedQueryName) {
        candidate.baseScore += 0.2; // Keep the obvious generic on top
      }
    }
  }

  candidates.sort((a, b) => b.baseScore - a.baseScore);

  // Exact match short-circuit: if we already have a deterministic match, skip AI rerank
  let rerankSkipReason: string | null = null;
  const exactMatchIdx = candidates.findIndex(
    (c) => normalizeForMatch(`${c.food.brandName ?? ''} ${c.food.name}`) === normalizedQueryName
  );
  if (exactMatchIdx !== -1 && !hasMeasurementInRaw) {
    const [match] = candidates.splice(exactMatchIdx, 1);
    candidates.unshift(match);
    rerankSkipReason = 'exact_match';
    logger.debug('fatsecret.map.ai_rerank_skipped', {
      rawLine,
      reason: rerankSkipReason,
      matchedId: match.food.id,
    });
  }

  // Detect ambiguous queries that should always use AI rerank
  const isAmbiguousQuery = (() => {
    if (candidates.length < 2) return false;

    // Check if top candidates have similar scores (within 0.1)
    const topScore = candidates[0].baseScore;
    const secondScore = candidates[1]?.baseScore ?? 0;
    const scoreGap = topScore - secondScore;
    if (scoreGap < 0.1 && topScore > 0.3) {
      return true; // Top candidates are too close
    }

    // Check if query contains ambiguous terms (sausage without meat type, generic terms)
    const queryLower = (parsed?.name?.trim() || trimmed).toLowerCase();
    const ambiguousTerms = ['sausage', 'oil', 'flour', 'cheese', 'sauce'];
    const hasAmbiguousTerm = ambiguousTerms.some(term =>
      queryLower.includes(term) && !/\b(chicken|pork|beef|turkey|olive|canola|vegetable)\b/.test(queryLower)
    );
    if (hasAmbiguousTerm) {
      return true;
    }

    // Check if query contains multiple food types (could match different categories)
    const meatTypes = ['chicken', 'pork', 'beef', 'turkey', 'fish', 'salmon'];
    const meatTypeCount = meatTypes.filter(m => queryLower.includes(m)).length;
    if (meatTypeCount > 1) {
      return true; // Multiple meat types mentioned
    }

    return false;
  })();

  // Use AI rerank for ambiguous queries or when we have multiple candidates
  // Lower threshold to 0.6 to catch more edge cases
  const topScore = candidates[0].baseScore;
  const secondScore = candidates[1]?.baseScore ?? 0;
  const scoreGap = topScore - secondScore;
  const hasSmallGap = scoreGap < 0.1 && topScore < 0.8;
  const isClearLeader = topScore >= 0.85 && scoreGap >= 0.15;
  const shouldUseAiRerank =
    !rerankSkipReason &&
    !isTrivialQuery &&
    !isClearLeader &&
    (isAmbiguousQuery || (candidates.length > 1 && hasSmallGap));

  if (!shouldUseAiRerank && !rerankSkipReason) {
    const reason = isTrivialQuery ? 'trivial_query' : isClearLeader ? 'clear_leader' : null;
    if (reason) {
      logger.debug('fatsecret.map.ai_rerank_skipped', { rawLine, reason, topScore, scoreGap });
    }
  }
  let aiValidationData: { id: string; confidence: number; reason: string } | null = null;

  if (shouldUseAiRerank) {
    try {
      const topForAi = candidates.slice(0, 5).map((c) => ({
        id: c.food.id,
        name: c.food.name,
        brandName: c.food.brandName,
        foodType: c.food.foodType,
        score: c.baseScore,
      }));
      // Allow lower floor for ambiguous queries so rerank can still choose among close candidates
      const minAiConfidence = isAmbiguousQuery ? 0.4 : 0.6;
      const aiPick = await rerankFatsecretCandidates(rawLine, topForAi, minAiConfidence);
      if (aiPick.status === 'success') {
        const idx = candidates.findIndex((c) => c.food.id === aiPick.id);
        if (idx > -1) {
          const [picked] = candidates.splice(idx, 1);
          // Boost based on AI confidence (stronger boost for ambiguous queries)
          const boostMultiplier = isAmbiguousQuery ? 0.2 : 0.1;
          picked.baseScore += boostMultiplier * aiPick.confidence;
          candidates.unshift(picked);

          aiValidationData = {
            id: aiPick.id,
            confidence: aiPick.confidence,
            reason: aiPick.rationale ?? 'AI Rerank',
          };

          logger.info('fatsecret.map.ai_rerank_used', {
            rawLine,
            pickedId: aiPick.id,
            aiConfidence: aiPick.confidence,
            isAmbiguous: isAmbiguousQuery,
            rationale: aiPick.rationale,
          });
          if (debug) {
            debugLogger.logAiUsage('retry', {
              original: rawLine,
              pickedId: aiPick.id,
              aiConfidence: aiPick.confidence,
              rationale: aiPick.rationale,
              subType: 'rerank'
            });
          }
        }
      } else {
        logger.debug('fatsecret.map.ai_rerank_skipped', {
          rawLine,
          reason: aiPick.reason,
          isAmbiguous: isAmbiguousQuery,
        });
      }
    } catch (err) {
      logger.warn('fatsecret.map.ai_rerank_failed', { message: (err as Error).message });
    }
  }

  for (const candidate of candidates.slice(0, 6)) {
    const hydrated = await hydrateCandidateFromCacheOrApi(
      candidate,
      client,
      preferCache,
      allowLiveFallback,
    );
    if (!hydrated || !hydrated.servings || hydrated.servings.length === 0) continue;

    let servingSelection = selectServing(parsed, hydrated.servings);
    // console.debug('DEBUG: servingSelection', servingSelection);
    if (debug && !servingSelection) {
      debugLogger.logDebug(`No serving match for "${rawLine}"`, { food: hydrated.name, parsed, servings: hydrated.servings });
    }
    if (!servingSelection) {
      continue;
    }

    const qty = parsed ? parsed.qty * parsed.multiplier : 1;

    // Compute grams: prefer gramsPerUnit * qty, fallback to baseGrams
    // If serving weight is available but unit matching is weak, still use it
    let grams = servingSelection.gramsPerUnit != null
      ? servingSelection.gramsPerUnit * qty
      : servingSelection.baseGrams ?? null;

    // If we have a valid serving but gramsPerUnit calculation failed,
    // try using serving weight directly (this handles cases where unit matching was weak)
    if ((!grams || grams <= 0) && servingSelection.baseGrams && servingSelection.baseGrams > 0) {
      // Use base grams directly if we couldn't compute per-unit grams
      grams = servingSelection.baseGrams;
    }

    // If grams is still null, try using servingWeightGrams from the serving object directly
    if ((!grams || grams <= 0) && servingSelection.serving.servingWeightGrams && servingSelection.serving.servingWeightGrams > 0) {
      grams = servingSelection.serving.servingWeightGrams;
    }

    // Serving sanity check: if parsed unit is a volume/solid unit (cup, tbsp, tsp, etc.) and grams < 10,
    // treat it as a bad match and fall back to a better serving
    // This catches cases where FatSecret picks a tiny serving (e.g., 1 tsp = 2g) for a volume request (e.g., 1 cup)
    const volumeAndSolidUnits = ['cup', 'cups', 'tablespoon', 'tablespoons', 'tbsp', 'tbs', 'teaspoon', 'teaspoons', 'tsp', 'ml', 'milliliter', 'milliliters', 'liter', 'liters', 'l', 'fl oz', 'fluid ounce', 'fluid ounces'];
    const isVolumeOrSolidUnit = parsed?.unit && volumeAndSolidUnits.some(vu => parsed.unit!.toLowerCase().includes(vu));

    // Special handling for produce (onion, tomato, pepper) where "cup" is common but might map to a tiny serving
    // If unit is "cup" and food is produce, be more aggressive about finding a larger serving
    const isProduce = /onion|tomato|pepper|jalapeno|carrot|celery|zucchini|mushroom|spinach|kale/i.test(hydrated.name);
    const isCup = parsed?.unit && /cup/i.test(parsed.unit);
    const minGrams = isProduce && isCup ? 50 : 10; // Expect at least 50g for a cup of produce

    if (grams && grams > 0 && isVolumeOrSolidUnit && grams < minGrams) {
      const originalGrams = grams;
      const originalServing = servingSelection.serving;

      // Try to find a better serving: prefer 100g/ml serving, otherwise any serving with weight >= 10g
      const betterServing = hydrated.servings.find(s => {
        const desc = (s.description ?? '').toLowerCase();
        const has100g = /100\s*(g|gram|grams|ml|milliliter)/i.test(desc) && s.servingWeightGrams && Math.abs(s.servingWeightGrams - 100) < 5;
        const hasGoodWeight = s.servingWeightGrams && s.servingWeightGrams >= 10;
        return has100g || hasGoodWeight;
      });

      if (betterServing) {
        const fallbackBaseGrams = betterServing.servingWeightGrams ?? 100;
        // Use the serving's own servingWeightGrams if >= 10, otherwise fall back to 100g/ml
        // For volume units, we still multiply by qty to respect the user's quantity
        grams = fallbackBaseGrams * (qty || 1);

        // Update serving selection to use the better serving
        // Macros will be recomputed later using this new serving
        servingSelection = {
          serving: betterServing,
          matchScore: servingSelection.matchScore,
          gramsPerUnit: betterServing.servingWeightGrams ?? null,
          unitsPerServing: 1,
          baseGrams: betterServing.servingWeightGrams ?? null,
        };

        logger.warn('fatsecret.map.tiny_serving', {
          rawLine,
          foodId: hydrated.id,
          originalGrams,
          fallbackGrams: grams,
          originalServingDesc: originalServing.description,
          fallbackServingDesc: betterServing.description,
          unit: parsed?.unit,
          reason: 'volume_unit_grams_too_low_fallback',
        });
      } else {
        // No better serving found (all servings are < 10g), but still log the issue
        // In this case, we'll continue with the original tiny serving, but log a warning
        logger.warn('fatsecret.map.tiny_serving', {
          rawLine,
          foodId: hydrated.id,
          grams,
          unit: parsed?.unit,
          servingDesc: servingSelection.serving.description,
          servingWeightGrams: servingSelection.serving.servingWeightGrams,
          reason: 'volume_unit_grams_too_low_no_fallback',
        });
      }
    }

    grams = applyServingDefaults(parsed, rawLine, servingSelection, grams);

    // === SANITY CHECK 1: Piece/chunk/each units with suspiciously high gramsPerUnit ===
    // When unit is piece/chunk/each and gramsPerUnit > 50g, the serving is likely a full
    // 100g reference serving, not a per-piece weight. Trigger AI backfill for accurate estimate.
    const COUNT_UNIT_SET = new Set(['piece', 'pieces', 'each', 'chunk', 'chunks', 'pc', 'pcs']);
    const parsedUnitLower = parsed?.unit?.toLowerCase() ?? '';
    const isCountUnit = COUNT_UNIT_SET.has(parsedUnitLower);
    const MAX_PIECE_GRAMS = 50;

    if (isCountUnit && grams && qty > 0) {
      const effectivePerPiece = servingSelection.gramsPerUnit ?? (grams / qty);
      if (effectivePerPiece > MAX_PIECE_GRAMS) {
      try {
        const backfillResult = await backfillOnDemand(hydrated.id, 'count', parsedUnitLower);
        if (backfillResult.success) {
          // Re-hydrate to pick up the new AI-estimated serving
          const rehydrated = await client.getFoodDetails(hydrated.id);
          if (rehydrated?.servings && rehydrated.servings.length > 0) {
            const newSelection = selectServing(parsed, rehydrated.servings);
            if (newSelection && newSelection.gramsPerUnit && newSelection.gramsPerUnit <= MAX_PIECE_GRAMS) {
              logger.info('fatsecret.map.piece_backfill_applied', {
                rawLine,
                foodName: hydrated.name,
                oldGrams: grams,
                newGramsPerUnit: newSelection.gramsPerUnit,
                newGrams: newSelection.gramsPerUnit * qty,
              });
              servingSelection = newSelection;
              grams = newSelection.gramsPerUnit * qty;
            }
          }
        }
      } catch (err) {
        logger.warn('fatsecret.map.piece_backfill_error', { rawLine, error: (err as Error).message });
      }
      }
    }

    // === SANITY CHECK 2: Whole produce items with suspiciously low grams ===
    // When no unit is specified and the food is produce (avocado, mango, etc.),
    // grams < 30g suggests a tiny slice serving was selected instead of a whole item.
    const noExplicitUnit = !parsed?.unit;
    const isProduceItem = isProduceFn(hydrated.name);
    const MIN_WHOLE_PRODUCE_GRAMS = 30;

    if (noExplicitUnit && isProduceItem && grams && grams > 0 && grams < MIN_WHOLE_PRODUCE_GRAMS) {
      try {
        const backfillResult = await backfillOnDemand(hydrated.id, 'count', 'whole');
        if (backfillResult.success) {
          const rehydrated = await client.getFoodDetails(hydrated.id);
          if (rehydrated?.servings && rehydrated.servings.length > 0) {
            const newSelection = selectServing(parsed, rehydrated.servings);
            if (newSelection && newSelection.baseGrams && newSelection.baseGrams >= MIN_WHOLE_PRODUCE_GRAMS) {
              logger.info('fatsecret.map.produce_backfill_applied', {
                rawLine,
                foodName: hydrated.name,
                oldGrams: grams,
                newGrams: newSelection.baseGrams * qty,
              });
              servingSelection = newSelection;
              grams = (newSelection.gramsPerUnit ?? newSelection.baseGrams) * qty;
            }
          }
        }
      } catch (err) {
        logger.warn('fatsecret.map.produce_backfill_error', { rawLine, error: (err as Error).message });
      }
    }

    if (!grams || grams <= 0) continue;

    const macros = computeMacros(
      servingSelection.serving,
      qty,
      servingSelection.unitsPerServing,
      grams
    );
    if (!macros) continue;

    // Check if serving description matches unit/unitHint for bonus
    const servingDesc = (servingSelection.serving.description ?? '').toLowerCase();
    const unitLower = parsed?.unit?.toLowerCase();
    const unitHintLower = parsed?.unitHint?.toLowerCase();

    // Unit match bonus - check for word boundary matches
    let unitMatchBonus = 0;
    if (unitLower) {
      const unitMappings: Record<string, string[]> = {
        'cup': ['cup', 'c'],
        'tbsp': ['tbsp', 'tablespoon', 'tablespoons', 'tbs'],
        'tsp': ['tsp', 'teaspoon', 'teaspoons'],
        'gram': ['g', 'gram', 'grams'],
        'ml': ['ml', 'milliliter', 'milliliters'],
        'oz': ['oz', 'ounce', 'ounces'],
      };
      const unitVariants = unitMappings[unitLower] || [unitLower];
      const hasUnit = unitVariants.some(v => {
        const regex = new RegExp(`\\b${v}\\b`, 'i');
        return regex.test(servingDesc);
      });
      if (hasUnit) {
        unitMatchBonus = 0.05;
      }
    }

    // UnitHint match bonus
    const unitHintMatchBonus = unitHintLower && servingDesc.includes(unitHintLower) ? 0.05 : 0;

    // Detect herbs/spices to adjust weighting
    // Herbs/spices often have tiny servings which get penalized heavily by the serving match score
    // We want to rely more on the name match for these
    const isHerbOrSpice = parsed?.name && (
      parsed.name.match(/\b(powder|seasoning|spice|herb|leaves|ground|dried|flakes|rub|mix)\b/i) ||
      ['salt', 'pepper', 'cinnamon', 'cumin', 'paprika', 'oregano', 'basil', 'thyme', 'rosemary'].some(s => parsed.name.toLowerCase().includes(s))
    );

    const baseScoreWeight = isHerbOrSpice ? 0.55 : 0.45;
    const servingScoreWeight = isHerbOrSpice ? 0.15 : 0.25;

    // Exact name match bonus
    // If the food name is a very close match to the query, give a significant boost
    const normalizedQuery = normalizeQuery(parsed?.name?.trim() || rawLine.trim());
    const normalizedFoodName = normalizeQuery(hydrated.name);
    const isExactMatch = normalizedQuery === normalizedFoodName || normalizedFoodName === normalizedQuery + 's' || normalizedQuery === normalizedFoodName + 's';
    const exactMatchBonus = isExactMatch ? 0.20 : 0;  // QUICK FIX: Doubled from 0.10

    // Brand penalty for generic queries
    // If query is generic (e.g. "flour") but result is specific brand (e.g. "King Arthur Flour"), penalize slightly
    // unless the user asked for a brand
    const queryHasBrand = parsed?.name?.match(/\b(brand|king arthur|gold medal|pillsbury)\b/i); // Simplified check
    const isGenericQuery = !queryHasBrand && normalizedQuery.split(/\s+/).length <= 2;
    const brandPenalty = (hydrated.brandName && isGenericQuery) ? -0.05 : 0;

    // Prefer Generic foods over Branded for generic queries
    // FoodType is typically "Generic" or "Brand" in FatSecret
    const isGenericFood = hydrated.foodType?.toLowerCase() === 'generic' || !hydrated.brandName;
    const genericBonus = (isGenericFood && !queryHasBrand && isGenericQuery) ? 0.05 : 0;

    // Penalize cooked/raw mismatches
    // Detect cooking state in query and food name
    const queryCookState = detectCookState(parsed?.name || rawLine);
    const foodCookState = detectCookState(hydrated.name);
    const cookStateMismatch = (queryCookState && foodCookState && queryCookState !== foodCookState);

    // PHASE A: Only harsh penalty if user EXPLICITLY requested cook state
    const explicitCookState = /\b(raw|uncooked|cooked|baked|fried|grilled|roasted)\b/i.test(parsed?.name || rawLine);
    const cookStatePenalty = cookStateMismatch ? (explicitCookState ? -0.15 : -0.05) : 0;

    // Boost for nutrient density match (e.g., high-protein queries)
    let nutrientDensityBonus = 0;
    const queryLower = (parsed?.name || rawLine).toLowerCase();
    const hasHighProteinQuery = /\b(high-protein|protein|lean)\b/i.test(queryLower);

    if (hasHighProteinQuery && hydrated.servings && hydrated.servings.length > 0) {
      // Try to find a 100g serving for nutrient density calculation
      const serving100g = hydrated.servings.find(s => {
        const desc = (s.description ?? '').toLowerCase();
        return /100\s*(g|gram)/i.test(desc) && s.servingWeightGrams && Math.abs(s.servingWeightGrams - 100) < 5;
      });

      if (serving100g && serving100g.protein && serving100g.calories) {
        const protein100g = serving100g.protein;
        const kcal100 = serving100g.calories || 1; // Avoid division by zero
        const proteinPer100kcal = (protein100g / kcal100) * 100;
        // High protein is typically >20g per 100 kcal
        if (proteinPer100kcal > 20) {
          nutrientDensityBonus = 0.05;
        }
      }
    }

    // Confidence boost when food name shares >= 2 tokens with the query
    // This keeps good generic matches (egg, chicken) from being dropped due to low serving match score
    let confidenceBoostWhenExactFoodMatch = 0;
    if (servingSelection.matchScore < 0.5) {
      // Check token overlap between food name and the base query
      const baseQuery = normalizeQuery(parsed?.name?.trim() || rawLine.trim());
      const queryTokens = new Set(baseQuery.split(/\s+/).filter(w => w.length > 2));
      const foodNameTokens = new Set(normalizeQuery(hydrated.name).split(/\s+/).filter(w => w.length > 2));
      let tokenOverlap = 0;
      for (const token of queryTokens) {
        if (foodNameTokens.has(token)) {
          tokenOverlap++;
        }
      }
      if (tokenOverlap >= 2) {
        confidenceBoostWhenExactFoodMatch = 0.05;
      }
    }

    // ACCURACY FIX: Common ingredient boost
    // Ingredients that appear in 50%+ of recipes get a small confidence boost
    const commonIngredients = new Set([
      'chicken', 'beef', 'pork', 'turkey', 'salmon', 'shrimp', 'tuna',
      'egg', 'eggs', 'milk', 'butter', 'cheese', 'yogurt', 'cream',
      'flour', 'sugar', 'salt', 'pepper', 'oil', 'olive oil', 'water',
      'onion', 'onions', 'garlic', 'tomato', 'tomatoes', 'potato', 'potatoes',
      'carrot', 'carrots', 'celery', 'bell pepper', 'broccoli', 'spinach',
      'rice', 'pasta', 'bread', 'oats', 'quinoa',
      'lemon', 'lime', 'parsley', 'basil', 'oregano', 'cumin', 'paprika',
      'soy sauce', 'vinegar', 'honey', 'maple syrup'
    ]);

    const normalizedIngredient = (parsed?.name || rawLine).toLowerCase().trim();
    const isCommonIngredient = Array.from(commonIngredients).some(common =>
      normalizedIngredient.includes(common) || common.includes(normalizedIngredient)
    );
    const commonIngredientBonus = isCommonIngredient ? 0.05 : 0;

    // ACCURACY FIX: Prepared food & restaurant detection with heavy penalty
    const preparedFoodKeywords = [
      'rings', 'nuggets', 'strips', 'patty', 'sandwich', 'burger',
      'pizza', 'taco', 'burrito', 'wrap', 'bowl', 'platter',
      'combo', 'meal', 'dinner', 'breakfast', 'lunch', 'wings',
      'fries', 'tots', 'sticks', 'bites', 'popcorn chicken'
    ];

    const restaurantBrands = [
      'mcdonalds', 'denny', 'burger king', 'wendys', 'taco bell',
      'kfc', 'subway', 'chipotle', 'panera', 'applebee',
      'chili', 'olive garden', 'red lobster', 'outback'
    ];

    const foodNameLower = hydrated.name.toLowerCase();
    const brandNameLower = (hydrated.brandName || '').toLowerCase();

    const isPreparedFood = preparedFoodKeywords.some(kw => foodNameLower.includes(kw));
    const isRestaurant = restaurantBrands.some(brand =>
      brandNameLower.includes(brand) || foodNameLower.includes(brand)
    );

    // Heavy penalty for prepared/restaurant foods (-0.30)
    const preparedFoodPenalty = (isPreparedFood || isRestaurant) ? -0.30 : 0;

    // ACCURACY FIX: Specificity bonus - reward matching ALL query tokens
    const queryTokens = normalizedQuery.split(/\s+/).filter(t => t.length > 2);
    const foodTokens = normalizedFoodName.split(/\s+/).filter(t => t.length > 2);

    let specificityBonus = 0;
    if (queryTokens.length > 1) {
      const matchCount = queryTokens.filter(qt =>
        foodTokens.some(ft => ft.includes(qt) || qt.includes(ft))
      ).length;

      // Bonus if ALL query tokens match
      if (matchCount === queryTokens.length) {
        specificityBonus = 0.10;
      }
    }

    // ACCURACY FIX: Ground beef leanness matching
    let leanessMatchBonus = 0;
    const isGroundBeef = /ground\s+beef/i.test(parsed?.name || rawLine);
    if (isGroundBeef) {
      // Parse leanness from query (e.g., "90% lean", "90/10", "90%")
      const leannessMatch = rawLine.match(/(\d{2,3})\s*%?\s*(lean|\/)/i);
      if (leannessMatch) {
        const leanPercent = parseInt(leannessMatch[1]);
        const targetFatPercent = 100 - leanPercent;  // 90% lean = 10% fat

        // Calculate fat percentage of this food
        const serving = servingSelection.serving;
        if (serving.fat && serving.servingWeightGrams) {
          const actualFatPercent = (serving.fat / serving.servingWeightGrams) * 100;
          const fatDiff = Math.abs(actualFatPercent - targetFatPercent);

          // Bonus if within 5% of target fat content
          if (fatDiff < 5) {
            leanessMatchBonus = 0.15;
          }
        }
      }
    }

    const confidence = clamp(
      0.25 +
      Math.min(1, Math.max(0, candidate.baseScore)) * baseScoreWeight +
      servingSelection.matchScore * servingScoreWeight +
      (hydrated.country?.toUpperCase() === 'US' ? 0.05 : 0) +
      (unitHintLower && hydrated.name.toLowerCase().includes(unitHintLower) ? 0.05 : 0) +
      unitMatchBonus +
      unitHintMatchBonus +
      confidenceBoostWhenExactFoodMatch +
      exactMatchBonus +
      brandPenalty +
      genericBonus +
      cookStatePenalty +
      nutrientDensityBonus +
      commonIngredientBonus +
      preparedFoodPenalty +    // ACCURACY FIX: -0.30 for restaurants/prepared
      specificityBonus +       // ACCURACY FIX: +0.10 for multi-token match
      leanessMatchBonus,       // ACCURACY FIX: +0.15 for ground beef fat%
      0,
      1
    );

    if (debug) {
      debugLogger.logDebug(`Candidate scored for "${rawLine}"`, {
        food: hydrated.name,
        confidence,
        baseScore: candidate.baseScore,
        servingMatch: servingSelection.matchScore,
        bonuses: {
          us: hydrated.country?.toUpperCase() === 'US',
          unitHint: !!unitHintLower && hydrated.name.toLowerCase().includes(unitHintLower),
          unitMatch: unitMatchBonus,
          unitHintMatch: unitHintMatchBonus,
          exactFoodMatch: confidenceBoostWhenExactFoodMatch,
          exactMatchBonus,
          brandPenalty,
          isHerbOrSpice,
          genericBonus,
          cookStatePenalty,
          explicitCookState,
          nutrientDensityBonus,
          commonIngredientBonus,
          preparedFoodPenalty,   // ACCURACY FIX: Show penalty
          specificityBonus,      // ACCURACY FIX: Show bonus
          leanessMatchBonus,     // ACCURACY FIX: Show bonus
          isPreparedFood,        // ACCURACY FIX: Show detection
          isRestaurant           // ACCURACY FIX: Show detection
        }
      });
    }

    if (confidence < minConfidence) {
      if (debug) {
        debugLogger.logDebug(`Candidate rejected (low confidence)`, { food: hydrated.name, confidence, minConfidence });
      }
      continue;
    }

    const result: FatsecretMappedIngredient = {
      source: 'fatsecret',
      foodId: hydrated.id,
      foodName: hydrated.name,
      brandName: hydrated.brandName,
      servingId: servingSelection.serving.id ?? undefined,
      servingDescription: servingSelection.serving.description ?? undefined,
      grams,
      kcal: macros.kcal,
      protein: macros.protein,
      carbs: macros.carbs,
      fat: macros.fat,
      confidence,
      quality: confidence >= 0.8 ? 'high' : (confidence >= 0.6 ? 'medium' : 'low'),
      rawLine: rawLine.trim(),
    };

    // AI Validation - run on EVERY final mapping
    let finalAiValidation: Awaited<ReturnType<typeof validateMappingWithAI>> | null = null;
    try {
      finalAiValidation = await validateMappingWithAI(rawLine, {
        foodId: result.foodId,
        foodName: result.foodName,
        brandName: result.brandName,
        searchQuery: normalizedName,  // Show AI the search query we used
        ourConfidence: confidence,
        nutrition: {  // Include nutrition for better validation
          protein: result.protein,
          carbs: result.carbs,
          fat: result.fat,
          kcal: result.kcal,
        },
      });

      // Log if AI rejects our confident choice
      if (!finalAiValidation.approved && confidence >= 0.7) {
        logger.warn('fatsecret.map.ai_rejected_confident_mapping', {
          rawLine,
          foodName: result.foodName,
          ourConfidence: confidence,
          aiConfidence: finalAiValidation.confidence,
          aiReason: finalAiValidation.reason,
          aiCategory: finalAiValidation.category,
        });
      }

      // Save to validated cache ONLY if AI approves with high confidence
      if (finalAiValidation.approved && finalAiValidation.confidence >= 0.85) {
        // Use normalizedName (from normalizeIngredientName) as cache key
        // This ensures lookups work correctly regardless of raw input format
        await saveValidatedMapping(rawLine, result, finalAiValidation, {
          canonicalBase: normalizedName,
        });
        logger.info('fatsecret.map.saved_to_validated_cache', {
          rawLine,
          normalizedForm: normalizedName,
          foodName: result.foodName,
          aiConfidence: finalAiValidation.confidence,
        });
      }

      // Attach AI validation result to return object
      result.aiValidation = {
        approved: finalAiValidation.approved,
        confidence: finalAiValidation.confidence,
        reason: finalAiValidation.reason,
        category: finalAiValidation.category,
        detectedIssues: finalAiValidation.detectedIssues,
      };
    } catch (error) {
      // If AI validation fails, log but continue (fail open)
      logger.error('fatsecret.map.ai_validation_error', {
        rawLine,
        error: (error as Error).message,
      });
    }

    if (preferCache) {
      logger.info('fatsecret.map.cache_usage', {
        cacheMode: FATSECRET_CACHE_MODE,
        usedSource: candidate.source,
        cacheCandidates: cacheCandidateCount,
        apiCandidates: apiCandidateCount,
        hydratedFromCache: Boolean(candidate.hydratedOverride),
        autocompleteBoostsApplied,
      });
    }
    return result;
  }

  // Second pass: if top candidate shares >= 2 tokens but serving match is low,
  // try the 100g serving regardless of unit match
  if (candidates.length > 0) {
    const topCandidate = candidates[0];
    const hydrated = await client.getFoodDetails(topCandidate.food.id);
    if (hydrated && hydrated.servings && hydrated.servings.length > 0) {
      // Check token overlap between food name and query
      const baseQuery = normalizeQuery(parsed?.name?.trim() || rawLine.trim());
      const queryTokens = new Set(baseQuery.split(/\s+/).filter(w => w.length > 2));
      const foodNameTokens = new Set(normalizeQuery(hydrated.name).split(/\s+/).filter(w => w.length > 2));
      let tokenOverlap = 0;
      for (const token of queryTokens) {
        if (foodNameTokens.has(token)) {
          tokenOverlap++;
        }
      }

      // If overlap >= 2 tokens, try 100g serving
      if (tokenOverlap >= 2) {
        // Find 100g/ml serving
        const serving100g = hydrated.servings.find(s => {
          const desc = (s.description ?? '').toLowerCase();
          return /100\s*(g|gram|grams|ml|milliliter)/i.test(desc) && s.servingWeightGrams && Math.abs(s.servingWeightGrams - 100) < 5;
        });

        if (serving100g) {
          const qty = parsed ? parsed.qty * parsed.multiplier : 1;
          // Use 100g as base and multiply by qty if applicable
          let grams = serving100g.servingWeightGrams ?? 100;
          // For cup/volume measures, estimate: 1 cup ≈ 240g for most solids
          if (parsed?.unit && /cup|tbsp|tsp/i.test(parsed.unit)) {
            // Rough volume-to-weight conversion (very approximate)
            grams = 100 * qty; // Use 100g as base per unit for volume measures
          } else {
            grams = 100 * qty; // For other cases, treat as 100g per unit
          }

          if (grams > 0) {
            const macros = computeMacros(serving100g, qty, 1); // 1 serving = 100g
            if (macros) {
              logger.info('fatsecret.map.second_pass_100g', {
                rawLine,
                foodId: hydrated.id,
                foodName: hydrated.name,
                tokenOverlap,
                servingDesc: serving100g.description,
                grams,
              });

              // Lower confidence since we used 100g fallback, but still accept if >= 0.3
              const fallbackConfidence = Math.max(0.3, Math.min(0.7, topCandidate.baseScore * 0.5 + 0.3));
              const result: FatsecretMappedIngredient = {
                source: 'fatsecret',
                foodId: hydrated.id,
                foodName: hydrated.name,
                brandName: hydrated.brandName,
                servingId: serving100g.id ?? undefined,
                servingDescription: serving100g.description ?? undefined,
                grams,
                kcal: macros.kcal,
                protein: macros.protein,
                carbs: macros.carbs,
                fat: macros.fat,
                confidence: fallbackConfidence,
                quality: fallbackConfidence >= 0.8 ? 'high' : (fallbackConfidence >= 0.6 ? 'medium' : 'low'),
                rawLine: rawLine.trim(),
              };
              if (preferCache) {
                logger.info('fatsecret.map.cache_usage', {
                  cacheMode: FATSECRET_CACHE_MODE,
                  usedSource: topCandidate.source,
                  cacheCandidates: cacheCandidateCount,
                  apiCandidates: apiCandidateCount,
                  hydratedFromCache: Boolean(topCandidate.hydratedOverride),
                  fallback: '100g',
                });
              }
              return result;
            }
          }
        }
      }
    }
  }

  // Track failure if we reached here without returning
  await trackValidationFailure(rawLine, {
    foodId: '', foodName: '', source: 'fatsecret', grams: 0, kcal: 0, protein: 0, carbs: 0, fat: 0, confidence: 0, quality: 'low', rawLine
  }, { approved: false, confidence: 0, reason: 'no_suitable_serving_found' });

  return null;
}

async function hydrateCandidateFromCacheOrApi(
  candidate: MappingCandidate,
  client: FatSecretClient,
  preferCache: boolean,
  allowLiveFallback: boolean,
): Promise<FatSecretFoodDetails | null> {
  if (candidate.hydratedOverride) return candidate.hydratedOverride;

  if (preferCache) {
    try {
      const cached = await getCachedFoodWithRelations(candidate.food.id);
      if (cached) {
        return cacheFoodToDetails(cached);
      }
      if (allowLiveFallback) {
        const hydrated = await ensureFoodCached(candidate.food.id, {
          client,
          searchQuery: candidate.query,
        });
        if (hydrated?.food) {
          const refreshed = await getCachedFoodWithRelations(hydrated.food.id);
          if (refreshed) {
            return cacheFoodToDetails(refreshed);
          }
        }
      }
    } catch (error) {
      logger.warn('fatsecret.map.cache_hydrate_failed', {
        message: (error as Error).message,
        foodId: candidate.food.id,
        query: candidate.query,
      });
    }
  }

  const details = await client.getFoodDetails(candidate.food.id);

  // Inline AI serving backfill: if details lack usable servings, try to backfill
  // console.debug('DEBUG: hydrate details', details?.id, details?.servings?.length);
  if (details && allowLiveFallback) {
    const hasWeight = details.servings?.some(s => (s.servingWeightGrams ?? 0) > 0);
    const hasVolume = details.servings?.some(s => (s.metricServingUnit === 'ml' || s.metricServingUnit === 'l') && (s.metricServingAmount ?? 0) > 0);

    if (!hasWeight && !hasVolume) {
      // Try to backfill weight-based serving first (most critical)
      const backfillResult = await insertAiServing(details.id, 'weight');
      if (backfillResult.success) {
        logger.info('fatsecret.map.inline_backfill_success', { foodId: details.id });
        // Re-fetch details to get the new serving
        return client.getFoodDetails(candidate.food.id);
      }
    }
  }

  return details;
}


function computeCandidateScore(food: FatSecretFoodSummary, query: string, parsed: ParsedIngredient | null): number {
  const normalizedQuery = normalizeQuery(query);
  const foodName = `${food.brandName ?? ''} ${food.name}`.trim().toLowerCase();
  const foodNameLower = foodName.toLowerCase();
  const queryTokens = tokenSet(normalizedQuery);
  const foodTokens = tokenSet(foodName);
  // Use weighted similarity to prioritize distinctive words (e.g., "chicken" > "sausage")
  const similarity = weightedJaccard(queryTokens, foodTokens);

  let score = similarity;

  // Strong boost for exact normalized name match
  if (normalizeForMatch(foodName) === normalizedQuery) {
    score += 0.4;
  }

  // Check if query mentions a brand
  const rawLineLower = parsed ? '' : query.toLowerCase();
  const queryText = parsed
    ? (normalizedQuery + ' ' + (parsed.qualifiers?.join(' ') || '')).toLowerCase()
    : rawLineLower;
  const queryHasBrand = /brand|fage|blue.?diamond|almond.?breeze|silk|califia|boar.?s head/i.test(
    queryText
  );

  // Boost generic foods if query doesn't mention a brand
  if ((food.foodType ?? 'Generic').toLowerCase() === 'generic' && !queryHasBrand) {
    score += 0.1;
  }

  // Penalize missing critical qualifiers/types to avoid generic downgrades
  const qualifierGroups: Array<{ tokens: string[]; penalty: number }> = [
    { tokens: ['coconut'], penalty: 0.35 },
    { tokens: ['almond'], penalty: 0.35 },
    { tokens: ['soy'], penalty: 0.4 },
    { tokens: ['oat'], penalty: 0.4 },
    { tokens: ['unsweetened'], penalty: 0.5 },
    { tokens: ['sweetened'], penalty: 0.45 },
    { tokens: ['salted'], penalty: 0.6 },
    { tokens: ['unsalted'], penalty: 0.6 },
    { tokens: ['part skim', 'part-skim'], penalty: 0.4 },
    { tokens: ['low moisture', 'low-moisture'], penalty: 0.4 },
    { tokens: ['reduced fat', 'low fat', 'light', 'nonfat'], penalty: 0.45 },
    { tokens: ['riced'], penalty: 0.5 },
    { tokens: ['chunk'], penalty: 0.45 },
    { tokens: ['spread'], penalty: 0.5 },
    { tokens: ['monk fruit', 'erythritol', 'stevia'], penalty: 0.4 },
    { tokens: ['granola'], penalty: 0.3 },
    { tokens: ['fat bomb'], penalty: 0.5 },
  ];

  for (const group of qualifierGroups) {
    const queryHasToken = group.tokens.some((t) => queryText.includes(t));
    const foodHasToken = group.tokens.some((t) => foodNameLower.includes(t));
    if (queryHasToken && !foodHasToken) {
      score *= (1 - group.penalty);
      // If we already penalized hard, stop early for low scores
      if (score < 0.2) {
        return Math.max(score, 0);
      }
    }
  }

  // Meat type mismatch handling - use multiplicative penalties for critical mismatches
  const meatHints = ['chicken', 'beef', 'pork', 'turkey', 'sausage', 'ham', 'bacon'];
  const queryMeats = meatHints.filter((m) => queryText.includes(m));
  const foodMeats = meatHints.filter((m) => foodName.includes(m));
  let meatMismatchDetected = false;
  if (queryMeats.length > 0 && foodMeats.length > 0) {
    const mismatch = !foodMeats.some((m) => queryMeats.includes(m));
    if (mismatch) {
      // Multiplicative penalty makes mismatches harder to override
      score *= 0.3;
      meatMismatchDetected = true;
      logger.debug('fatsecret.map.meat_mismatch', {
        query: queryText,
        foodName: foodName,
        queryMeats,
        foodMeats,
        scoreAfterPenalty: score,
      });
    }
  } else if (queryMeats.length > 0 && foodMeats.length === 0) {
    // Query specifies meat type but food doesn't - moderate penalty
    score *= 0.6;
  }
  // Chicken sausage specificity: favor chicken sausage, penalize pork/Italian when chicken is asked
  const chickenSausageQuery = /\bchicken\b.*\bsausage\b/.test(queryText);
  if (chickenSausageQuery) {
    if (/chicken/.test(foodNameLower) && /sausage/.test(foodNameLower)) {
      score += 0.2; // Boost for correct match
    } else if ((/pork|italian/.test(foodNameLower)) && !/chicken/.test(foodNameLower)) {
      // Multiplicative penalty for wrong meat type when chicken is explicitly requested
      score *= 0.25;
      meatMismatchDetected = true;
      logger.debug('fatsecret.map.chicken_sausage_mismatch', {
        query: queryText,
        foodName: foodName,
        scoreAfterPenalty: score,
      });
    }
  }

  // Canned vs fresh heuristic - use multiplicative penalty for mismatches
  const queryCanned = /\bcanned\b/.test(queryText);
  const foodCanned = /\bcanned\b/.test(foodName);
  if (queryCanned && foodCanned) {
    score += 0.05; // Boost for correct match
  } else if (queryCanned && !foodCanned) {
    // Query wants canned but food is fresh - moderate penalty
    score *= 0.7;
  } else if (!queryCanned && foodCanned) {
    // Query wants fresh but food is canned - stronger penalty
    score *= 0.5;
  }

  // Brand handling
  if (food.brandName) {
    const brandLower = food.brandName.toLowerCase();
    if (queryText.includes(brandLower)) {
      score += 0.1;
    } else if (!queryHasBrand) {
      // Only penalize if we didn't ask for a brand
      score -= 0.05;
    }
  }

  // Cooked/raw preference matching - use multiplicative penalty for conflicts
  const cookPreference = detectCookPreference(queryText);
  if (cookPreference) {
    const matches =
      cookPreference === 'cooked'
        ? /cooked|baked|roasted|grilled|boiled|steamed|boiled/.test(foodNameLower)
        : /raw|uncooked|fresh|dry/.test(foodNameLower);
    const conflicts =
      cookPreference === 'cooked'
        ? /raw|uncooked/.test(foodNameLower)
        : /cooked|baked|roasted|grilled|boiled|steamed/.test(foodNameLower);
    if (matches) {
      score += 0.15; // Boost for correct match
    }
    if (conflicts) {
      // Multiplicative penalty for cooking state conflicts
      score *= 0.4;
      logger.debug('fatsecret.map.cook_state_conflict', {
        query: queryText,
        foodName: foodName,
        preference: cookPreference,
        scoreAfterPenalty: score,
      });
    }
  }

  // Unit hint matching
  if (parsed?.unitHint) {
    const unitHintLower = parsed.unitHint.toLowerCase();
    if (foodName.includes(unitHintLower)) {
      score += 0.2;
    }
  }

  // Qualifier matching - improved scoring per qualifier
  if (parsed?.qualifiers && parsed.qualifiers.length > 0) {
    const qualifierLower = parsed.qualifiers.map((q) => q.toLowerCase());

    // Important qualifiers that should boost score when matched
    const importantQualifiers = [
      'diced',
      'chopped',
      'sliced',
      'minced',
      'grated',
      'unsweetened',
      'sweetened',
      'whole',
    ];

    // Count matches for important qualifiers (+0.1 per match)
    let qualifierMatches = 0;
    for (const q of qualifierLower) {
      if (importantQualifiers.includes(q) && foodNameLower.includes(q)) {
        qualifierMatches++;
        score += 0.1;
      } else if (foodNameLower.includes(q)) {
        qualifierMatches++;
        score += 0.05; // Smaller boost for other qualifiers
      }
    }

    // Check for extra qualifiers in food name that aren't in query (penalty)
    const commonQualifiers = [
      'diced',
      'chopped',
      'sliced',
      'minced',
      'grated',
      'unsweetened',
      'sweetened',
      'whole',
      'skim',
      'low-fat',
      'reduced-fat',
      'baked',
      'roasted',
    ];
    const foodQualifiers = commonQualifiers.filter((q) => foodNameLower.includes(q));
    const queryQualifiers = commonQualifiers.filter((q) => qualifierLower.includes(q));
    const extraQualifiers = foodQualifiers.filter((q) => !queryQualifiers.includes(q));
    if (extraQualifiers.length > 0 && qualifierMatches === 0) {
      score -= 0.05; // Small penalty for flavor variants we didn't ask for
    }
  }

  // Candidate ranking fixes: prefer generic/raw meats and oils, de-rank deli/branded spreads for generic queries
  const isMeatQuery = /\b(chicken|turkey|beef|pork|steak|ham)\b/.test(queryText);
  if (isMeatQuery && !queryHasBrand) {
    if (/deli|rotisserie|smoked|breaded|nugget|patty|lunch meat|cold cut/.test(foodNameLower)) {
      score -= 0.12;
    }
    if (/raw|skinless|boneless|breast|thigh|drumstick/.test(foodNameLower)) {
      score += 0.08;
    }
  }

  const isOilQuery = /\b(vegetable oil|olive oil|canola oil|sunflower oil)\b/.test(queryText);
  if (isOilQuery) {
    if (/spread|margarine|butter/.test(foodNameLower)) {
      score -= 0.15;
    } else if (/oil/.test(foodNameLower)) {
      score += 0.08;
    }
  }

  const herbSpiceQuery = isHerbOrSpice(Array.from(queryTokens));
  if (herbSpiceQuery) {
    if (/seasoning|blend|mix/.test(foodNameLower) && !/seasoning|blend|mix/.test(queryText)) {
      score -= 0.08;
    }
    if (/raw|dried|fresh/.test(foodNameLower)) {
      score += 0.05;
    }
  }

  // Sausage heuristic: prefer chicken for "chicken sausage", de-rank pork/Italian
  const sausageQuery = /\bsausage\b/.test(queryText);
  const chickenHint = /\bchicken\b/.test(queryText);
  if (sausageQuery && chickenHint) {
    if (/chicken/.test(foodNameLower)) {
      score += 0.12;
    } else if (/pork|italian/.test(foodNameLower)) {
      score -= 0.12;
    }
  }

  // Bouillon/cube heuristic: prefer cube servings when "cube" or "bouillon" present
  const bouillonQuery = /\bbouillon\b/.test(queryText) || /\bcube\b/.test(queryText);
  if (bouillonQuery) {
    const hasCube = /cube/.test(foodNameLower);
    const hasBouillon = /bouillon/.test(foodNameLower);
    const isBrothOnly = /broth|stock/.test(foodNameLower) && !hasCube;
    if (hasCube || hasBouillon) score += 0.2;
    if (isBrothOnly) score -= 0.1;
  }

  return score;
}

function selectServing(
  parsed: ParsedIngredient | null,
  servings: FatSecretServing[]
): { serving: FatSecretServing; matchScore: number; gramsPerUnit: number | null; unitsPerServing: number; baseGrams: number | null } | null {
  if (!servings.length) return null;
  const qty = parsed ? parsed.qty * parsed.multiplier : 1;
  const unit = parsed?.unit?.toLowerCase() ?? null;
  let best: FatSecretServing | null = null;
  let bestScore = -Infinity;

  // Common unit mappings for better matching
  const unitMappings: Record<string, string[]> = {
    'cup': ['cup', 'c'],
    'tbsp': ['tbsp', 'tablespoon', 'tablespoons', 'tbs'],
    'tsp': ['tsp', 'teaspoon', 'teaspoons'],
    'gram': ['g', 'gram', 'grams'],
    'ml': ['ml', 'milliliter', 'milliliters'],
    'oz': ['oz', 'ounce', 'ounces'],
    'lb': ['lb', 'pound', 'pounds'],
  };

  for (const serving of servings) {
    let score = 0;
    const description = (serving.description ?? '').toLowerCase();

    // Check if parsed unit is a volume/solid unit (cup, tbsp, tsp, etc.)
    const volumeAndSolidUnits = ['cup', 'cups', 'tablespoon', 'tablespoons', 'tbsp', 'tbs', 'teaspoon', 'teaspoons', 'tsp', 'ml', 'milliliter', 'milliliters', 'liter', 'liters', 'l', 'fl oz', 'fluid ounce', 'fluid ounces'];
    const isVolumeOrSolidUnit = unit && volumeAndSolidUnits.some(vu => unit.includes(vu));

    // Strong match for exact unit (increased weight)
    let hasUnitMatch = false;
    if (unit) {
      const unitVariants = unitMappings[unit] || [unit];
      hasUnitMatch = unitVariants.some(v => {
        // Check for word boundary to avoid partial matches
        const regex = new RegExp(`\\b${v}\\b`, 'i');
        return regex.test(description);
      });
      if (hasUnitMatch) {
        // Only boost unit match score if serving weight is reasonable (>= 10g) or no volume/solid unit requested
        // This prevents tiny servings from scoring too high just because they match the unit
        if (!isVolumeOrSolidUnit || !serving.servingWeightGrams || serving.servingWeightGrams >= 10) {
          score += 1.5; // Increased weight for unit match
        } else {
          // Tiny serving matched unit - reduce the boost
          score += 0.5; // Reduced weight for tiny serving with unit match
        }
      }
    }

    // Strong match for unitHint (increased weight)
    if (parsed?.unitHint) {
      const unitHintLower = parsed.unitHint.toLowerCase();
      // Check if unitHint matches a known unit mapping
      const unitHintVariants = unitMappings[unitHintLower] || [unitHintLower];
      const hasUnitHint = unitHintVariants.some(v => {
        const regex = new RegExp(`\\b${v}\\b`, 'i');
        return regex.test(description);
      });
      if (hasUnitHint) {
        score += 0.8; // Increased weight for unitHint match
      } else if (description.includes(unitHintLower)) {
        // UnitHint appears in description even if not a standard unit
        score += 0.4;
      }
      // If unitHint matched, consider it a unit match
      if (hasUnitHint || description.includes(unitHintLower)) {
        hasUnitMatch = true;
      }
    }

    // Penalize tiny servings when parsed unit is a volume/solid unit
    if (isVolumeOrSolidUnit && serving.servingWeightGrams && serving.servingWeightGrams < 10) {
      score -= 0.8; // Increased penalty for tiny servings for volume/solid units
    }

    // Prefer 100g/ml servings when volume/solid unit is requested (even if unit matches, if it's tiny)
    // This ensures 100g entries score higher when the user asked for cups/tbsp/tsp
    if (isVolumeOrSolidUnit) {
      const is100g = /100\s*(g|gram|grams|ml|milliliter|milliliters)/i.test(description) &&
        serving.servingWeightGrams &&
        Math.abs(serving.servingWeightGrams - 100) < 5;
      if (is100g) {
        // Boost 100g/ml servings when volume unit is requested
        // Boost more if there's no unit match, or if there was a unit match but it's a tiny serving
        if (!hasUnitMatch) {
          score += 0.8; // Strong boost for 100g/ml fallback when no unit match
        } else if (hasUnitMatch) {
          // Even if unit matches, boost 100g/ml servings slightly to prefer them over tiny servings
          score += 0.4; // Moderate boost to prefer 100g/ml over tiny matched servings
        }
      } else if (!hasUnitMatch) {
        // If no unit match and not 100g/ml, prefer 100g/ml over other options
        if (/100\s*(g|gram|grams|ml|milliliter|milliliters)/i.test(description)) {
          score += 0.6; // Fallback weight for 100g/ml when no unit match
        }
      }
    } else if (!hasUnitMatch) {
      // Prefer 100g/ml servings if no unit match (for reliable macro calculation)
      if (/100\s*(g|gram|grams|ml|milliliter|milliliters)/i.test(description)) {
        score += 0.6; // Increased weight for 100g/ml fallback
      }
    }

    // Quantity matching (bonus if quantity matches)
    const units = serving.numberOfUnits ?? 1;
    if (qty === units) {
      score += 0.3;
    }

    if (!best || score > bestScore) {
      best = serving;
      bestScore = score;
    }
  }

  if (!best) {
    best = servings[0];
    bestScore = 0;
  }

  const unitsPerServing = best.numberOfUnits && best.numberOfUnits > 0 ? best.numberOfUnits : 1;
  const gramsPerServing = gramsForServing(best);
  const gramsPerUnit = gramsPerServing != null ? gramsPerServing / unitsPerServing : null;

  return {
    serving: best,
    matchScore: clamp(bestScore / 2.5, 0, 1), // Adjusted normalization for higher scores
    gramsPerUnit,
    unitsPerServing,
    baseGrams: gramsPerServing,
  };
}

function applyServingDefaults(
  parsed: ParsedIngredient | null,
  rawLine: string,
  servingSelection: { serving: FatSecretServing; matchScore: number; gramsPerUnit: number | null; unitsPerServing: number; baseGrams: number | null },
  baseGrams: number | null
): number | null {
  const qty = parsed ? parsed.qty * parsed.multiplier : 1;
  const unitLower = parsed?.unit?.toLowerCase() ?? '';
  const unitHintLower = parsed?.unitHint?.toLowerCase() ?? '';
  const tokens = cleanIngredientName(parsed?.name?.trim() || rawLine).split(/\s+/).filter(Boolean);
  const herbOrSpice = isHerbOrSpice(tokens);
  const includesSprig = tokens.includes('sprig');
  const includesBouillon = tokens.includes('bouillon');
  const includesCube = tokens.includes('cube');

  // Dash/pinch override to avoid 100g defaults
  if (unitLower === 'dash' || unitLower === 'pinch' || unitHintLower === 'dash' || unitHintLower === 'pinch') {
    return 0.6 * qty;
  }

  // Herb/spice tsp/tbsp overrides (avoid 100g fallbacks)
  const isLikelyHerb = herbOrSpice || /herb|spice/.test(unitHintLower);
  const shouldOverrideHerb = isLikelyHerb && (!baseGrams || baseGrams >= 80);
  if (shouldOverrideHerb) {
    if (unitLower === 'tbsp' || unitHintLower === 'tbsp' || unitHintLower === 'tablespoon') {
      return 2 * qty;
    }
    if (unitLower === 'tsp' || unitHintLower === 'tsp' || unitHintLower === 'teaspoon') {
      return 0.7 * qty;
    }
    if (unitLower === 'cup' || unitHintLower === 'cup') {
      // Rough cup of chopped herbs
      return 64 * qty; // 1 cup chopped herbs ~64g
    }
    if (unitLower === 'leaf' || unitLower === 'leaves' || unitHintLower === 'leaf' || unitHintLower === 'leaves') {
      return 0.5 * qty;
    }
    if (includesSprig) {
      return 0.5 * qty;
    }
  }

  // Garlic clove override
  const hasGarlic = tokens.includes('garlic');
  const hasClove = unitLower === 'clove' || unitLower === 'cloves' || unitHintLower === 'clove' || tokens.includes('clove') || tokens.includes('cloves');
  if (hasGarlic && hasClove && (!baseGrams || baseGrams >= 50)) {
    return 3 * qty;
  }

  // Bouillon cube override
  if ((includesBouillon || includesCube) && (unitLower === 'cube' || unitLower === 'cubes' || unitHintLower === 'cube' || includesCube)) {
    return 5 * qty; // average cube ~5g
  }

  return baseGrams;
}

function gramsForServing(serving: FatSecretServing): number | null {
  if (serving.servingWeightGrams && serving.servingWeightGrams > 0) return serving.servingWeightGrams;
  if (serving.metricServingUnit?.toLowerCase() === 'g' && serving.metricServingAmount) {
    return serving.metricServingAmount;
  }
  if (serving.metricServingUnit?.toLowerCase() === 'ml' && serving.metricServingAmount) {
    return serving.metricServingAmount;
  }
  return null;
}

function computeMacros(
  serving: FatSecretServing,
  qty: number,
  unitsPerServing: number,
  gramsOverride?: number | null
) {
  const divisor = unitsPerServing > 0 ? unitsPerServing : 1;
  const factorFromUnits = qty / divisor;
  const gramsForServingWeight = gramsForServing(serving);

  // If we have a grams override and a base grams reference, scale macros by grams ratio
  if (gramsOverride && gramsForServingWeight) {
    const factor = gramsOverride / gramsForServingWeight;
    if (
      serving.calories == null ||
      serving.protein == null ||
      serving.carbohydrate == null ||
      serving.fat == null
    ) {
      return null;
    }
    return {
      kcal: serving.calories * factor,
      protein: serving.protein * factor,
      carbs: serving.carbohydrate * factor,
      fat: serving.fat * factor,
    };
  }

  if (
    serving.calories == null ||
    serving.protein == null ||
    serving.carbohydrate == null ||
    serving.fat == null
  ) {
    return null;
  }
  return {
    kcal: serving.calories * factorFromUnits,
    protein: serving.protein * factorFromUnits,
    carbs: serving.carbohydrate * factorFromUnits,
    fat: serving.fat * factorFromUnits,
  };
}

function tokenSet(value: string): Set<string> {
  return new Set(value.split(/[^a-z0-9]+/).filter(Boolean));
}

// Common words that appear in many food names - these get lower weight
// Distinctive words (meat types, specific ingredients) get higher weight
const COMMON_FOOD_WORDS = new Set([
  'sausage', 'oil', 'flour', 'powder', 'sauce', 'cheese', 'milk', 'cream',
  'butter', 'bread', 'rice', 'pasta', 'noodle', 'soup', 'broth', 'stock',
  'canned', 'fresh', 'raw', 'cooked', 'diced', 'chopped', 'sliced', 'whole',
  'large', 'medium', 'small', 'organic', 'natural', 'unsweetened', 'sweetened',
]);

const TRIVIAL_SINGLE_TOKEN = new Set([
  'water',
  'salt',
  'sugar',
  'milk',
  'flour',
  'oil',
  'pepper',
  'rice',
  'yeast',
  'honey',
  'vinegar',
  'onion',
  'jalapeno',
  'sauerkraut',
  'tomatoes',
  'mustard',
  'apple',
  'apples',
  'ginger',
]);

const CLEAR_GENERIC_PHRASES = new Set([
  'vegetable oil',
  'olive oil',
  'canola oil',
  'coconut oil',
  'brown sugar',
  'white sugar',
  'baking soda',
  'baking powder',
  'garlic powder',
  'onion powder',
  'yellow mustard',
  'hot pepper sauce',
  'thai red curry paste',
  'low sodium soy sauce',
  'soy sauce low sodium',
  'cherry tomatoes',
]);

function getTokenWeight(token: string): number {
  // Common words get lower weight (0.5), distinctive words get full weight (1.0)
  if (COMMON_FOOD_WORDS.has(token.toLowerCase())) {
    return 0.5;
  }
  // Very short tokens (1-2 chars) get lower weight
  if (token.length <= 2) {
    return 0.7;
  }
  return 1.0;
}

function weightedJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;

  let weightedIntersection = 0;
  let weightedUnion = 0;

  // Calculate weighted intersection
  for (const token of a) {
    const weight = getTokenWeight(token);
    if (b.has(token)) {
      weightedIntersection += weight;
    }
    weightedUnion += weight;
  }

  // Add tokens from b that aren't in a
  for (const token of b) {
    if (!a.has(token)) {
      weightedUnion += getTokenWeight(token);
    }
  }

  return weightedUnion > 0 ? weightedIntersection / weightedUnion : 0;
}

function deriveMustHaveTokens(normalizedName: string): string[] {
  const STOP = new Set([
    'cup', 'cups', 'tbsp', 'tbsps', 'tablespoon', 'tablespoons',
    'tsp', 'tsps', 'teaspoon', 'teaspoons',
    'oz', 'ounce', 'ounces', 'g', 'gram', 'grams', 'kg', 'ml', 'l', 'liter', 'liters',
    'packet', 'packets'
  ]);
  
  // Clean the name first to remove descriptor stopwords (like "pieces") and handle pluralization
  const cleaned = cleanIngredientName(normalizedName);
  
  return cleaned
    .toLowerCase()
    .split(/[^\w]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function detectCookPreference(query: string): 'cooked' | 'raw' | null {
  if (/cooked|baked|roasted|steamed|grilled|boiled/.test(query)) return 'cooked';
  if (/raw|uncooked|fresh|dry/.test(query)) return 'raw';
  return null;
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function getDefaultFatSecretConfidence() {
  return FATSECRET_MIN_CONFIDENCE;
}
