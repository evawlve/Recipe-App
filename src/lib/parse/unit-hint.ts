/**
 * Unit hint extraction
 * Extracts piece-like unit hints (leaf, clove, yolk, white, etc.) from ingredient names
 */

// Unit hints and their patterns
// Format: { hint: string, patterns: string[], nameExtractor: (tokens: string[]) => string }
const UNIT_HINT_PATTERNS = [
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
  }
];

/**
 * Extract unit hint from tokens and return the core name
 * Returns { unitHint: string | null, coreName: string }
 */
export function extractUnitHint(tokens: string[]): { unitHint: string | null; coreName: string } {
  const lowerTokens = tokens.map(t => t.toLowerCase());
  
  // Check each pattern
  for (const pattern of UNIT_HINT_PATTERNS) {
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

