/**
 * Strict token coverage between a user query and a candidate food's
 * name/brand, mirroring the engine benchmark's strict relevance judge:
 * a query token is covered only if it appears as a whole token of the
 * candidate's name or brand (after normalization + light singularization).
 * Substring matches don't count ("grape" does not cover "grapefruit").
 *
 * Tokens of 6+ characters tolerate a single edit so common typos still
 * match ("chcken" covers "chicken"), while short lookalikes that search
 * engines typo-expand do not ("ryse" never covers "rye").
 *
 * Used by the search route to decide when a candidate genuinely matches
 * the query — e.g. whether a USDA generic deserves the produce-query
 * priority slot, and how much confidence its engine score translates to.
 */

import { singularize } from './dedupe-candidates';

const FUZZY_MIN_TOKEN_LENGTH = 6;

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

/** True when a and b are equal or one single-character edit apart. */
function withinOneEdit(a: string, b: string): boolean {
    if (a === b) return true;
    const la = a.length;
    const lb = b.length;
    if (Math.abs(la - lb) > 1) return false;

    let i = 0;
    let j = 0;
    let edits = 0;
    while (i < la && j < lb) {
        if (a[i] === b[j]) {
            i++;
            j++;
            continue;
        }
        if (++edits > 1) return false;
        if (la > lb) i++;
        else if (lb > la) j++;
        else { i++; j++; }
    }
    return edits + (la - i) + (lb - j) <= 1;
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
            (qt.length >= FUZZY_MIN_TOKEN_LENGTH && withinOneEdit(qt, ct)),
        );
        if (hit) covered++;
    }
    return covered / queryToks.length;
}
