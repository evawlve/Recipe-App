import * as ts from 'typescript';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
    SERVING_AI_TIERS,
    REPLAY_NONDETERMINISTIC_SERVING_TIERS,
    SYNTHETIC_GRAMS_SERVING_TIERS,
    BORROWED_OR_DEFAULTED_SERVING_TIERS,
    FLOOR_SERVING_TIERS,
    isReplayNondeterministicTier,
    isSyntheticGramsTier,
    isBorrowedOrDefaultedTier,
    isFloorTier,
    portionProvenanceForTier,
    servingAiCallForTier,
} from '../serving-ai-tiers';

/**
 * serving-tier-census.test.ts — an unlisted live `servingTier` must fail the
 * build, not default to "reads its own record".
 *
 * WHY THIS EXISTS
 * ---------------
 * Every tier predicate in `serving-ai-tiers.ts` is an allowlist and every one of
 * them returns FALSE for a string it has never heard of. That default is the right
 * one for a predicate — `isBorrowedOrDefaultedTier()`'s own docstring argues for it
 * — but it makes the whole family fail SILENTLY: a producer that stamps a new
 * string gets a confident "no" from all five questions and nothing anywhere goes
 * red.
 *
 * That is not hypothetical, it is this subsystem's recurring defect, three times:
 *
 *   - `discrete_unit_backfill` (the precedent). Two separate private regexes, in
 *     `winner-diff.ts` and `correctness-screen.ts`, both scored it deterministic
 *     because the name carries no "ai" and no "estimate". It is
 *     `getOrCreateAmbiguousServing()` — the same uncached producer as
 *     `count_unit_ai` — and it had ~1,269 live events while both screens called it
 *     replayable. Fixed by `REPLAY_NONDETERMINISTIC_SERVING_TIERS`, i.e. by
 *     replacing pattern-matching with an enumeration.
 *   - `fdc_size_qualifier` missed by those same two regexes, off the same producer
 *     as two tiers they DID match.
 *   - PRs #331/#333 (2026-08-17) then added EIGHT new strings at once, and no
 *     classification set knows any of them. Six fabricate a flat 100 g. They are
 *     named individually in `EXPECTED_CLASS` below.
 *
 * The common shape is that the enumeration is only as good as somebody remembering
 * to extend it. This file removes the remembering: it re-derives the live tier set
 * FROM THE SOURCE at test time and requires each member to be named in an explicit
 * map. A new producer is red on the next `npx jest` with no human in the loop.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It exports no predicate and wires nothing. Every class below that has a
 * shipped list is pinned to that list in BOTH directions, so this file can
 * neither invent a member nor miss one. The `FLOORS` class was test-local when
 * this file was written (#337): a fifth exported predicate with no consumer is
 * the "a rule that already existed with a caller that never used it" shape this
 * repo has shipped five times (CLAUDE.md §State digest owns that list), so the
 * membership was pinned here for whoever built the consumer. That consumer is
 * the `portionProvenance` wire field (`portionProvenanceForTier()`), and the
 * class is now the shipped `FLOOR_SERVING_TIERS` — promoted in the same PR that
 * wired it, which is the only order in which such a promotion is allowed here.
 *
 * NOTE ON A GREP THAT LOOKS COMPLETE AND IS NOT
 * ---------------------------------------------
 * The obvious enumeration —
 *   `grep -rho "servingTier [:=] '[a-z_0-9]*'" src/lib/mapping/`
 * — returns 36 of the 53 live tiers (measured 2026-08-17). It cannot see a tier
 * assigned from a ternary (`ownSize.genuine ? 'fdc_own_size_serving' : …`), from a
 * local variable (`servingTier = tier` in `buildOffResult()`), or from an imported
 * constant (`FS_SERVING_MACROS_ONLY_EST_TIER`), and it is scoped to
 * `src/lib/mapping/`, which excludes `applyOffBareQueryGuard()` in
 * `servings/bare-query-guard.ts` — a producer of three live tiers. Hence the AST
 * walk below rather than a regex: the census is the deliverable, and a census that
 * misses a producer is exactly the bug it exists to prevent.
 */

