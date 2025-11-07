/**
 * Qualifier detection and extraction
 * Handles common qualifiers like: large, raw, diced, boneless, skinless, etc.
 */

// Common qualifiers that appear in ingredient names
const QUALIFIERS = new Set([
  'large', 'small', 'medium',
  'raw', 'cooked', 'diced', 'chopped', 'minced', 'sliced', 'grated', 'shredded',
  'boneless', 'skinless', 'bone-in', 'skin-on',
  'finely', 'coarsely', 'roughly',
  'packed', 'loose', 'heaping', 'level',
  'fresh', 'frozen', 'dried', 'canned',
  'whole', 'halved', 'quartered',
  'peeled', 'unpeeled',
  'seeded', 'unseeded',
  'stemmed', 'destemmed'
]);

// Multi-word qualifiers (must be checked in order)
const MULTI_WORD_QUALIFIERS = [
  'finely chopped',
  'finely minced',
  'coarsely chopped',
  'roughly chopped',
  'bone-in',
  'skin-on'
];

/**
 * Check if a token is a qualifier
 */
export function isQualifier(token: string): boolean {
  const normalized = token.toLowerCase().trim();
  return QUALIFIERS.has(normalized);
}

/**
 * Extract qualifiers from tokens
 * Returns array of qualifier strings and the remaining tokens
 */
export function extractQualifiers(tokens: string[]): { qualifiers: string[]; remainingTokens: string[] } {
  const qualifiers: string[] = [];
  const remaining: string[] = [];
  let i = 0;

  while (i < tokens.length) {
    // Check for multi-word qualifiers first
    let foundMultiWord = false;
    for (const multiWord of MULTI_WORD_QUALIFIERS) {
      const words = multiWord.split(' ');
      if (i + words.length <= tokens.length) {
        const candidate = tokens.slice(i, i + words.length).join(' ').toLowerCase();
        if (candidate === multiWord) {
          qualifiers.push(multiWord);
          i += words.length;
          foundMultiWord = true;
          break;
        }
      }
    }

    if (foundMultiWord) continue;

    // Check single-word qualifier
    if (isQualifier(tokens[i])) {
      qualifiers.push(tokens[i].toLowerCase());
      i++;
    } else {
      remaining.push(tokens[i]);
      i++;
    }
  }

  return { qualifiers, remainingTokens: remaining };
}

/**
 * Extract qualifiers from parentheses (e.g., "onion (diced)" -> ["diced"])
 */
export function extractQualifiersFromParentheses(text: string): string[] {
  const qualifiers: string[] = [];
  // Match content in parentheses: (diced), (finely chopped), etc.
  const parenPattern = /\(([^)]+)\)/g;
  let match;
  
  while ((match = parenPattern.exec(text)) !== null) {
    const content = match[1].trim();
    // Split by comma if multiple qualifiers in parentheses
    const parts = content.split(',').map(p => p.trim()).filter(p => p.length > 0);
    qualifiers.push(...parts);
  }

  return qualifiers;
}

