import Fuse from 'fuse.js';
import { plausibilityScore, KcalBand } from './plausibility';
import { normalizeQuery } from '@/lib/search/normalize';

// Sprint 4: Enhanced ranking with unit hints and qualifiers

// tokens in the query → nudge these categories
const HINTS: Record<string, string[]> = {
  powder: ['whey','flour'],
  whey: ['whey'],
  oil: ['oil'],
  yogurt: ['dairy'],
  yoghurt: ['dairy'],
  cheese: ['cheese'],
  mozzarella: ['cheese'],
  cheddar: ['cheese'],
  parmesan: ['cheese'],
  milk: ['dairy'],
};

function categoryBoostForQuery(q: string): Record<string, number> {
  const boosts: Record<string, number> = {};
  for (const t of normalizeQuery(q).split(' ')) {
    for (const c of (HINTS[t] || [])) boosts[c] = Math.max(boosts[c] ?? 0, 1.2);
  }
  return boosts;
}

function isCompositeName(name: string) {
  const s = name.toLowerCase();
  return s.includes(',') || s.includes(' with ') || s.includes(' and ');
}

export type Verification = 'verified' | 'unverified' | 'suspect';

export type CandidateFood = {
  id: string;
  name: string;
  brand?: string | null;
  source: string;
  verification: Verification;
  kcal100: number;
  protein100: number;
  carbs100: number;
  fat100: number;
  densityGml?: number | null;
  categoryId?: string | null;
  popularity: number;
};

export type Candidate = {
  food: CandidateFood;
  aliases?: string[];
  barcodes?: string[];
  usedByUserCount?: number; // personalize later
};

export type RankOpts = {
  query: string;
  kcalBand?: KcalBand;
  unitHint?: string | null;      // NEW: from parser (e.g., "yolk", "white", "leaf", "clove")
  qualifiers?: string[];          // NEW: from parser (e.g., ["large"], ["diced", "fresh"])
};