// ---------------------------------------------------------------------------
// THE CLASSIFICATION MODEL
// ---------------------------------------------------------------------------
/**
 * Five classes, answering ONE question: where did the billed grams come from?
 * Every live tier gets exactly one, settled by READING THE PRODUCER — the same
 * discipline `serving-ai-tiers.ts` documents for its own three lists, and
 * load-bearing here for the same reason: the names lie in both directions.
 * `bare_discrete_floor` is not a FLOOR in this taxonomy (it is a lexicon table
 * lookup, and is a shipped BORROWED_OR_DEFAULTED member); `fdc_size_estimate`
 * carries neither "ai" nor "llm" and is the largest model-reaching tier.
 */
type TierClass =
    /** Grams read off THIS record's own data — its label serving, its own package
     *  quantity, its own FdcServing/AmbiguousServing row, or its own panel. */
    | 'OWN'
    /** Grams are the quantity the USER typed, converted by a pure physical
     *  constant. Makes no claim about the food at all. */
    | 'USER'
    /** The shipped `BORROWED_OR_DEFAULTED_SERVING_TIERS`: another product's data,
     *  or a generic table that knows nothing about this record. */
    | 'BORROWED_OR_DEFAULTED'
    /** The shipped `REPLAY_NONDETERMINISTIC_SERVING_TIERS`: a producer that can
     *  reach a live estimator, so two replays may disagree. */
    | 'NONDETERMINISTIC'
    /** The shipped `FLOOR_SERVING_TIERS`: grams are a FABRICATED flat 100 g (or a
     *  fabricated bounded floor) reached because every rung above failed. */
    | 'FLOORS';

/**
 * Every tier string reachable in `src/**` today, with the class its producer
 * puts it in. 53 entries (measured 2026-08-17). Adding a producer without adding
 * a row here fails `every live tier is named`; deleting a producer without
 * deleting its row here fails `every named tier is still live`.
 */
