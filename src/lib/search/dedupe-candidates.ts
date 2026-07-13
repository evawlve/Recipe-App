/**
 * Query-time dedup for near-duplicate food search candidates.
 *
 * The OFF ingest seeded millions of rows, so a generic query like "grapes"
 * can surface 15+ near-identical entries (same food, different barcodes).
 * This collapses candidates that share a normalized name + rounded macro
 * signature down to one best representative. Ranking/filtering happens
 * upstream (route.ts runLocalSearch) — this step only removes duplicates
 * and preserves the incoming order.
 */

import type { UnifiedCandidate } from '../mapping/gather-candidates';

/**
 * Normalize a food name into a grouping key: lowercase, diacritics and
 * punctuation stripped, tokens singularized and sorted so word order
 * doesn't matter ("Grapes, red" ≡ "red grapes" ≡ "Red Grape").
 */
export function normalizeNameKey(name: string): string {
    const tokens = name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 0)
        .map(singularize);

    return [...new Set(tokens)].sort().join(' ');
}

function singularize(token: string): string {
    if (token.length <= 3 || token.endsWith('ss')) return token;
    if (token.endsWith('ies')) return token.slice(0, -3) + 'y';
    if (token.endsWith('oes') || token.endsWith('shes') || token.endsWith('ches')) {
        return token.slice(0, -2);
    }
    if (token.endsWith('s')) return token.slice(0, -1);
    return token;
}

/**
 * Bucket per-100g macros so entries with trivially different label data
 * still group together: kcal to nearest 10, P/C/F to nearest gram.
 * Returns 'empty' when no macro is present at all.
 */
export function macroSignature(nutrition: UnifiedCandidate['nutrition']): string {
    const kcal = nutrition?.kcal ?? 0;
    const protein = nutrition?.protein ?? 0;
    const carbs = nutrition?.carbs ?? 0;
    const fat = nutrition?.fat ?? 0;

    if (kcal <= 0 && protein <= 0 && carbs <= 0 && fat <= 0) return 'empty';

    return [
        Math.round(kcal / 10),
        Math.round(protein),
        Math.round(carbs),
        Math.round(fat),
    ].join(':');
}

function hasRealBrand(c: UnifiedCandidate): boolean {
    const brand = (c.brandName ?? '').trim().toLowerCase();
    return brand.length > 1 && brand !== 'unknown' && brand !== 'n/a' && brand !== 'none';
}

function completenessScore(c: UnifiedCandidate): number {
    let score = 0;
    if ((c.nutrition?.kcal ?? 0) > 0) score++;
    if ((c.nutrition?.protein ?? 0) > 0) score++;
    if ((c.nutrition?.carbs ?? 0) > 0) score++;
    if ((c.nutrition?.fat ?? 0) > 0) score++;
    if ((c.servings ?? []).some(s => s.grams != null)) score++;
    return score;
}

/**
 * Preference order for which duplicate survives:
 * FDC/verified source > has a real brand > most complete data > search score.
 */
function isBetterRepresentative(a: UnifiedCandidate, b: UnifiedCandidate): boolean {
    const aFdc = a.source === 'fdc' ? 1 : 0;
    const bFdc = b.source === 'fdc' ? 1 : 0;
    if (aFdc !== bFdc) return aFdc > bFdc;

    const aBrand = hasRealBrand(a) ? 1 : 0;
    const bBrand = hasRealBrand(b) ? 1 : 0;
    if (aBrand !== bBrand) return aBrand > bBrand;

    const aComplete = completenessScore(a);
    const bComplete = completenessScore(b);
    if (aComplete !== bComplete) return aComplete > bComplete;

    return (a.score ?? 0) > (b.score ?? 0);
}

/**
 * Collapse near-duplicate candidates to one representative each.
 *
 * Two candidates are duplicates when they share a normalized name AND a
 * rounded macro signature. Additionally, a zero-macro candidate is dropped
 * when a same-named candidate with real macros exists — the empty row adds
 * nothing the populated one doesn't. Output preserves the input's order
 * (each group appears at its first occurrence).
 */
export function dedupeCandidates(candidates: UnifiedCandidate[]): UnifiedCandidate[] {
    type Group = { representative: UnifiedCandidate; order: number; nameKey: string; sig: string };
    const groups = new Map<string, Group>();
    const namesWithMacros = new Set<string>();

    candidates.forEach((c, i) => {
        const nameKey = normalizeNameKey(c.name);
        const sig = macroSignature(c.nutrition);
        if (sig !== 'empty') namesWithMacros.add(nameKey);

        const key = `${nameKey}|${sig}`;
        const existing = groups.get(key);
        if (!existing) {
            groups.set(key, { representative: c, order: i, nameKey, sig });
        } else if (isBetterRepresentative(c, existing.representative)) {
            existing.representative = c;
        }
    });

    return [...groups.values()]
        .filter(g => g.sig !== 'empty' || !namesWithMacros.has(g.nameKey))
        .sort((a, b) => a.order - b.order)
        .map(g => g.representative);
}
