/**
 * Unit hint extraction
 * Extracts piece-like unit hints (leaf, clove, yolk, white, etc.) from ingredient names
 */

// Unit hints and their patterns
// Format: { hint: string, patterns: string[], nameExtractor: (tokens: string[]) => string }
// Optional appliesTo(lowerTokensWithContext) gates a pattern to specific
// contexts. It receives the name tokens PLUS any caller-supplied context
// tokens (e.g. the already-parsed unit: in "3 egg whites", "egg" is consumed
// as a count unit before hint extraction, so it is context, not a name token).
type UnitHintPattern = {
  hint: string;
  patterns: string[];
  appliesTo?: (lowerTokensWithContext: string[]) => boolean;
  nameExtractor: (tokens: string[]) => string;
};

const UNIT_HINT_PATTERNS: UnitHintPattern[] = [
  {
    hint: 'yolk',
    patterns: ['yolks', 'yolk'],
    nameExtractor: (tokens: string[]) => {
      // Remove "yolk"/"yolks" and "egg"/"eggs", return "egg"
      const filtered = tokens.filter(t => 
        !['yolk', 'yolks', 'egg', 'eggs'].includes(t.toLowerCase())
      );
      return filtered.length > 0 ? filtered.join(' ') : 'egg';
    }
  },
  {
    hint: 'white',
    patterns: ['whites', 'white'],
    // Only egg whites are a piece-like part. Without this gate, "white" in
    // "white rice"/"white bread"/"white wine"/"white onion" was stripped from
    // the name as a bogus unit hint (variety modifier, not a food part).
    appliesTo: (lowerTokens: string[]) =>
      lowerTokens.includes('egg') || lowerTokens.includes('eggs'),
    nameExtractor: (tokens: string[]) => {
      // Remove "white"/"whites" and "egg"/"eggs", return "egg"
      const filtered = tokens.filter(t => 
        !['white', 'whites', 'egg', 'eggs'].includes(t.toLowerCase())
      );
      return filtered.length > 0 ? filtered.join(' ') : 'egg';
    }
  },
  {
    hint: 'leaf',
    patterns: ['leaves', 'leaf'],
    nameExtractor: (tokens: string[]) => {
      // Remove "leaf"/"leaves", return remaining
      const filtered = tokens.filter(t => 
        !['leaf', 'leaves'].includes(t.toLowerCase())
      );
      // If we filtered everything out, return empty (shouldn't happen, but handle it)
      if (filtered.length === 0 && tokens.length > 0) {
        // This means the tokens were just ["leaves"] or ["leaf"]
        // Return empty - the caller should handle this
        return '';
      }
      return filtered.join(' ') || '';
    }
  },
  {
    hint: 'clove',
    patterns: ['cloves', 'clove'],
    nameExtractor: (tokens: string[]) => {
      // Remove "clove"/"cloves", return remaining
      const filtered = tokens.filter(t => 
        !['clove', 'cloves'].includes(t.toLowerCase())
      );
      return filtered.join(' ') || tokens[0] || '';
    }
  },
  {
    hint: 'sheet',
    patterns: ['sheets', 'sheet'],
    nameExtractor: (tokens: string[]) => {
      // Remove "sheet"/"sheets", return remaining
      const filtered = tokens.filter(t => 
        !['sheet', 'sheets'].includes(t.toLowerCase())
      );
      return filtered.join(' ') || tokens[0] || '';
    }
  },
  {
    hint: 'stalk',
    patterns: ['stalks', 'stalk'],
    nameExtractor: (tokens: string[]) => {
      // Remove "stalk"/"stalks", return remaining
      const filtered = tokens.filter(t => 
        !['stalk', 'stalks'].includes(t.toLowerCase())
      );
      return filtered.join(' ') || tokens[0] || '';
    }
  },
  {
    hint: 'slice',
    patterns: ['slices', 'slice'],
    nameExtractor: (tokens: string[]) => {
      // Remove "slice"/"slices", return remaining
      const filtered = tokens.filter(t => 
        !['slice', 'slices'].includes(t.toLowerCase())
      );
      return filtered.join(' ') || tokens[0] || '';
    }
  },
  {
    hint: 'piece',
    patterns: ['pieces', 'piece'],
    nameExtractor: (tokens: string[]) => {
      // Remove "piece"/"pieces", return remaining
      const filtered = tokens.filter(t => 
        !['piece', 'pieces'].includes(t.toLowerCase())
      );
      return filtered.join(' ') || tokens[0] || '';
    }
  },
  {
    hint: 'chunk',
    patterns: ['chunks', 'chunk'],
    nameExtractor: (tokens: string[]) => {
      // Remove "chunk"/"chunks", return remaining
      const filtered = tokens.filter(t => 
        !['chunk', 'chunks'].includes(t.toLowerCase())
      );
      return filtered.join(' ') || tokens[0] || '';
    }
  }
];

/**
 * Extract unit hint from tokens and return the core name
 * Returns { unitHint: string | null, coreName: string }
 *
 * contextTokens: extra tokens visible to appliesTo gates but never part of the
 * extracted name — e.g. the parsed unit ("egg" in "3 egg whites", which the
 * unit parser consumes before the name tokens reach this function).
 */
export function extractUnitHint(
  tokens: string[],
  contextTokens: string[] = []
): { unitHint: string | null; coreName: string } {
  const lowerTokens = tokens.map(t => t.toLowerCase());
  const lowerTokensWithContext = [
    ...lowerTokens,
    ...contextTokens.map(t => t.toLowerCase()),
  ];

  // Check each pattern
  for (const pattern of UNIT_HINT_PATTERNS) {
    if (pattern.appliesTo && !pattern.appliesTo(lowerTokensWithContext)) continue;
    for (const hintPattern of pattern.patterns) {
      const index = lowerTokens.indexOf(hintPattern);
      if (index !== -1) {
        // Found the hint, extract core name
        const coreName = pattern.nameExtractor(tokens);
        return { unitHint: pattern.hint, coreName };
      }
    }
  }

  // No unit hint found
  return { unitHint: null, coreName: tokens.join(' ') };
}

