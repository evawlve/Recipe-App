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

// ---------------------------------------------------------------------------
// Case scoring — the VERDICT, not just the predicates it is built from
// ---------------------------------------------------------------------------

/**
 * The assertion block of one golden-set case. Every field is optional; a case
 * asserts whichever of them it declares.
 */
export interface NlpCaseSpec {
    expectItems?: number;
    expectName?: string[][];
    forbidName?: string[][];
    expectAbstain?: boolean;
    maxConfidence?: number;
    macros?: Record<string, [number, number]>;
    grams?: [number, number];
    total?: Record<string, [number, number]>;
    item?: { unit?: string };
}

/**
 * Every way `items` fails `c`. Empty array == PASS.
 *
 * EXTRACTED FROM run-eval.ts DELIBERATELY. The predicates below (isAbstention,
 * matchesAlt) were already unit-tested while the code that COMPOSES them into a
 * pass/fail verdict was not, because run-eval.ts calls main() at module scope and
 * importing it starts a real eval run. A tested predicate wired into an untested
 * verdict is how a total abstention scored PASS on 37 name-only cases: the guard
 * that stops it is one `!isAbstention(it) &&`, and nothing asserted it was there.
 *
 * FAIL-CLOSED CONTRACT: no input may produce an empty (== passing) result by
 * ACCIDENT. A non-array, an empty array and an all-abstention response are each an
 * ABSENCE of signal, and absence is never a pass.
 */
export function scoreNlpCase(c: NlpCaseSpec, items: unknown): string[] {
    // Absence of a response is a failure, never a vacuous pass. run-eval reports the
    // HTTP status separately; this guard makes the pure scorer independently safe.
    if (!Array.isArray(items) || items.length === 0) {
        return [`no items returned (${Array.isArray(items) ? 'empty array' : typeof items})`];
    }

    const failures: string[] = [];

    if (c.expectItems && items.length < c.expectItems) {
        failures.push(`expected >=${c.expectItems} items, got ${items.length}`);
    }

    // Name check: for single-item cases the one item must match; for segmentation
    // cases at least one item must match.
    //
    // An abstention can NEVER satisfy a positive name assertion — it echoes the
    // query text back as foodName, so it would otherwise match trivially. See
    // isAbstention().
    if (c.expectName) {
        const anyNameMatch = items.some(it => !isAbstention(it) && matchesAlt(textOf(it), c.expectName!));
        if (!anyNameMatch) {
            const shown = items.map(it => isAbstention(it) ? 'NO PICK (abstained)' : `"${it.foodName}"`);
            failures.push(`name mismatch: [${shown.join(', ')}]`);
        }
    }

    // Negative name assertion — no returned item may match. This pins a
    // wrong-record class without needing to know the right answer, which is what
    // the composite->component drift cases need: "qdoba chicken burrito must not
    // resolve to Tequila Lime Chicken" is assertable even while the correct
    // billing figure is still being argued about.
    if (c.forbidName) {
        const offender = items.find(it => !isAbstention(it) && matchesAlt(textOf(it), c.forbidName!));
        if (offender) {
            failures.push(`forbidden name matched: "${offender.foodName}" [${offender.brandName ?? ''}]`);
        }
    }

    // The mapper is REQUIRED to produce no confident pick. For a query whose
    // honest answer is "not in the corpus", billing a component at 0.95 is worse
    // than abstaining, and only this can express that.
    if (c.expectAbstain) {
        const confident = items.find(it => !isAbstention(it));
        if (confident) {
            failures.push(`expected abstention, got "${confident.foodName}" conf=${confident.matchConfidence} grams=${confident.grams}`);
        }
    }

    // Weak form: it may guess, but must not look authoritative enough to cache.
    if (typeof c.maxConfidence === 'number') {
        const conf = items[0]?.matchConfidence;
        if (typeof conf !== 'number' || conf > c.maxConfidence) {
            failures.push(`confidence=${conf} exceeds maxConfidence ${c.maxConfidence} (mapped: "${items[0]?.foodName}")`);
        }
    }

    if (c.macros) {
        const per100 = items[0]?.nutritionPer100g ?? {};
        for (const [key, range] of Object.entries(c.macros)) {
            const v = per100[key];
            if (typeof v !== 'number' || v < range[0] || v > range[1]) {
                failures.push(`${key}=${typeof v === 'number' ? v.toFixed(1) : v} outside [${range[0]}, ${range[1]}] (mapped: "${items[0]?.foodName}")`);
            }
        }
    }

    // Resolved serving weight: asserts the total grams for the requested unit/quantity.
    // This is what catches serving-estimation defects (e.g. "1 slice bread" → 100g).
    if (c.grams) {
        const g = items[0]?.grams;
        if (typeof g !== 'number' || g < c.grams[0] || g > c.grams[1]) {
            failures.push(`grams=${typeof g === 'number' ? g : String(g)} outside [${c.grams[0]}, ${c.grams[1]}] (unit "${c.item?.unit ?? ''}", mapped "${items[0]?.foodName}")`);
        }
    }

    // Billed totals for the requested quantity — the grams-scaled `nutrition`
    // block the app actually logs. This is the end-to-end assertion a per-100g
    // band can't provide: a wrong record, wrong serving, or wrong scaling all
    // surface as a wrong billed total ("1 tbsp olive oil" must bill ~119 kcal,
    // whether the failure was density, record choice, or grams math).
    // Keys: calories | protein | carbs | fat (also fiber/sugar/sodium).
    if (c.total) {
        const tot = items[0]?.nutrition ?? {};
        for (const [key, range] of Object.entries(c.total)) {
            const v = tot[key];
            if (typeof v !== 'number' || v < range[0] || v > range[1]) {
                failures.push(`total.${key}=${typeof v === 'number' ? v.toFixed(1) : v} outside [${range[0]}, ${range[1]}] (grams=${items[0]?.grams}, mapped: "${items[0]?.foodName}")`);
            }
        }
    }

    return failures;
}

