import Fuse from 'fuse.js';
import { plausibilityScore, KcalBand } from './plausibility';
import { normalizeQuery } from '@/lib/search/normalize';

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

    const w = { barcode: 3.0, exact: 1.5, alias: 1.2, aliasMatch: 1.5, fuzzy: 2.0, plaus: 1.0, verified: 0.8, popularity: 0.7, personal: 1.0, token: 1.2, category: 1.0 };

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
      w.category * categoryBoost;

    // Apply category hint boost
    if (f.categoryId && boosts[f.categoryId]) {
      score *= boosts[f.categoryId];
    }

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
      score *= 0.6; // mild penalty to push plain ingredients up
    }

    // De-rank processed foods when searching for basic ingredients
    const isProcessedFood = /\b(dip|rings|sauce|paste|powder|flakes|chips|crackers|breaded|fried|frozen|prepared|canned|dried|powdered)\b/.test(f.name.toLowerCase());
    const isBasicIngredient = /\b(raw|fresh|whole|organic|natural)\b/.test(f.name.toLowerCase()) || 
                              f.name.toLowerCase().includes(', raw') ||
                              f.name.toLowerCase().includes(', fresh');
    
    if (isProcessedFood && !qHasCompositeWords) {
      score *= 0.4; // strong penalty for processed foods when searching for basic ingredients
    }
    
    if (isBasicIngredient) {
      score *= 1.3; // boost for basic ingredients
    }

    const confidence = Math.max(0, Math.min(1, score / 10.0));
    return { candidate: c, score, confidence };
  }).sort((a, b) => b.score - a.score);
}
