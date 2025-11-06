import { parseQuantityTokens } from './quantity';
import { normalizeUnitToken } from './unit';
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
};

export function parseIngredientLine(line: string): ParsedIngredient | null {
  if (!line || line.trim().length === 0) return null;

  // Normalize unicode spaces (thin space, non-breaking space, etc.) to regular spaces
  // This handles cases like "2 ½" where there might be a thin space
  const normalizedLine = line
    .replace(/\u2009/g, ' ') // thin space
    .replace(/\u00A0/g, ' ') // non-breaking space
    .replace(/\u2000/g, ' ') // en quad
    .replace(/\u2001/g, ' ') // em quad
    .trim();

  // Tokenize the line (split on whitespace, but also separate commas)
  // This handles "1 cup, packed" -> ["1", "cup", ",", "packed"]
  const tokens = normalizedLine
    .replace(/,/g, ' , ')
    .split(/\s+/)
    .filter(t => t.length > 0);
  if (tokens.length === 0) return null;

  let i = 0;

  // Parse quantity
  const qtyResult = parseQuantityTokens(tokens.slice(i));
  if (!qtyResult) return null;

  const qty = qtyResult.qty;
  i += qtyResult.consumed;

  // Parse unit and multiplier
  let unit: string | null = null;
  let rawUnit: string | null = null;
  let multiplier = 1;

  // Check first token for multiplier or unit
  if (i < tokens.length) {
    const firstToken = tokens[i];
    const firstNormalized = normalizeUnitToken(firstToken);
    
    if (firstNormalized.kind === 'multiplier') {
      multiplier *= firstNormalized.factor;
      i++;
      
      // Look for unit in next tokens (up to 2 more tokens)
      for (let j = 0; j < 2 && i + j < tokens.length; j++) {
        const token = tokens[i + j];
        const normalized = normalizeUnitToken(token);
        if (normalized.kind === 'mass' || normalized.kind === 'volume' || normalized.kind === 'count') {
          unit = normalized.unit;
          rawUnit = token;
          // Only consume the unit token if it's not the last token (to preserve compound names)
          if (i + j + 1 < tokens.length) {
            i = i + j + 1;
          }
          break;
        }
      }
    } else if (firstNormalized.kind === 'mass' || firstNormalized.kind === 'volume') {
      unit = firstNormalized.unit;
      rawUnit = firstToken;
      // Only consume the unit token if it's not the last token (to preserve compound names)
      if (i + 1 < tokens.length) {
        i++;
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
        if (i + 1 < tokens.length) {
          i++;
        }
      }
    }
    // For 'unknown' tokens, don't consume them as units - they're part of the name
    // This handles cases like "5 romaine leaves" where "romaine" shouldn't be a unit
  }

  // Remaining tokens are the name (may contain qualifiers, unit hints, parentheses, commas)
  // Filter out standalone commas
  const nameTokens = tokens.slice(i).filter(t => t !== ',');
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
