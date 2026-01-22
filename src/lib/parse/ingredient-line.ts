import { parseQuantityTokens } from './quantity';
import { normalizeUnitToken, convertUnit } from './unit';
import { extractQualifiers, extractQualifiersFromParentheses } from './qualifiers';
import { extractUnitHint } from './unit-hint';

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

export function parseIngredientLine(line: string): ParsedIngredient | null {
  if (!line || line.trim().length === 0) return null;

  // Handle non-ingredient noise: separators, emojis, etc.
  // Check for common separators that indicate this is not an ingredient
  const trimmed = line.trim();
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
  let normalizedLine = line
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
    .replace(/\brocket\b/gi, 'arugula')
    .replace(/\bcoriander\b/gi, 'cilantro')
    .replace(/\bspring onions?\b/gi, 'green onion')  // British "spring onion(s)" -> American
    // Synonym: "calorie free" → "sugar free" (many products labeled as sugar free, not calorie free)
    .replace(/\bcalorie[- ]free\b/gi, 'sugar free');

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
      // Check if token is like "200g" (number+unit)
      const match = token.match(/^(\d+(?:\.\d+)?)([a-z]+)$/i);
      if (match) {
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


  let i = 0;
  let qty = 1; // Default quantity

  // Check if first token is a unit (e.g., "pinch of salt")
  // If so, we'll use default qty of 1
  let startsWithUnit = false;
  if (mergedTokens.length > 0) {
    const firstToken = mergedTokens[0];
    const firstNormalized = normalizeUnitToken(firstToken);
    if (firstNormalized.kind === 'mass' || firstNormalized.kind === 'volume' || firstNormalized.kind === 'count') {
      startsWithUnit = true;
    }
  }

  // Parse quantity (if not starting with unit)
  if (!startsWithUnit) {
    const qtyResult = parseQuantityTokens(mergedTokens.slice(i));
    if (qtyResult) {
      qty = qtyResult.qty;
      i += qtyResult.consumed;
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

      // Skip "of" if present (e.g., "pinch of salt")
      if (i < mergedTokens.length && mergedTokens[i].toLowerCase() === 'of') {
        i++;
      }
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
    } else if (firstNormalized.kind === 'mass' || firstNormalized.kind === 'volume') {
      // Only process if we didn't already handle it as a starting unit
      if (!startsWithUnit || i > 0) {
        unit = firstNormalized.unit;
        rawUnit = firstToken;
        // Only consume the unit token if it's not the last token (to preserve compound names)
        if (i + 1 < mergedTokens.length) {
          i++;
        }
      }
    } else if (firstNormalized.kind === 'count') {
      // For count units like "piece", "slice", "scoop", consume them as units
      // But we'll check later if they're actually unit hints (like "leaves", "cloves")
      // First check if it's a unit hint - if so, don't consume as unit
      const lowerToken = firstToken.toLowerCase();
      const possibleHints = ['cloves', 'clove', 'leaves', 'leaf', 'yolks', 'yolk', 'whites', 'white', 'sheets', 'sheet', 'stalks', 'stalk'];
      if (possibleHints.includes(lowerToken)) {
        // Don't consume - it's a unit hint, not a unit
      } else {
        unit = firstNormalized.unit;
        rawUnit = firstToken;
        // Consume count units - we'll handle unit hints separately in name tokens
        if (i + 1 < mergedTokens.length) {
          i++;
        }
      }
    }
    // For 'unknown' tokens, don't consume them as units - they're part of the name
    // This handles cases like "5 romaine leaves" where "romaine" shouldn't be a unit
  }

  // Check for compound ingredients like "0.25 cup & 1 tbsp"
  // Must convert the second part to the first unit and add to qty
  if (unit && i < mergedTokens.length) {
    const connector = mergedTokens[i].toLowerCase();
    if (connector === '&' || connector === '+' || connector === 'and' || connector === 'plus') {
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
      const possibleHints = ['cloves', 'clove', 'leaves', 'leaf', 'yolks', 'yolk', 'whites', 'white', 'sheets', 'sheet', 'stalks', 'stalk'];
      if (!possibleHints.includes(lowerToken)) {
        unit = afterParenNormalized.unit;
        rawUnit = afterParenToken;
        i++; // Consume the unit
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
  const coreTokens = coreNamePart.split(/\s+/).filter(t => t.length > 0);
  const { qualifiers: extractedQualifiers, remainingTokens } = extractQualifiers(coreTokens);

  // Extract unit hint (e.g., "egg yolks" -> unitHint: "yolk", name: "egg")
  // This should happen after qualifier extraction
  const hintResult = extractUnitHint(remainingTokens);
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
