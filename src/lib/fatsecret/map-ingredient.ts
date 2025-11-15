import { parseIngredientLine, type ParsedIngredient } from '../parse/ingredient-line';
import { normalizeQuery } from '../search/normalize';
import { logger } from '../logger';
import { FatSecretClient, type FatSecretFoodDetails, type FatSecretFoodSummary, type FatSecretServing } from './client';
import { FATSECRET_MIN_CONFIDENCE } from './config';

export type FatsecretMappedIngredient = {
  source: 'fatsecret';
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
  rawLine: string;
};

export interface MapIngredientOptions {
  client?: FatSecretClient;
  minConfidence?: number;
}

const defaultClient = new FatSecretClient();

interface MappingCandidate {
  food: FatSecretFoodSummary;
  source: 'search';
  baseScore: number;
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
};

// Plural → singular mapping for meat cuts and common ingredients
const PLURAL_TO_SINGULAR: Record<string, string> = {
  'eggs': 'egg',
  'thighs': 'thigh',
  'breasts': 'breast',
  'onions': 'onion',
  'tomatoes': 'tomato',
  'blueberries': 'blueberry',
  'cashews': 'cashew',
  'hazelnuts': 'hazelnut',
  'pistachios': 'pistachio',
};

export function buildSearchExpressions(parsed: ParsedIngredient | null, rawLine: string): string[] {
  // Start from parsed name or raw line, strip qty/multiplier and normalize
  const baseName = parsed?.name?.trim() || rawLine.trim();
  let normalized = normalizeQuery(baseName);
  
  // Remove any residual quantity/number patterns from normalized name
  normalized = normalized.replace(/^\d+[\s\.\-\d]*\s+/, '').trim();
  
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
  
  // Final ultra-generic fallback: extract just the core noun (last significant word)
  // This helps with pantry staples like "all-purpose flour" -> "flour", "lettuce leaves" -> "lettuce"
  // Skip common qualifiers and take the last substantial word
  const skipWords = new Set(['cooked', 'raw', 'diced', 'chopped', 'sliced', 'minced', 'unsweetened', 'sweetened', 'whole']);
  const words = normalized.split(/[^\w]+/).filter(w => w.length > 2 && !skipWords.has(w)); // Filter out very short words and qualifiers
  if (words.length > 1) {
    const coreNoun = words[words.length - 1]; // Take last non-qualifier word as likely core noun
    if (coreNoun && !seen.has(coreNoun)) {
      expressions.push(coreNoun);
      seen.add(coreNoun);
    }
  } else if (words.length === 1 && !seen.has(words[0])) {
    // If only one word left after filtering, use it
    expressions.push(words[0]);
    seen.add(words[0]);
  }
  
  // Force ultra-generic queries for common pantry items ending in specific nouns
  // This handles cases like "all-purpose flour" -> "flour", "lettuce leaves" -> "lettuce"
  const pantryNouns = ['powder', 'flour', 'oil', 'lettuce', 'onion', 'garlic', 'rice', 'pasta', 'noodle'];
  for (const noun of pantryNouns) {
    if (normalized.endsWith(noun) || normalized.includes(` ${noun}`)) {
      if (!seen.has(noun)) {
        expressions.push(noun);
        seen.add(noun);
      }
    }
  }
  
  // Final "noun only" fallback: extract the last significant word/token
  // This handles cases where everything else failed (e.g., "egg", "lettuce", "cashews")
  const allWords = normalized.split(/[^\w]+/).filter(w => w.length > 2);
  if (allWords.length > 0) {
    const lastWord = allWords[allWords.length - 1];
    if (lastWord && !seen.has(lastWord)) {
      expressions.push(lastWord);
      seen.add(lastWord);
    }
  }
  
  return expressions.length > 0 ? expressions : [normalized || rawLine.trim()];
}