const EXPECTED_CLASS: Readonly<Record<string, TierClass>> = Object.freeze({
    // ================= NONDETERMINISTIC — shipped set, 8 members =================
    // Mirrors REPLAY_NONDETERMINISTIC_SERVING_TIERS exactly; the assertion below
    // pins the two together in both directions so neither can drift.
    count_unit_ai: 'NONDETERMINISTIC',
    discrete_unit_backfill: 'NONDETERMINISTIC',
    fdc_size_estimate: 'NONDETERMINISTIC',
    fdc_medium_estimate: 'NONDETERMINISTIC',
    fdc_size_qualifier: 'NONDETERMINISTIC',
    fdc_piece_ai: 'NONDETERMINISTIC',
    fdc_volume_ai: 'NONDETERMINISTIC',
    ai_generated_serving: 'NONDETERMINISTIC',

    // ============= BORROWED_OR_DEFAULTED — shipped set, 17 members ==============
    // Same deal: mirrors BORROWED_OR_DEFAULTED_SERVING_TIERS, pinned both ways.
    // That file's own comments own WHY each is a member; not restated here.
    bare_sibling_serving: 'BORROWED_OR_DEFAULTED',
    package_count_sibling: 'BORROWED_OR_DEFAULTED',
    package_quantity_sibling: 'BORROWED_OR_DEFAULTED',
    bare_name_sibling_serving: 'BORROWED_OR_DEFAULTED',
    bare_name_sibling_serving_tight: 'BORROWED_OR_DEFAULTED',
    bare_name_sibling_serving_plural: 'BORROWED_OR_DEFAULTED',
    seed_count_default: 'BORROWED_OR_DEFAULTED',
    bare_category_default: 'BORROWED_OR_DEFAULTED',
    bare_query_default: 'BORROWED_OR_DEFAULTED',
    bare_discrete_floor: 'BORROWED_OR_DEFAULTED',
    volume_unit: 'BORROWED_OR_DEFAULTED',
    // buildOffResult()'s own-label volume read (punch #66). Classified here and
    // NOT as OWN: it bills `qty x unitMl x (servingGrams / declaredMl)`, and that
    // ratio is a defaulted 1.0 on 99.78% of the corpus because the ingest wrote
    // `grams := ml`. Sibling of `volume_unit`, not of `fdc_label_volume`.
    off_label_volume: 'BORROWED_OR_DEFAULTED',
    fs_volume_density: 'BORROWED_OR_DEFAULTED',
    fdc_sub_piece_default: 'BORROWED_OR_DEFAULTED',
    fdc_unit_heuristic: 'BORROWED_OR_DEFAULTED',
    bare_dose_count_reconciled: 'BORROWED_OR_DEFAULTED',
    // Also the sole SYNTHETIC_GRAMS member. The overlap is deliberate and is
    // pinned as a subset relation by serving-ai-tiers.test.ts.
    fs_serving_macros_only_est: 'BORROWED_OR_DEFAULTED',

    // ============================ USER — 2 members =============================
    // `grams = qty * WEIGHT_TO_GRAMS[unit]`, both lanes. The typed number and an
    // oz->g constant; nothing about the record is consulted. The sibling
    // `volume_unit` is NOT here and that asymmetry is the point — a volume unit
    // needs a DENSITY, which comes from a name-inferred lexicon, so it is
    // defaulted while this is not.
    weight_unit: 'USER',
    fs_weight_direct: 'USER',

    // ============================= OWN — 18 members ============================
    // `buildOffResult()` in serving/hydration-lane.ts:
    bare_label_serving: 'OWN',
    bare_plural_serving: 'OWN',
    label_unit_match: 'OWN',
    label_serving_package_unit: 'OWN',
    label_count_derived: 'OWN',
    label_serving_default: 'OWN',
    package_count_own: 'OWN',
    package_quantity_own: 'OWN',
    // `buildFdcResult()` in the same file. The `_cached` members are OWN by
    // LOCATION and AI-seeded by ORIGIN: `findOwnFdcSizeServing()` /
    // `findOwnFdcVolumeServing()` read a persisted row keyed to THIS fdcId, and
    // the row's `.genuine` flag is precisely what splits the pair — a real USDA
    // household measure vs an AI-written one that has since been stored. They are
    // OWN here because the read is deterministic and record-specific, which is
    // also why the shipped predicates answer "no" to all five questions for them.
    fdc_label_volume: 'OWN',
    fdc_volume_cached: 'OWN',
    fdc_own_size_serving: 'OWN',
    fdc_own_size_cached: 'OWN',
    // A cache HIT of `getOrCreateAmbiguousServing()`, keyed (foodId, unit).
    // serving-ai-tiers.test.ts already pins it as neither billed nor replay-
    // nondeterministic; same reading, stated once more as a provenance class.
    count_unit_cached: 'OWN',
    // `buildFatSecretResult()` in build-fatsecret-result.ts:
    fs_label_volume: 'OWN',
    fs_label_volume_declared: 'OWN',
    fs_label_count: 'OWN',
    fs_default_serving: 'OWN',
    // The panel-INVERTING leg of the macro-only branch: grams recovered by
    // dividing this record's own per-serving macros by its own per-100g panel.
    // Its one-suffix sibling `fs_serving_macros_only_est` fabricates them at a
    // flat 2.0 kcal/g and is BORROWED_OR_DEFAULTED above.
    fs_serving_macros_only: 'OWN',

    // ============================ FLOORS — 9 members ===========================
    // `grams = 100 * qty` (or a bounded flat 100) with no data behind the number.
    // Mirrors FLOOR_SERVING_TIERS exactly, pinned both ways below like the two
    // shipped sets above; that file's own comments own WHY each is a member.
    //
    // The three that predate #331/#333. All three are already PINNED NON-MEMBERS
    // of BORROWED_OR_DEFAULTED_SERVING_TIERS, and that file's header explains the
    // reasoning: the honest floors are a different claim from borrowed grams.
    flat_100g_default: 'FLOORS',
    count_unresolved_floor: 'FLOORS',
    fs_per100g_fallback: 'FLOORS',
    //
    // THE SIX #331/#333 ADDED. Every one bills `grams = 100 * qty` on an arm that
    // previously fell through to `flat_100g_default` unnamed — splitting them out
    // is what those PRs did, and it is why an unlisted-tier census is worth having
    // at all: five distinct failure modes used to reach MappingEventLog under one
    // string. Verified by reading each arm in serving/hydration-lane.ts, 2026-08-17.
    fdc_size_key_missing: 'FLOORS',       // estimator answered, not for this spelling
    fdc_size_unresolved: 'FLOORS',        // estimator itself failed
    fdc_piece_unresolved: 'FLOORS',       // high-count ladder, all three rungs failed
    fdc_size_estimate_unresolved: 'FLOORS', // low-count size estimation failed
    count_unit_unresolved: 'FLOORS',      // ambiguous-unit estimator declined
    fdc_unknown_unit: 'FLOORS',           // terminal arm; nothing was even attempted
});