/** The assertion block of one golden-set SEARCH case. */
export interface SearchCaseSpec {
    match: string[][];
    rank?: number;
    requireNutrition?: boolean;
}

const MACRO_KEYS = ['kcal100', 'protein100', 'carbs100', 'fat100'];
function hasNum(v: unknown): boolean {
    return typeof v === 'number' && Number.isFinite(v);
}
/** A search hit with NO finite macro at all — the null-nutrition rows the OFF filter should drop. */
export function nutritionMissing(h: any): boolean {
    return !MACRO_KEYS.some(k => hasNum(h?.[k]));
}

/**
 * Score one search case against the hit list the API returned.
 *
 * Same fail-closed contract as scoreNlpCase: an EMPTY hit list is what a 500, a
 * `{error: ...}` body or a dead Typesense all look like on the wire, and
 * `[].some(...)` is `false`, so it must stay a FAIL. Pinned by test rather than by
 * hope — this is one boolean flip away from "no hits, nothing to disagree with, pass".
 */
export function scoreSearchCase(c: SearchCaseSpec, hits: unknown): { pass: boolean; detail: string } {
    const list: any[] = Array.isArray(hits) ? hits : [];
    const topN = list.slice(0, c.rank ?? 3);
    const hit = list.find(h => matchesAlt(textOf(h), c.match));
    let pass = topN.some(h => matchesAlt(textOf(h), c.match));
    let detail = pass
        ? `hit: "${hit?.name}"`
        : `top${c.rank ?? 3}: [${topN.map(h => `"${h.name}"`).join(', ') || 'EMPTY'}]`;
    // Invariant (unless opted out): no returned hit may lack all nutrition — verifies
    // the OFF null-nutrition filter keeps junk rows out of manual search results.
    if (c.requireNutrition !== false && topN.length) {
        const bad = topN.find(nutritionMissing);
        if (bad) { pass = false; detail = `NULL-NUTRITION "${bad.name}" | ${detail}`; }
    }
    return { pass, detail };
}

// ---------------------------------------------------------------------------
// knownIssue drift
// ---------------------------------------------------------------------------

/** Recorded state of a knownIssue case, so a change in HOW it fails is visible. */
export interface BaselineEntry {
    foodId?: string | null;
    foodName?: string | null;
    grams?: number | null;
    kcal100?: number | null;
    abstained?: boolean;
    /**
     * The case did not produce a reading at all — transport error, non-array body,
     * zero items. Recorded because `knownIssue` otherwise swallows it completely:
     * the failure is expected (not gating) AND there are no values to diff, so a
     * pinned case that stops answering entirely would leave no trace anywhere.
     */
    errored?: boolean;
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
    if ((was.errored ?? false) !== (now.errored ?? false)) {
        changes.push(`errored ${was.errored ?? false} -> ${now.errored ?? false}`);
    }
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

/**
 * The eval's process exit code — 0 = every case passed, 1 = real failures,
 * 2 = the run is not a result.
 *
 * RUNNING ZERO CASES IS NOT A GREEN RUN. `--grep` matching nothing, `--only` with a
 * typo, or a golden-set file that failed to parse into the expected shape all
 * produce `results = []`, which printed "✅ 0 real failures" and exited 0 — byte-
 * identical to a full green suite. Exit 2 so a CI step or a shell `&&` chain can
 * tell "nothing failed" from "nothing ran".
 */
export function evalExitCode(results: Array<{ pass: boolean; knownIssue?: boolean }>): 0 | 1 | 2 {
    if (results.length === 0) return 2;
    return results.some(r => !r.pass && !r.knownIssue) ? 1 : 0;
}

/** The minimum a result must carry for the drift check to be able to see it. */
export interface DriftableResult {
    id: string;
    knownIssue?: boolean;
    observed?: BaselineEntry;
}

/**
 * Every knownIssue case whose recorded values moved since the baseline was written.
 *
 * `knownIssue` is a whole-case, all-reasons, unbounded exemption from the pass/fail
 * gate. This is the ONLY thing that still watches those cases, which is why it must
 * be a pure function with its own tests rather than a private helper inside a script
 * that cannot be imported. n-cook-06 slid from kcal100=361 (wrong record) to
 * kcal100=0 (no nutrition at all) while the gate reported "0 real failures".
 *
 * Cases with no baseline entry yet are skipped — nothing to compare — and that
 * exemption is deliberately NARROW: it applies to unknown ids only, never to a
 * pinned case whose reading disappeared. A pinned case that stops answering records
 * `errored: true` and drifts.
 */
export function driftedKnownIssues(
    results: DriftableResult[],
    baseline: Record<string, BaselineEntry>,
): Array<{ id: string; what: string }> {
    const out: Array<{ id: string; what: string }> = [];
    for (const r of results) {
        if (!r.knownIssue) continue;
        const b = baseline[r.id];
        if (!b) continue;  // new pin: nothing to compare until the baseline is refreshed
        // A pinned case with a baseline but NO observation is not "unchanged" — the
        // run produced no reading for a case it was watching. Report it as such
        // rather than falling through to `continue`, which is what made a transport
        // failure on a knownIssue case invisible in both the gate and the drift list.
        const now = r.observed ?? { errored: true };
        const changes = describeDrift(b, now);
        if (changes.length) out.push({ id: r.id, what: changes.join('; ') });
    }
    return out;
}
