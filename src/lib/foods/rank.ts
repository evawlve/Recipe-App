import Fuse from 'fuse.js';
import { plausibilityScore, KcalBand } from './plausibility';

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

  return cands.map(c => {
    const q = opts.query.toLowerCase();
    const f = c.food;
    const barcodeHit = (c.barcodes ?? []).some(b => q.replace(/\D/g, '') === b);
    const exactBrand = f.brand ? +q.includes(f.brand.toLowerCase()) : 0;
    const exactAlias = (c.aliases ?? []).some(a => a.toLowerCase() === q) ? 1 : 0;
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

    const w = { barcode: 3.0, exact: 1.5, alias: 1.2, fuzzy: 2.0, plaus: 1.0, verified: 0.8, popularity: 0.7, personal: 1.0, token: 1.2 };

    const score =
      w.barcode * (barcodeHit ? 1 : 0) +
      w.exact   * exactBrand +
      w.alias   * exactAlias +
      w.fuzzy   * fuzzy +
      w.plaus   * plaus +
      w.verified* verified +
      w.popularity * popularity +
      w.personal   * personal +
      w.token   * tokenBoost;

    const confidence = Math.max(0, Math.min(1, score / 9.7));
    return { candidate: c, score, confidence };
  }).sort((a, b) => b.score - a.score);
}