/**
 * The eight strings #331/#333 introduced, with the class each belongs in.
 * Named separately from the map because they are the precedent this file was
 * written for: when it was written NONE of them was in any exported set, so all
 * four predicates of the day answered false for all eight. Six of those falses
 * were the gap — a FLOORS consumer would want them — and are now members of
 * `FLOOR_SERVING_TIERS`; two (`fdc_own_size_*`) stay unknown to every list,
 * correctly, because reading the record's own row is exactly what the default
 * assumption says.
 */
const TIERS_ADDED_BY_331_333: Readonly<Record<string, TierClass>> = Object.freeze({
    fdc_own_size_serving: 'OWN',
    fdc_own_size_cached: 'OWN',
    fdc_size_key_missing: 'FLOORS',
    fdc_size_unresolved: 'FLOORS',
    fdc_size_estimate_unresolved: 'FLOORS',
    fdc_piece_unresolved: 'FLOORS',
    count_unit_unresolved: 'FLOORS',
    fdc_unknown_unit: 'FLOORS',
});

// ---------------------------------------------------------------------------
// THE SCAN — derive the live tier set from source, not from a copy
// ---------------------------------------------------------------------------

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const SRC_ROOT = join(REPO_ROOT, 'src');

/** Every non-test `.ts`/`.tsx` under `src/`. Tests are excluded because a
 *  fixture tier is not a live tier — inventing one in a fixture is how the
 *  `discrete_unit_backfill` gap survived a green suite. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name !== '__tests__' && e.name !== 'node_modules') sourceFiles(p, acc);
        } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
            acc.push(p);
        }
    }
    return acc;
}

/**
 * A `servingTier` RHS this scan cannot reduce to string literals. Each is a
 * PASS-THROUGH or an ALIAS, not a producer — verified by reading it, 2026-08-17.
 * The set is asserted exactly, so a NEW indirect form (a producer that computes
 * its tier, or a fifth pass-through) fails this file rather than silently
 * shrinking the census.
 */
