import fs from 'fs';
import path from 'path';

type NormalizationRules = {
  prep_phrases: string[];
  size_phrases: string[];
  synonym_rewrites: { from: string; to: string }[];
};

const DEFAULT_RULES: NormalizationRules = {
  prep_phrases: [
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
  ],
  size_phrases: [
    '[0-9]+\\s*(inch|inches|in|cm|centimeter|centimeters)\\b',
    '1\\s*\\"',
    '1\\s*inch',
    '1\\s*cm',
  ],
  synonym_rewrites: [
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
    { from: 'hot sauce', to: 'hot pepper sauce' },
    { from: 'red curry paste', to: 'thai red curry paste' },
    { from: 'links 4/lb', to: '' },
  ],
};

let cachedRules: NormalizationRules | null = null;

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

export type NormalizationResult = {
  cleaned: string;
  nounOnly: string;
  stripped: string[];
};

export function normalizeIngredientName(raw: string): NormalizationResult {
  const rules = readRulesFile();
  const stripped: string[] = [];
  let working = raw;

  // Apply synonym rewrites first to stabilize wording
  for (const rewrite of rules.synonym_rewrites) {
    const re = new RegExp(`\\b${escapeRegex(rewrite.from)}\\b`, 'i');
    if (re.test(working)) {
      working = working.replace(re, rewrite.to);
    }
  }

  // Remove prep/size phrases
  for (const phrase of [...rules.prep_phrases, ...rules.size_phrases]) {
    const re = new RegExp(phrase, 'ig');
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
  return value.replace(/\s+/g, ' ').replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