export function rankCandidates(cands: Candidate[], opts: RankOpts) {
  const fuse = new Fuse(
    cands.map(c => ({
      key: c.food.id,
      text: `${c.food.brand ?? ''} ${c.food.name} ${(c.aliases ?? []).join(' ')}`.trim(),
      c,
    })),
    { includeScore: true, threshold: 0.4, keys: ['text'] }
  );
  const fResults = fuse.search(opts.query);
  const fuzzyScore: Record<string, number> = {};
  for (const r of fResults) fuzzyScore[r.item.c.food.id] = 1 - (r.score ?? 1);

  const qn = normalizeQuery(opts.query);
  const boosts = categoryBoostForQuery(qn);
  const qHasCompositeWords = /,| with | and | salad| sandwich| pizza/.test(qn);

  return cands.map(c => {
    const q = opts.query.toLowerCase();
    const f = c.food;
    const barcodeHit = (c.barcodes ?? []).some(b => q.replace(/\D/g, '') === b);
    const exactBrand = f.brand ? +q.includes(f.brand.toLowerCase()) : 0;
    const exactAlias = (c.aliases ?? []).some(a => a.toLowerCase() === q) ? 1 : 0;
    const aliasMatch = (c.aliases ?? []).some(a => a.toLowerCase().includes(q) || q.includes(a.toLowerCase())) ? 0.8 : 0;
    const fuzzy = fuzzyScore[f.id] ?? 0;
    const plaus = plausibilityScore(f.kcal100, opts.kcalBand);

    const verified = f.verification === 'verified' ? 1 : f.verification === 'suspect' ? 0.2 : 0.6;
    const popularity = Math.tanh((f.popularity || 0) / 50);
    const personal = Math.tanh((c.usedByUserCount || 0) / 10);

    // Token boost for exact token matches
    const tokens = q.split(/\s+/).filter(Boolean);
    const nameTokens = `${(f.brand ?? '')} ${f.name}`.toLowerCase();
    const tokenHits = tokens.filter(t => nameTokens.includes(t)).length;
    const tokenBoost = Math.min(1, tokenHits / Math.max(1, tokens.length)); // 0..1

    // Unit hint boost (e.g., "egg yolks" → boost foods with "yolk" in name)
    let unitHintBoost = 0;
    if (opts.unitHint) {
      const hint = opts.unitHint.toLowerCase();
      const foodNameLower = f.name.toLowerCase();
      
      // Exact match in food name (e.g., "Egg, yolk, raw")
      if (foodNameLower.includes(hint)) {
        unitHintBoost = 1.5; // Strong boost
      }
      
      // Partial match with pluralization (e.g., "yolk" → "yolks")
      const hintPattern = new RegExp(`\\b${hint}s?\\b`, 'i');
      if (hintPattern.test(foodNameLower)) {
        unitHintBoost = Math.max(unitHintBoost, 1.2); // Medium boost if not already boosted
      }
      
      // Special cases for eggs
      if (hint === 'yolk' && foodNameLower.includes('yolk')) {
        unitHintBoost = 2.0; // Prioritize yolk over whole
      } else if (hint === 'white' && foodNameLower.includes('white')) {
        unitHintBoost = 2.0; // Prioritize white over whole
      }
      
      // Lettuce leaf example: prefer raw lettuce for "leaves"
      if (hint === 'leaf' && foodNameLower.includes('raw')) {
        unitHintBoost = Math.max(unitHintBoost, 1.3); // Prefer raw lettuce
      }
      
      // Garlic clove example: prefer raw garlic
      if (hint === 'clove' && foodNameLower.includes('raw') && foodNameLower.includes('garlic')) {
        unitHintBoost = Math.max(unitHintBoost, 1.3);
      }
    }
    
    // No unit hint: de-rank parts (yolk/white) when query doesn't specify
    // This penalty will be applied after score is calculated
    let partsPenalty = 1.0;
    if (!opts.unitHint) {
      const foodNameLower = f.name.toLowerCase();
      if ((foodNameLower.includes('yolk') || foodNameLower.includes('white')) && 
          !q.includes('yolk') && !q.includes('white')) {
        partsPenalty = 0.4; // Penalty for parts when not requested
      }
    }

    // Qualifier boost (e.g., "large eggs" → boost "Egg, Large, Raw")
    let qualifierBoost = 0;
    if (opts.qualifiers && opts.qualifiers.length > 0) {
      const foodNameLower = f.name.toLowerCase();
      const matchedQualifiers = opts.qualifiers.filter(q => 
        foodNameLower.includes(q.toLowerCase())
      );
      
      // Boost proportional to matched qualifiers
      qualifierBoost = matchedQualifiers.length * 0.3; // 0.3 per match
      
      // Special handling for size qualifiers
      const sizeQualifiers = ['large', 'medium', 'small', 'jumbo', 'extra large', 'xl', 'l', 'm', 's'];
      const hasSizeQualifier = opts.qualifiers.some(q => 
        sizeQualifiers.includes(q.toLowerCase())
      );
      
      if (hasSizeQualifier) {
        const foodHasSize = sizeQualifiers.some(s => foodNameLower.includes(s));
        if (foodHasSize) {
          qualifierBoost += 0.5; // Extra boost for size match
        }
      }
      
      // Preparation qualifiers (diced, chopped, sliced) - prefer raw foods
      const prepQualifiers = ['diced', 'chopped', 'sliced', 'minced', 'grated'];
      const hasPrepQualifier = opts.qualifiers.some(q => 
        prepQualifiers.includes(q.toLowerCase())
      );
      
      if (hasPrepQualifier && foodNameLower.includes('raw')) {
        qualifierBoost += 0.2; // Small boost for raw + prep qualifier
      }
    }

    // Category boost for query terms
    const categoryBoost = (() => {
      const queryLower = q.toLowerCase();
      const foodCategory = f.categoryId?.toLowerCase() || '';
      
      // Oil-related queries prefer oil category
      if ((queryLower.includes('oil') || queryLower.includes('fat')) && foodCategory === 'oil') {
        return 0.3;
      }
      
      // Flour-related queries prefer flour category
      if ((queryLower.includes('flour') || queryLower.includes('flour')) && foodCategory === 'flour') {
        return 0.3;
      }
      
      // Protein-related queries prefer meat/protein categories
      if ((queryLower.includes('chicken') || queryLower.includes('beef') || queryLower.includes('protein')) && 
          (foodCategory === 'meat' || foodCategory === 'whey')) {
        return 0.3;
      }
      
      return 0;
    })();

    const w = { 
      barcode: 3.0, 
      exact: 1.5, 
      alias: 1.2, 
      aliasMatch: 1.5, 
      fuzzy: 2.0, 
      plaus: 1.0, 
      verified: 0.8, 
      popularity: 0.7, 
      personal: 1.0, 
      token: 1.2, 
      category: 1.0,
      unitHint: 2.5,      // NEW: High weight for unit hints
      qualifier: 1.0       // NEW: Moderate weight for qualifiers
    };

    let score =
      w.barcode * (barcodeHit ? 1 : 0) +
      w.exact   * exactBrand +
      w.alias   * exactAlias +
      w.aliasMatch * aliasMatch +
      w.fuzzy   * fuzzy +
      w.plaus   * plaus +
      w.verified* verified +
      w.popularity * popularity +
      w.personal   * personal +
      w.token   * tokenBoost +
      w.category * categoryBoost +
      w.unitHint * unitHintBoost +    // NEW
      w.qualifier * qualifierBoost;   // NEW

    // Apply category hint boost
    if (f.categoryId && boosts[f.categoryId]) {
      score *= boosts[f.categoryId];
    }
    
    // Apply parts penalty (for egg parts when no unitHint)
    score *= partsPenalty;

    // exact normalized alias hit → jump to top
    const normAliases = (c.aliases || []).map(a => normalizeQuery(a));
    if (normAliases.includes(qn)) score *= 2.0; // hard promote exact alias

    // modifier+head coverage → medium bump
    const hasNonfat = /\bnonfat\b/.test(qn) || /\bpart skim\b/.test(qn) || /\b2%|\b1%/.test(qn);
    const headCheese = /\bmozzarella\b|\bcheddar\b|\bcheese\b/.test(qn);
    const headMilk   = /\bmilk\b/.test(qn);
    if (hasNonfat && (headCheese || headMilk)) score *= 1.2;

    // De-rank composite dishes unless query asks for them
    if (!qHasCompositeWords && (f.categoryId === 'prepared_dish' || isCompositeName(f.name))) {
      score *= 0.5; // stronger penalty to push plain ingredients up
    }

    // De-rank processed/prepared foods when searching for basic ingredients
    const isProcessedFood = /\b(dip|rings|sauce|paste|powder|flakes|chips|crackers|breaded|fried|frozen|prepared|canned|dried|powdered|pasteurized|cooked|braised|roasted|baked|boiled|grilled)\b/.test(f.name.toLowerCase());
    const isBasicIngredient = /\b(raw|fresh|whole|organic|natural)\b/.test(f.name.toLowerCase()) || 
                              f.name.toLowerCase().includes(', raw') ||
                              f.name.toLowerCase().includes(', fresh');
    
    // Strong penalty for processed foods (especially for eggs/chicken/etc where raw is preferred)
    if (isProcessedFood && !qHasCompositeWords) {
      score *= 0.3; // even stronger penalty for cooked/prepared foods
    }
    
    // Boost basic/raw ingredients significantly
    if (isBasicIngredient) {
      score *= 1.5; // stronger boost for basic ingredients
    }
    
    // Extra boost for eggs/meat/fish if query contains these and food is raw
    if (/\b(egg|chicken|beef|pork|fish|salmon|tuna|turkey)\b/.test(q) && isBasicIngredient) {
      score *= 1.2; // extra boost for raw versions of these ingredients
    }

    const confidence = Math.max(0, Math.min(1, score / 10.0));
    return { candidate: c, score, confidence };
  }).sort((a, b) => b.score - a.score);
}