const KNOWN_INDIRECT_ASSIGNMENTS: Readonly<Record<string, string>> = Object.freeze({
    // buildFatSecretResult() hands the OFF-named twin of its own tier INTO
    // applyOffBareQueryGuard(), whose sets are keyed on the OFF names. Values are
    // 'label_serving_default' and 'flat_100g_default', both live tiers already.
    'GUARD_TIER_ALIAS[servingTier]':
        'alias passed into the bare-query guard; both values are live tiers',
    // The guard's own return, in both lanes. Its three literals are produced in
    // servings/bare-query-guard.ts and are counted from there.
    'bareOverride.servingTier':
        'applyOffBareQueryGuard() return; its literals are scanned at their producer',
    // Pass-throughs onto a log/validator payload. None stamps a result.
    'input.servingTier': 'cache-validator payload pass-through',
    'result.servingTier ?? null': 'mapper -> analysis-log pass-through',
    'isMapped ? ((mapped as any).servingTier ?? null) : null':
        '/api/nlp/parse -> MappingEventLog row pass-through',
    // The five RESULT-EMISSION sites — `return { …, servingTier }` at the end of
    // buildFatSecretResult(), buildFdcResult(), buildOffResult() and the AI-panel
    // exit. They emit the local the cascade branches above have been assigning, so
    // they carry no literal of their own and every value they can emit is already
    // counted at its branch. Listed rather than ignored because the shape could
    // hide a producer if a future exit built its own tier inline.
    '{ servingTier } (shorthand)':
        'result-object emission of the cascade local; its literals are counted at each branch',
});

interface ScanResult {
    tiers: Set<string>;
    indirect: Set<string>;
    filesScanned: number;
    assignmentSites: number;
}

function scan(): ScanResult {
    const files = sourceFiles(SRC_ROOT);

    // A module-level `const NAME = 'literal'` anywhere under src/, so an imported
    // tier constant (FS_SERVING_MACROS_ONLY_EST_TIER) resolves across files.
    const stringConsts = new Map<string, string>();
    const texts = new Map<string, string>();
    for (const f of files) {
        const text = readFileSync(f, 'utf8');
        texts.set(f, text);
        const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=;]+)?=\s*'([a-z_0-9]+)'/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) stringConsts.set(m[1], m[2]);
    }

    // Only files that mention the identifier can assign to it.
    const candidates = files.filter((f) => texts.get(f)!.includes('servingTier'));

    const tiers = new Set<string>();
    const indirect = new Set<string>();
    let assignmentSites = 0;

    for (const f of candidates) {
        const sf = ts.createSourceFile(f, texts.get(f)!, ts.ScriptTarget.Latest, true);

        /** Reduce an expression to the string literals it can evaluate to, or
         *  null when the scan cannot see through it. */
        const resolve = (e: ts.Expression): string[] | null => {
            if (ts.isParenthesizedExpression(e)) return resolve(e.expression);
            if (ts.isAsExpression(e)) return resolve(e.expression);
            if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [e.text];
            if (ts.isConditionalExpression(e)) {
                const a = resolve(e.whenTrue);
                const b = resolve(e.whenFalse);
                return a && b ? [...a, ...b] : null;
            }
            if (
                ts.isBinaryExpression(e)
                && (e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
                    || e.operatorToken.kind === ts.SyntaxKind.BarBarToken)
            ) {
                const a = resolve(e.left);
                const b = resolve(e.right);
                return a && b ? [...a, ...b] : null;
            }
            if (ts.isIdentifier(e)) {
                if (stringConsts.has(e.text)) return [stringConsts.get(e.text)!];
                // A local `const tier = <ternary>` in this file.
                let found: string[] | null = null;
                const look = (n: ts.Node): void => {
                    if (
                        ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)
                        && n.name.text === e.text && n.initializer
                    ) {
                        const r = resolve(n.initializer);
                        if (r) found = found ? [...found, ...r] : r;
                    }
                    ts.forEachChild(n, look);
                };
                look(sf);
                return found;
            }
            return null;
        };

        const visit = (n: ts.Node): void => {
            let rhs: ts.Expression | null = null;
            let shorthand = false;

            if (
                ts.isBinaryExpression(n)
                && n.operatorToken.kind === ts.SyntaxKind.EqualsToken
                && ((ts.isIdentifier(n.left) && n.left.text === 'servingTier')
                    || (ts.isPropertyAccessExpression(n.left) && n.left.name.text === 'servingTier'))
            ) {
                rhs = n.right;
            } else if (
                ts.isPropertyAssignment(n)
                && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name))
                && n.name.text === 'servingTier'
            ) {
                rhs = n.initializer;
            } else if (
                ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)
                && n.name.text === 'servingTier' && n.initializer
            ) {
                rhs = n.initializer;
            } else if (
                ts.isShorthandPropertyAssignment(n) && n.name.text === 'servingTier'
            ) {
                // `{ servingTier }` — no RHS to read. Reported as indirect so a
                // future producer in this shape cannot vanish from the census.
                shorthand = true;
            }

            if (shorthand) {
                assignmentSites += 1;
                indirect.add('{ servingTier } (shorthand)');
            } else if (rhs) {
                assignmentSites += 1;
                const r = resolve(rhs);
                if (r) r.forEach((s) => tiers.add(s));
                else indirect.add(rhs.getText(sf).replace(/\s+/g, ' ').trim());
            }
            ts.forEachChild(n, visit);
        };
        visit(sf);
    }

    return { tiers, indirect, filesScanned: candidates.length, assignmentSites };
}