export async function mapIngredientWithFatsecret(
  rawLine: string,
  options: MapIngredientOptions = {}
): Promise<FatsecretMappedIngredient | null> {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;

  const parsed = parseIngredientLine(trimmed);
  const client = options.client ?? defaultClient;
  const minConfidence = options.minConfidence ?? 0;

  const candidates: MappingCandidate[] = [];
  const seenFoodIds = new Set<string>();

  // Build multiple search expressions and try each
  const searchExpressions = buildSearchExpressions(parsed, trimmed);
  
  for (const query of searchExpressions) {
    // Allow up to 15 candidates per expression, but don't stop if we have enough total
    // We'll still check seenFoodIds to avoid duplicates across expressions
    
    try {
      const foods = await client.searchFoodsV4(query, { maxResults: 15 });
      for (const food of foods) {
        // Avoid duplicates across all expressions
        if (seenFoodIds.has(food.id)) continue;
        seenFoodIds.add(food.id);
        
        candidates.push({
          food,
          source: 'search',
          baseScore: computeCandidateScore(food, query, parsed),
        });
      }
    } catch (error) {
      logger.warn('fatsecret.map.search_failed', { message: (error as Error).message, query });
      // Continue to next expression
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => b.baseScore - a.baseScore);

  for (const candidate of candidates.slice(0, 6)) {
    const hydrated = await client.getFoodDetails(candidate.food.id);
    if (!hydrated || !hydrated.servings || hydrated.servings.length === 0) continue;

    let servingSelection = selectServing(parsed, hydrated.servings);
    if (!servingSelection) continue;

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
    
    if (grams && grams > 0 && isVolumeOrSolidUnit && grams < 10) {
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

    if (!grams || grams <= 0) continue;

    const macros = computeMacros(servingSelection.serving, qty, servingSelection.unitsPerServing);
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
    
    const confidence = clamp(
      0.25 +
        Math.min(1, Math.max(0, candidate.baseScore)) * 0.45 +
        servingSelection.matchScore * 0.25 +
        (hydrated.country?.toUpperCase() === 'US' ? 0.05 : 0) +
        (unitHintLower && hydrated.name.toLowerCase().includes(unitHintLower) ? 0.05 : 0) +
        unitMatchBonus +
        unitHintMatchBonus +
        confidenceBoostWhenExactFoodMatch,
      0,
      1
    );

    if (confidence < minConfidence) {
      continue;
    }

    return {
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
      rawLine: rawLine.trim(),
    };
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
              
              return {
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
                rawLine: rawLine.trim(),
              };
            }
          }
        }
      }
    }
  }

  return null;
}


function computeCandidateScore(food: FatSecretFoodSummary, query: string, parsed: ParsedIngredient | null): number {
  const normalizedQuery = normalizeQuery(query);
  const foodName = `${food.brandName ?? ''} ${food.name}`.trim().toLowerCase();
  const queryTokens = tokenSet(normalizedQuery);
  const foodTokens = tokenSet(foodName);
  const similarity = jaccard(queryTokens, foodTokens);

  let score = similarity;
  
  // Check if query mentions a brand
  const rawLineLower = parsed ? '' : query.toLowerCase();
  const queryText = parsed ? (normalizedQuery + ' ' + (parsed.qualifiers?.join(' ') || '')).toLowerCase() : rawLineLower;
  const queryHasBrand = /brand|fage|blue.?diamond|almond.?breeze|silk|califia/i.test(queryText);
  
  // Boost generic foods if query doesn't mention a brand
  if ((food.foodType ?? 'Generic').toLowerCase() === 'generic' && !queryHasBrand) {
    score += 0.1;
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

  // Cooked/raw preference matching
  const cookPreference = detectCookPreference(queryText);
  if (cookPreference) {
    const foodNameLower = foodName.toLowerCase();
    const matches = cookPreference === 'cooked'
      ? /cooked|baked|roasted|grilled|boiled|steamed|boiled/.test(foodNameLower)
      : /raw|uncooked|fresh|dry/.test(foodNameLower);
    const conflicts = cookPreference === 'cooked'
      ? /raw|uncooked/.test(foodNameLower)
      : /cooked|baked|roasted|grilled|boiled|steamed/.test(foodNameLower);
    if (matches) score += 0.15;
    if (conflicts) score -= 0.15;
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
    const qualifierLower = parsed.qualifiers.map(q => q.toLowerCase());
    const foodNameLower = foodName.toLowerCase();
    
    // Important qualifiers that should boost score when matched
    const importantQualifiers = ['diced', 'chopped', 'sliced', 'minced', 'grated', 'unsweetened', 'sweetened', 'whole'];
    
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
    const commonQualifiers = ['diced', 'chopped', 'sliced', 'minced', 'grated', 'unsweetened', 'sweetened', 'whole', 'skim', 'low-fat', 'reduced-fat', 'baked', 'roasted'];
    const foodQualifiers = commonQualifiers.filter(q => foodNameLower.includes(q));
    const queryQualifiers = commonQualifiers.filter(q => qualifierLower.includes(q));
    const extraQualifiers = foodQualifiers.filter(q => !queryQualifiers.includes(q));
    if (extraQualifiers.length > 0 && qualifierMatches === 0) {
      score -= 0.05; // Small penalty for flavor variants we didn't ask for
    }
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

function computeMacros(serving: FatSecretServing, qty: number, unitsPerServing: number) {
  const divisor = unitsPerServing > 0 ? unitsPerServing : 1;
  const factor = qty / divisor;
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

function tokenSet(value: string): Set<string> {
  return new Set(value.split(/[^a-z0-9]+/).filter(Boolean));
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function getDefaultFatSecretConfidence() {
  return FATSECRET_MIN_CONFIDENCE;
}
