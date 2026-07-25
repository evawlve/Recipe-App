/**
 * Pure assertion helpers for the golden-set eval.
 *
 * Extracted from run-eval.ts so they can be unit-tested. run-eval.ts is a script
 * with a top-level `main()` call, so importing it from a test would execute a full
 * eval run — which is exactly why the abstention hole below went unnoticed for as
 * long as it did.
 */

/** The text an expectName/forbidName alternative is matched against. */
export function textOf(hit: any): string {
    return `${hit?.name ?? hit?.foodName ?? ''} ${hit?.brand ?? hit?.brandName ?? ''}`.toLowerCase();
}

/** True if any alternative (each = list of required substrings) matches the text. */
export function matchesAlt(text: string, alternatives: string[][]): boolean {
    return alternatives.some(alt => alt.every(sub => text.includes(sub.toLowerCase())));
}

/**
 * True when the item is the route's NO-PICK shape rather than a real mapping.
 *
 * The abstain branch (src/app/api/nlp/parse/route.ts:307-341) returns
 * `foodName: parsed?.name ?? rawText` — the QUERY TEXT — with no foodId, confidence 0,
 * grams 0 and all-zero nutrition. Because expectName is substring containment over
 * foodName, asking for "burrito" was satisfied by a total abstention on "chipotle
 * chicken burrito": the mapper answering "I have nothing" scored a pass. 47 of the 238
 * nlp cases assert a name with no numeric band, so 47 cases could pass on nothing.
 *
 * Deliberately conservative — BOTH a missing foodId AND zero confidence are required,
 * which is only ever true of that one branch. A real pick always carries a foodId and a
 * clamped non-zero confidence (route.ts:396-418).
 *
 * Caveat: MapIngredientPendingResult (another request holds the in-flight lock) has the
 * same wire shape. Cases run sequentially so it is rare, and reading it as "no pick" is
 * the correct assertion either way.
 */
export function isAbstention(it: any): boolean {
    if (it == null) return false;
    const noId = it.foodId === undefined || it.foodId === null;
    const noConfidence = (it.matchConfidence ?? 0) === 0;
    return noId && noConfidence;
}

/** Recorded state of a knownIssue case, so a change in HOW it fails is visible. */
export interface BaselineEntry {
    foodId?: string | null;
    foodName?: string | null;
    grams?: number | null;
    kcal100?: number | null;
    abstained?: boolean;
}

/**
 * Wide enough to ignore data noise, tight enough to catch a changed record.
 * Any move onto or off zero counts, because zero is the degenerate-nutrition shape.
 */
export function numberDrifted(was: number | null | undefined, now: number | null | undefined): boolean {
    // Collapse null and undefined to one absent value FIRST. The baseline writer stores
    // `?? null`, while a live search result simply has no `grams` key at all — so a
    // strict !== read "null -> undefined" as drift and reported two search pins as
    // changed when nothing had. An absent value is absent either way.
    const a = was ?? null;
    const b = now ?? null;
    if (a === null || b === null) return a !== b;
    if (a === 0 || b === 0) return a !== b;   // any move onto/off zero matters
    return Math.abs(b - a) / Math.abs(a) > 0.10;
}

/** Human-readable description of every way `now` differs from the baseline, or []. */
export function describeDrift(was: BaselineEntry, now: BaselineEntry): string[] {
    const changes: string[] = [];
    if ((was.foodId ?? null) !== (now.foodId ?? null)) {
        changes.push(`record ${was.foodId ?? 'none'} -> ${now.foodId ?? 'none'} ("${was.foodName}" -> "${now.foodName}")`);
    }
    if ((was.abstained ?? false) !== (now.abstained ?? false)) {
        changes.push(`abstained ${was.abstained ?? false} -> ${now.abstained ?? false}`);
    }
    if (numberDrifted(was.grams, now.grams)) changes.push(`grams ${was.grams} -> ${now.grams}`);
    if (numberDrifted(was.kcal100, now.kcal100)) changes.push(`kcal100 ${was.kcal100} -> ${now.kcal100}`);
    return changes;
}