const SCAN = scan();
const LIVE_TIERS = [...SCAN.tiers].sort();

// ---------------------------------------------------------------------------

describe('the scan is not vacuous', () => {
    /**
     * Every assertion below is of the form "the derived set matches the map", and
     * an empty derived set satisfies half of them. These pin the scan itself.
     */
    it('found producer files and assignment sites', () => {
        expect(SCAN.filesScanned).toBeGreaterThanOrEqual(4);
        expect(SCAN.assignmentSites).toBeGreaterThanOrEqual(50);
        expect(LIVE_TIERS.length).toBeGreaterThanOrEqual(50);
    });

    /**
     * One representative per RESOLUTION FORM. A regression in any single branch
     * of `resolve()` silently shrinks the census, and shrinking it is the failure
     * mode this whole file exists to prevent — so each form gets a witness rather
     * than trusting the total.
     */
    it('sees every form a tier can be assigned in', () => {
        // plain literal, `servingTier = 'weight_unit'`
        expect(LIVE_TIERS).toContain('weight_unit');
        // ternary, `ownSize.genuine ? 'fdc_own_size_serving' : 'fdc_own_size_cached'`
        expect(LIVE_TIERS).toContain('fdc_own_size_serving');
        expect(LIVE_TIERS).toContain('fdc_own_size_cached');
        // local variable, `const tier = …; servingTier = tier` in buildOffResult()
        expect(LIVE_TIERS).toContain('bare_name_sibling_serving_tight');
        // imported constant, FS_SERVING_MACROS_ONLY_EST_TIER
        expect(LIVE_TIERS).toContain('fs_serving_macros_only_est');
        // producer OUTSIDE src/lib/mapping — servings/bare-query-guard.ts
        expect(LIVE_TIERS).toContain('bare_category_default');
        // the precedent this file is named for
        expect(LIVE_TIERS).toContain('discrete_unit_backfill');
    });

    it('resolves all but the known pass-throughs', () => {
        expect([...SCAN.indirect].sort()).toEqual(Object.keys(KNOWN_INDIRECT_ASSIGNMENTS).sort());
    });
});

describe('the census — every live tier is explicitly accounted for', () => {
    /**
     * THE POINT OF THE FILE. A producer that stamps a new string without a row in
     * EXPECTED_CLASS fails here, instead of receiving a silent `false` from all
     * five predicates.
     */
    it('every live tier is named in EXPECTED_CLASS', () => {
        const unclassified = LIVE_TIERS.filter((t) => !(t in EXPECTED_CLASS));
        expect(unclassified).toEqual([]);
    });

    /** The other direction: a retired producer must not leave a row rotting here,
     *  which is how a list drifts into describing a system that no longer exists. */
    it('every named tier is still produced by live code', () => {
        const dead = Object.keys(EXPECTED_CLASS).filter((t) => !SCAN.tiers.has(t));
        expect(dead).toEqual([]);
    });

    it('classifies 54 tiers, one class each', () => {
        // 53 -> 54 on 2026-09-04: buildOffResult() gained `off_label_volume`
        // (punch #66). The scan found the new string on its own and this
        // assertion is what forced it to be classified — which is the whole
        // reason the census exists.
        expect(LIVE_TIERS).toHaveLength(54);
        expect(Object.keys(EXPECTED_CLASS)).toHaveLength(54);
    });
});

