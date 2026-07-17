/**
 * Strict token coverage between a user query and a candidate food's
 * name/brand, mirroring the engine benchmark's strict relevance judge:
 * a query token is covered only if it appears as a whole token of the
 * candidate's name or brand (after normalization + light singularization).
 * Substring matches don't count ("grape" does not cover "grapefruit").
 *
 * Tokens of 6+ characters tolerate a single edit so common typos still
 * match ("chcken" covers "chicken"), 8+ characters tolerate two
 * ("brocolli" covers "broccoli"), while short lookalikes that search
 * engines typo-expand do not ("ryse" never covers "rye").
 *
 * Used by the search route to decide when a candidate genuinely matches
 * the query — e.g. whether a USDA generic deserves the produce-query
 * priority slot, and how much confidence its engine score translates to.
 */

import { singularize } from './dedupe-candidates';

const FUZZY_MIN_TOKEN_LENGTH = 6;

/** Edit budget a token earns from its length: 0 under 6 chars, 1 at 6–7, 2 at 8+. */
export function maxEditsFor(tokenLength: number): number {
    if (tokenLength >= 8) return 2;
    if (tokenLength >= FUZZY_MIN_TOKEN_LENGTH) return 1;
    return 0;
}

export function coverageTokens(text: string): string[] {
    return text
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 1)
        .map(singularize);
}

/** True when the Levenshtein distance between a and b is <= max. */
export function editDistanceWithin(a: string, b: string, max: number): boolean {
    if (max <= 0) return a === b;
    const la = a.length;
    const lb = b.length;
    if (Math.abs(la - lb) > max) return false;

    let prev = Array.from({ length: lb + 1 }, (_, j) => j);
    for (let i = 1; i <= la; i++) {
        const curr = [i];
        let rowMin = i;
        for (let j = 1; j <= lb; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
            if (curr[j] < rowMin) rowMin = curr[j];
        }
        if (rowMin > max) return false; // whole row over budget — can only grow
        prev = curr;
    }
    return prev[lb] <= max;
}

/**
 * Fraction (0–1) of the query's tokens that appear in the candidate's
 * name or brand. 1 means every query token matched; 0 means none did
 * (or the query had no usable tokens).
 */
export function queryTokenCoverage(
    query: string,
    name: string,
    brandName?: string | null,
): number {
    const queryToks = coverageTokens(query);
    if (queryToks.length === 0) return 0;

    const candidateToks = coverageTokens(`${name} ${brandName ?? ''}`);
    let covered = 0;
    for (const qt of queryToks) {
        const hit = candidateToks.some(ct =>
            ct === qt ||
            editDistanceWithin(qt, ct, maxEditsFor(qt.length)),
        );
        if (hit) covered++;
    }
    return covered / queryToks.length;
}

/**
 * Query tokens that look like misspellings, judged against a trusted
 * vocabulary (in practice: tokens from the curated FDC candidates for the
 * same query). A token qualifies when it's fuzzy-eligible (6+ chars),
 * absent from the vocabulary, but within its edit budget of some
 * vocabulary token — "yougurt" next to "yogurt". Products whose *names*
 * contain the misspelled token verbatim are junk-named entries riding the
 * user's typo; callers use this to demote them below the real food.
 */
export function findMisspelledTokens(query: string, vocab: Set<string>): Set<string> {
    const misspelled = new Set<string>();
    for (const qt of coverageTokens(query)) {
        if (qt.length < FUZZY_MIN_TOKEN_LENGTH || vocab.has(qt)) continue;
        const budget = maxEditsFor(qt.length);
        for (const v of vocab) {
            if (editDistanceWithin(qt, v, budget)) {
                misspelled.add(qt);
                break;
            }
        }
    }
    return misspelled;
}
