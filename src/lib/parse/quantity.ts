/**
 * Parse quantity tokens to extract numeric values and fractions
 * Handles integers, decimals, unicode fractions, word fractions, ranges, and fractions attached to numbers
 */

// Unicode fractions mapping
const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1/3, '⅔': 2/3,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875
};

/**
 * Extract a number with optional attached unicode fraction (e.g., "2½" -> 2.5)
 */
function parseNumberWithFraction(token: string): { whole: number; fraction: number } | null {
  // Check if token contains a unicode fraction
  for (const [frac, value] of Object.entries(UNICODE_FRACTIONS)) {
    if (token.includes(frac)) {
      // Extract the number part (everything before the fraction)
      const numPart = token.replace(frac, '').trim();
      const whole = numPart ? parseFloat(numPart) : 0;
      if (!isNaN(whole)) {
        return { whole, fraction: value };
      }
    }
  }
  return null;
}

/**
 * Check if a token contains a range separator and split it
 */
function splitRangeToken(token: string): { first: string; separator: string; second: string } | null {
  // Check for hyphen, en-dash, or em-dash in the token
  const rangePattern = /^(.+?)([-–—])(.+)$/;
  const match = token.match(rangePattern);
  if (match) {
    return {
      first: match[1],
      separator: match[2],
      second: match[3]
    };
  }
  return null;
}

/**
 * Parse a range (e.g., "2-3", "2–3", "2 to 3") and return the average
 * Returns null if no range separator is found
 * Handles both separate tokens ("2", "-", "3") and combined tokens ("2-3")
 */
function parseRange(tokens: string[], startIdx: number): { qty: number; consumed: number } | null {
  if (startIdx >= tokens.length) return null;

  let firstNum: number | null = null;
  let secondNum: number | null = null;
  let i = startIdx;
  let consumed = 0;

  // Check if first token contains a range separator (e.g., "2-3")
  const firstToken = tokens[i];
  const rangeSplit = splitRangeToken(firstToken);
  
  if (rangeSplit) {
    // Token contains range separator - parse both parts
    const firstWithFraction = parseNumberWithFraction(rangeSplit.first);
    if (firstWithFraction) {
      firstNum = firstWithFraction.whole + firstWithFraction.fraction;
    } else {
      const num = parseFloat(rangeSplit.first);
      if (!isNaN(num)) {
        firstNum = num;
      } else {
        return null;
      }
    }

    const secondWithFraction = parseNumberWithFraction(rangeSplit.second);
    if (secondWithFraction) {
      secondNum = secondWithFraction.whole + secondWithFraction.fraction;
    } else {
      const num = parseFloat(rangeSplit.second);
      if (!isNaN(num)) {
        secondNum = num;
      } else {
        return null;
      }
    }

    // Return average of range
    if (firstNum !== null && secondNum !== null) {
      return { qty: (firstNum + secondNum) / 2, consumed: 1 };
    }
    return null;
  }

  // Try to parse first number (may have fraction attached)
  const firstWithFraction = parseNumberWithFraction(firstToken);
  
  if (firstWithFraction) {
    firstNum = firstWithFraction.whole + firstWithFraction.fraction;
    consumed = 1;
    i++;
  } else {
    const num = parseFloat(firstToken);
    if (!isNaN(num)) {
      firstNum = num;
      consumed = 1;
      i++;
    } else {
      return null;
    }
  }

  // Must have a range separator to be a range
  if (i >= tokens.length) return null;

  const separator = tokens[i];
  const isRangeSeparator = 
    separator === '-' || 
    separator === '–' || // en-dash
    separator === '—' || // em-dash
    separator === 'to' ||
    separator === 'To';

  if (!isRangeSeparator) {
    // Not a range
    return null;
  }

  consumed++; // consume separator
  i++;

  // Parse second number (may have fraction attached)
  if (i >= tokens.length) {
    // Range separator but no second number - not a valid range
    return null;
  }

  const secondToken = tokens[i];
  const secondWithFraction = parseNumberWithFraction(secondToken);
  
  if (secondWithFraction) {
    secondNum = secondWithFraction.whole + secondWithFraction.fraction;
    consumed++;
  } else {
    const num = parseFloat(secondToken);
    if (!isNaN(num)) {
      secondNum = num;
      consumed++;
    } else {
      // Second number invalid - not a valid range
      return null;
    }
  }

  // Return average of range
  if (firstNum !== null && secondNum !== null) {
    return { qty: (firstNum + secondNum) / 2, consumed };
  }

  return null;
}

export function parseQuantityTokens(tokens: string[]): { qty: number; consumed: number } | null {
  if (tokens.length === 0) return null;

  let qty = 0;
  let consumed = 0;
  let i = 0;

  // First, try to parse as a range (handles "2-3", "1½-2", etc.)
  const rangeResult = parseRange(tokens, i);
  if (rangeResult) {
    return rangeResult;
  }

  // Handle unicode fractions as standalone tokens
  if (UNICODE_FRACTIONS[tokens[0]]) {
    return { qty: UNICODE_FRACTIONS[tokens[0]], consumed: 1 };
  }

  // Handle word fractions
  const wordFractions: Record<string, number> = {
    'half': 0.5, 'quarter': 0.25, 'third': 1/3
  };

  if (wordFractions[tokens[0]]) {
    return { qty: wordFractions[tokens[0]], consumed: 1 };
  }

  // Handle "one and a half" pattern
  if (tokens.length >= 4 && 
      tokens[0] === 'one' && 
      tokens[1] === 'and' && 
      tokens[2] === 'a' && 
      tokens[3] === 'half') {
    return { qty: 1.5, consumed: 4 };
  }

  // Handle "1 and 1/2" pattern
  if (tokens.length >= 3 && 
      tokens[0] === '1' && 
      tokens[1] === 'and' && 
      tokens[2] === '1/2') {
    return { qty: 1.5, consumed: 3 };
  }

  // Handle "1 1/2" pattern (mixed number with space)
  if (tokens.length >= 2 && 
      tokens[0] === '1' && 
      tokens[1] === '1/2') {
    return { qty: 1.5, consumed: 2 };
  }

  // Handle number with attached unicode fraction (e.g., "2½", "1¼")
  const numberWithFraction = parseNumberWithFraction(tokens[0]);
  if (numberWithFraction) {
    return { qty: numberWithFraction.whole + numberWithFraction.fraction, consumed: 1 };
  }

  // Handle "number fraction" pattern (e.g., "2 ½", "1 ¼") - space between number and fraction
  if (tokens.length >= 2) {
    const firstNum = parseFloat(tokens[0]);
    if (!isNaN(firstNum) && UNICODE_FRACTIONS[tokens[1]]) {
      return { qty: firstNum + UNICODE_FRACTIONS[tokens[1]], consumed: 2 };
    }
  }

  // Handle simple fractions like "1/2"
  if (tokens[0].includes('/')) {
    const parts = tokens[0].split('/');
    if (parts.length === 2) {
      const numerator = parseFloat(parts[0]);
      const denominator = parseFloat(parts[1]);
      if (!isNaN(numerator) && !isNaN(denominator) && denominator !== 0) {
        return { qty: numerator / denominator, consumed: 1 };
      }
    }
  }

  // Handle simple numbers (integers and decimals)
  const num = parseFloat(tokens[0]);
  if (!isNaN(num)) {
    qty = num;
    consumed = 1;
  } else {
    return null;
  }

  return { qty, consumed };
}