describe('the map agrees with the shipped predicates', () => {
    const byClass = (c: TierClass) =>
        Object.keys(EXPECTED_CLASS).filter((t) => EXPECTED_CLASS[t] === c).sort();

    /** Both directions, so the map can neither miss a shipped member nor invent one. */
    it('BORROWED_OR_DEFAULTED matches isBorrowedOrDefaultedTier() exactly', () => {
        expect(byClass('BORROWED_OR_DEFAULTED')).toEqual([...BORROWED_OR_DEFAULTED_SERVING_TIERS].sort());
        for (const t of LIVE_TIERS) {
            expect(isBorrowedOrDefaultedTier(t)).toBe(EXPECTED_CLASS[t] === 'BORROWED_OR_DEFAULTED');
        }
    });

    it('NONDETERMINISTIC matches isReplayNondeterministicTier() exactly', () => {
        expect(byClass('NONDETERMINISTIC')).toEqual([...REPLAY_NONDETERMINISTIC_SERVING_TIERS].sort());
        for (const t of LIVE_TIERS) {
            expect(isReplayNondeterministicTier(t)).toBe(EXPECTED_CLASS[t] === 'NONDETERMINISTIC');
        }
    });

    /** Same deal for the list this file used to hold test-locally: the export
     *  and the census can neither miss a floor nor invent one. */
    it('FLOORS matches isFloorTier() exactly', () => {
        expect(byClass('FLOORS')).toEqual([...FLOOR_SERVING_TIERS].sort());
        expect(FLOOR_SERVING_TIERS).toHaveLength(9);
        for (const t of LIVE_TIERS) {
            expect(isFloorTier(t)).toBe(EXPECTED_CLASS[t] === 'FLOORS');
        }
    });

    /**
     * The wire field is the two lists read together, and nothing else: a
     * BORROWED_OR_DEFAULTED tier ships `'borrowed'`, a FLOORS tier ships
     * `'floor'`, every other live tier ships NO field. Asserted over the whole
     * census so a tier that moves class moves the wire with it, and so a
     * NONDETERMINISTIC tier can never leak onto the field by accident.
     */
    it('portionProvenanceForTier() is the class map, on every live tier', () => {
        for (const t of LIVE_TIERS) {
            const cls = EXPECTED_CLASS[t];
            const want = cls === 'BORROWED_OR_DEFAULTED' ? 'borrowed'
                : cls === 'FLOORS' ? 'floor'
                : undefined;
            expect([t, portionProvenanceForTier(t)]).toEqual([t, want]);
        }
    });

    it('every billed tier is classified NONDETERMINISTIC', () => {
        for (const t of Object.keys(SERVING_AI_TIERS)) {
            expect(EXPECTED_CLASS[t]).toBe('NONDETERMINISTIC');
        }
    });

    /** The subset relation serving-ai-tiers.ts calls deliberate: the synthetic
     *  tier is also a BORROWED_OR_DEFAULTED member, so a consumer widening from
     *  `isSyntheticGramsTier()` to that set cannot silently UNFLAG it. */
    it('the synthetic-grams tier sits inside BORROWED_OR_DEFAULTED', () => {
        for (const t of SYNTHETIC_GRAMS_SERVING_TIERS) {
            expect(EXPECTED_CLASS[t]).toBe('BORROWED_OR_DEFAULTED');
        }
    });

    /**
     * OWN and USER are exactly the tiers every shipped predicate answers "no"
     * to, and that "no" is correct: the weight is this record's or the user's.
     * Pinned so a list cannot quietly absorb one of them.
     */
    it('OWN and USER are unknown to all five shipped predicates', () => {
        const unclaimed = LIVE_TIERS.filter((t) =>
            EXPECTED_CLASS[t] === 'OWN' || EXPECTED_CLASS[t] === 'USER');
        expect(unclaimed.length).toBe(20);
        for (const t of unclaimed) {
            expect(isBorrowedOrDefaultedTier(t)).toBe(false);
            expect(isReplayNondeterministicTier(t)).toBe(false);
            expect(isSyntheticGramsTier(t)).toBe(false);
            expect(isFloorTier(t)).toBe(false);
            expect(servingAiCallForTier(t)).toEqual({ called: false });
            expect(portionProvenanceForTier(t)).toBeUndefined();
        }
    });

    /**
     * FLOORS used to be the KNOWN GAP this test pinned: nine tiers whose grams
     * are fabricated and no predicate that said so. They are now known to
     * EXACTLY ONE predicate — `isFloorTier()` — and to no other, which is the
     * disjointness the wire field's two values rest on.
     */
    it('FLOORS are known to isFloorTier() and to nothing else', () => {
        const floors = LIVE_TIERS.filter((t) => EXPECTED_CLASS[t] === 'FLOORS');
        expect(floors.length).toBe(9);
        for (const t of floors) {
            expect(isFloorTier(t)).toBe(true);
            expect(portionProvenanceForTier(t)).toBe('floor');
            expect(isBorrowedOrDefaultedTier(t)).toBe(false);
            expect(isReplayNondeterministicTier(t)).toBe(false);
            expect(isSyntheticGramsTier(t)).toBe(false);
            expect(servingAiCallForTier(t)).toEqual({ called: false });
        }
    });
});

