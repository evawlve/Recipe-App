import { parseQuantityTokens } from './quantity';
import { normalizeUnitToken } from './unit';

export type ParsedIngredient = {
  qty: number;
  multiplier: number;
  unit?: string | null;
  rawUnit?: string | null;
  name: string;
  notes?: string | null;
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

  // Tokenize the line
  const tokens = normalizedLine.split(/\s+/);
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
    } else if (firstNormalized.kind === 'mass' || firstNormalized.kind === 'volume' || firstNormalized.kind === 'count') {
      unit = firstNormalized.unit;
      rawUnit = firstToken;
      // Only consume the unit token if it's not the last token (to preserve compound names)
      if (i + 1 < tokens.length) {
        i++;
      }
    } else if (firstNormalized.kind === 'unknown') {
      rawUnit = firstToken;
      i++;
    }
  }

  // Remaining tokens are the name
  const name = tokens.slice(i).join(' ').trim();
  if (!name) return null;

  return {
    qty,
    multiplier,
    unit: unit || null,
    rawUnit: rawUnit || null,
    name,
    notes: null
  };
}