describe('the eight tiers PRs #331/#333 added, which no shipped set knew until FLOOR_SERVING_TIERS', () => {
    it('are all live', () => {
        for (const t of Object.keys(TIERS_ADDED_BY_331_333)) {
            expect(SCAN.tiers.has(t)).toBe(true);
        }
    });

    it('carry the class the census assigns them', () => {
        for (const [t, cls] of Object.entries(TIERS_ADDED_BY_331_333)) {
            expect(EXPECTED_CLASS[t]).toBe(cls);
        }
    });

    /**
     * THE GAP, CLOSED. When this file was written, six of these fabricated a
     * flat 100 g and every predicate called them ordinary; the block recorded
     * that state and asked the PR that shipped a consumer to update it rather
     * than delete it. That PR is the `portionProvenance` wire field: the six
     * are now in FLOOR_SERVING_TIERS and in NO other list, and the two OWN
     * tiers stay out of every list — the state THIS census records.
     */
    it('the six floors are in FLOOR_SERVING_TIERS only; the two OWN tiers are in no list', () => {
        const nonFloorLists = new Set<string>([
            ...Object.keys(SERVING_AI_TIERS),
            ...REPLAY_NONDETERMINISTIC_SERVING_TIERS,
            ...SYNTHETIC_GRAMS_SERVING_TIERS,
            ...BORROWED_OR_DEFAULTED_SERVING_TIERS,
        ]);
        for (const [t, cls] of Object.entries(TIERS_ADDED_BY_331_333)) {
            expect(nonFloorLists.has(t)).toBe(false);
            expect([t, isFloorTier(t)]).toEqual([t, cls === 'FLOORS']);
        }
    });

    it('six of the eight bill a fabricated 100 g', () => {
        const floors = Object.entries(TIERS_ADDED_BY_331_333)
            .filter(([, c]) => c === 'FLOORS').map(([t]) => t).sort();
        expect(floors).toEqual([
            'count_unit_unresolved',
            'fdc_piece_unresolved',
            'fdc_size_estimate_unresolved',
            'fdc_size_key_missing',
            'fdc_size_unresolved',
            'fdc_unknown_unit',
        ]);
    });
});
