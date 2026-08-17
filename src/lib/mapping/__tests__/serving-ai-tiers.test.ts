import { readFileSync } from 'fs';
import { join } from 'path';
import {
    servingAiCallForTier,
    SERVING_AI_TIERS,
    isReplayNondeterministicTier,
    REPLAY_NONDETERMINISTIC_SERVING_TIERS,
    isSyntheticGramsTier,
    SYNTHETIC_GRAMS_SERVING_TIERS,
    isBorrowedOrDefaultedTier,
    BORROWED_OR_DEFAULTED_SERVING_TIERS,
} from '../serving-ai-tiers';

/**
 * Each block names the mutation that must kill it. The mutations below were
 * actually applied and confirmed red before this file was committed — a test
 * written against its own author's mental model shares that model's blind spots.
 *
 * The defect class this guards is specific: the `servingTier` strings are NOT a
 * reliable guide to whether a model ran, in EITHER direction. Anyone who
 * "simplifies" the allowlist into a name pattern reintroduces both halves at once,
 * so the two traps get a test each.
 */

describe('servingAiCallForTier — tiers whose producer calls an LLM', () => {
    // MUTATION: delete `fdc_size_estimate` from SERVING_AI_TIERS, or replace the
    // allowlist with a /ai/ substring test. Either makes this red.
    it('reports the largest AI tier, whose name contains no "ai" at all', () => {
        // getOrCreateFdcSizeServings() has no cache — every event is a live call.
        expect(servingAiCallForTier('fdc_size_estimate')).toEqual({ called: true, type: 'produce' });
        expect(servingAiCallForTier('fdc_medium_estimate')).toEqual({ called: true, type: 'produce' });
    });

    it('reports the explicitly-named AI tiers with their purpose', () => {
        expect(servingAiCallForTier('count_unit_ai')).toEqual({ called: true, type: 'ambiguous' });
        expect(servingAiCallForTier('fdc_volume_ai')).toEqual({ called: true, type: 'weight' });
        expect(servingAiCallForTier('fdc_piece_ai')).toEqual({ called: true, type: 'produce' });
    });
});

describe('servingAiCallForTier — tiers that must NOT be reported', () => {
    // MUTATION: add `ai_generated_serving: 'ambiguous'` to SERVING_AI_TIERS — the
    // reading a name-based rule would produce. This is the over-reporting half:
    // getAiServingGrams() only reads AiGeneratedServing rows and does unit maths.
    it('does not invent a call for `ai_generated_serving`, which runs no model', () => {
        expect(servingAiCallForTier('ai_generated_serving')).toEqual({ called: false });
    });

    // MUTATION: map either cached sibling to its AI counterpart's type. These are
    // cache HITS of `count_unit_ai` / `fdc_volume_ai` and cost nothing.
    it('does not count the cached siblings of AI tiers', () => {
        expect(servingAiCallForTier('count_unit_cached')).toEqual({ called: false });
        expect(servingAiCallForTier('fdc_volume_cached')).toEqual({ called: false });
    });

    it('does not count deterministic label/weight tiers', () => {
        for (const tier of ['weight_unit', 'label_unit_match', 'bare_label_serving', 'flat_100g_default']) {
            expect(servingAiCallForTier(tier)).toEqual({ called: false });
        }
    });
});

describe('servingAiCallForTier — the legacy-cascade blind spot', () => {
    // MUTATION: return `{}` or `undefined` for an absent tier instead of
    // `{ called: false }`. The whole point of 0.5(b) is telling "resolved without a
    // model" apart from "never populated", and an absent field collapses them.
    it('returns an explicit called:false for an unstamped tier, never undefined', () => {
        expect(servingAiCallForTier(undefined)).toEqual({ called: false });
        expect(servingAiCallForTier(null)).toEqual({ called: false });
        expect(servingAiCallForTier('')).toEqual({ called: false });
    });

    it('has no `type` when nothing was called, so the log cannot imply a purpose', () => {
        expect(servingAiCallForTier('weight_unit').type).toBeUndefined();
    });
});

describe('SERVING_AI_TIERS — the table itself', () => {
    // MUTATION: drop Object.freeze. A caller mutating the shared table would
    // silently change every later line's telemetry in the same process.
    it('is frozen', () => {
        expect(Object.isFrozen(SERVING_AI_TIERS)).toBe(true);
    });

    // MUTATION: widen the union in serving-ai-tiers.ts without updating
    // mapping-logger.ts's `aiCalls.serving.type`. Types are erased at runtime, so
    // only an explicit assertion catches the drift.
    it('emits only the three purposes mapping-logger.ts declares', () => {
        expect(new Set(Object.values(SERVING_AI_TIERS)))
            .toEqual(new Set(['ambiguous', 'produce', 'weight']));
    });
});

/**
 * THE REPLAY-NONDETERMINISM PREDICATE — the offline instruments' half.
 *
 * winner-diff.ts and correctness-screen.ts each carried a PRIVATE regex for this
 * (`/(^|_)ai(_|$)|estimate/i` and `/(^|_)ai(_|$)|estimat/i`). The visible symptom
 * was that they disagreed; the actual defect was the half they agreed on, because
 * a name pattern silently returns false for a tier it has never seen.
 */
describe('isReplayNondeterministicTier — the two tiers both regexes missed', () => {
    // MUTATION: delete 'discrete_unit_backfill' from the set. This goes red.
    // Producer: getOrCreateAmbiguousServing(), the SAME call as `count_unit_ai`,
    // but this branch stamps one name for both `success` and `cached`, so no
    // name-based rule can ever separate them. 1,269 of 69,529 events.
    it('flags `discrete_unit_backfill`, which neither retired regex matched', () => {
        expect(isReplayNondeterministicTier('discrete_unit_backfill')).toBe(true);
        expect(/(^|_)ai(_|$)|estimate/i.test('discrete_unit_backfill')).toBe(false);
        expect(/(^|_)ai(_|$)|estimat/i.test('discrete_unit_backfill')).toBe(false);
    });

    // MUTATION: delete 'fdc_size_qualifier'. Producer: getOrCreateFdcSizeServings(),
    // uncached by construction — the same function behind `fdc_size_estimate` and
    // `fdc_medium_estimate`, both of which the old regexes DID match on 'estimat'.
    // 345 events. Missing it was a pure naming accident.
    it('flags `fdc_size_qualifier`, off the same uncached producer as two members', () => {
        expect(isReplayNondeterministicTier('fdc_size_qualifier')).toBe(true);
        expect(/(^|_)ai(_|$)|estimate/i.test('fdc_size_qualifier')).toBe(false);
        expect(/(^|_)ai(_|$)|estimat/i.test('fdc_size_qualifier')).toBe(false);
    });
});

describe('isReplayNondeterministicTier — tiers an ADJACENCY scan wrongly nominates', () => {
    /**
     * These four were nominated by scanning for tier literals within 55 lines of an
     * AI producer call, and all four are REFUTED by reading the branch that stamps
     * them — each sits in a sibling `else` that never reads the AI result:
     *
     *   volume_unit         5,379  the `!volumeResolved` hardcoded-density fallback
     *   bare_plural_serving 2,268  the `!unit && integer qty` branch
     *   bare_sibling_serving 2,230 the (C2) same-brand sibling MEDIAN — a DB read
     *   bare_query_default    463  the bare-query inflation guard, a separate block
     *
     * Together they are 10,340 events. Marking them nondeterministic would silence
     * D5/D6 and winner-diff on 15% of the corpus — the instrument going quiet is the
     * expensive failure here, not the loud one.
     *
     * MUTATION: add any one of them to the set. This goes red.
     */
    it('does not flag the four sibling-branch tiers', () => {
        for (const tier of ['volume_unit', 'bare_plural_serving', 'bare_sibling_serving', 'bare_query_default']) {
            expect(isReplayNondeterministicTier(tier)).toBe(false);
        }
    });

    it('does not flag the cached siblings, which are pure row reads', () => {
        expect(isReplayNondeterministicTier('count_unit_cached')).toBe(false);
        expect(isReplayNondeterministicTier('fdc_volume_cached')).toBe(false);
    });

    it('treats an absent tier as deterministic, matching both retired regexes', () => {
        // The legacy cascade stamps no tier at all (535 live rows). Both instruments
        // read that as "judge it", and this edit deliberately does not change that —
        // flipping it is a separate decision with its own blast radius.
        expect(isReplayNondeterministicTier(null)).toBe(false);
        expect(isReplayNondeterministicTier(undefined)).toBe(false);
        expect(isReplayNondeterministicTier('')).toBe(false);
    });
});

describe('the two predicates are related but NOT equal', () => {
    // MUTATION: replace isReplayNondeterministicTier's body with
    // `servingAiCallForTier(tier).called`. This goes red on both directions below.
    it('every BILLED tier is also replay-nondeterministic (billing ⊆ nondeterminism)', () => {
        // The durable invariant: a future addition to SERVING_AI_TIERS that is not
        // also added here would leave an instrument charging model noise to a change.
        for (const tier of Object.keys(SERVING_AI_TIERS)) {
            expect(isReplayNondeterministicTier(tier)).toBe(true);
        }
    });

    it('but not the reverse — three members bill nothing through SERVING_AI_TIERS', () => {
        // ai_generated_serving: runs no model, reads a model-WRITTEN row.
        // discrete_unit_backfill / fdc_size_qualifier: deliberately not added to the
        // billing allowlist (see the module header) — it has its own owner doc.
        for (const tier of ['ai_generated_serving', 'discrete_unit_backfill', 'fdc_size_qualifier']) {
            expect(isReplayNondeterministicTier(tier)).toBe(true);
            expect(servingAiCallForTier(tier).called).toBe(false);
        }
    });

    /**
     * The first cut of this exported it as `Object.freeze(new Set([...]))` and
     * asserted `Object.isFrozen()`. That assertion was GREEN and the guard did not
     * hold: freezing a Set stops nothing, because its contents are internal slots,
     * not own properties — `isFrozen` returns true and `.add()` still works. Asserted
     * here as BEHAVIOUR (does a mutation actually fail?) rather than as a property,
     * which is the only form that could have caught it.
     *
     * MUTATION: drop the Object.freeze wrapper in serving-ai-tiers.ts. Red.
     */
    it('rejects mutation for real, not just to Object.isFrozen', () => {
        expect(Object.isFrozen(REPLAY_NONDETERMINISTIC_SERVING_TIERS)).toBe(true);
        const before = REPLAY_NONDETERMINISTIC_SERVING_TIERS.length;
        expect(() => (REPLAY_NONDETERMINISTIC_SERVING_TIERS as string[]).push('x')).toThrow(TypeError);
        expect(REPLAY_NONDETERMINISTIC_SERVING_TIERS.length).toBe(before);
    });

    it('has no duplicate members', () => {
        expect(new Set(REPLAY_NONDETERMINISTIC_SERVING_TIERS).size)
            .toBe(REPLAY_NONDETERMINISTIC_SERVING_TIERS.length);
    });
});

/**
 * THE DURABLE HALF. Correcting two tiers is a one-off; this is the guard that makes
 * the NEXT missed tier impossible to add silently.
 *
 * An allowlist has the same failure mode as a regex — it returns false for a tier
 * nobody classified. What it cannot do on its own is notice that a new AI PRODUCER
 * appeared. So pin the call-site counts: adding a call to any of these four
 * functions trips this test, and whoever adds it must decide which tier it stamps
 * and whether that tier belongs in the set above.
 *
 * These counts are the reason this fix is not just "two more strings".
 */
describe('producer call-site census — the guard against the next silent miss', () => {
    const SRC = join(__dirname, '..', '..', '..', '..', 'src');

    // Counts measured 2026-08-05 on master @ 93a6219. Re-derive:
    //   grep -rn "await <fn>(" src/ | grep -v __tests__ | wc -l
    const EXPECTED: Record<string, number> = {
        getOrCreateAmbiguousServing: 7,
        getOrCreateFdcSizeServings: 3,
        insertFdcAiServing: 1,
        estimateAmbiguousServing: 4,
    };

    function countCallSites(fn: string): number {
        const out: string[] = [];
        const walk = (dir: string) => {
            for (const e of require('fs').readdirSync(dir, { withFileTypes: true })) {
                const p = join(dir, e.name);
                if (e.isDirectory()) {
                    if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p);
                } else if (e.name.endsWith('.ts')) {
                    out.push(p);
                }
            }
        };
        walk(SRC);
        let n = 0;
        for (const f of out) {
            for (const line of readFileSync(f, 'utf8').split('\n')) {
                if (line.includes(`await ${fn}(`)) n++;
            }
        }
        return n;
    }

    for (const [fn, expected] of Object.entries(EXPECTED)) {
        // MUTATION: add or remove any call to one of these functions in src/.
        it(`${fn} still has exactly ${expected} call site(s) outside tests`, () => {
            expect(countCallSites(fn)).toBe(expected);
        });
    }
});

/**
 * SYNTHETIC GRAMS — the third predicate.
 *
 * Mutation that must kill this block: relaxing `isSyntheticGramsTier` to a
 * `startsWith('fs_serving_macros_only')` prefix test. That is the tempting
 * simplification and it is WRONG, because the honest half of the split shares the
 * prefix: `fs_serving_macros_only` recovers a real weight by inverting the record's
 * own panel, `fs_serving_macros_only_est` fabricates one at a flat 2.0 kcal/g. A
 * prefix rule would flag both and suppress portion controls on 395 of 1,172 events
 * that have nothing wrong with them (measured 2026-08-14).
 */
describe('isSyntheticGramsTier — placeholder grams vs a real weight', () => {
    it('flags the fabricated leg of the macro-only branch', () => {
        expect(isSyntheticGramsTier('fs_serving_macros_only_est')).toBe(true);
    });

    it('does NOT flag its panel-inverting sibling, which differs by one suffix', () => {
        // The whole reason the tier was split. `gramsFromPer100gPanel()` is
        // arithmetic on the record's own numbers, not an estimate.
        expect(isSyntheticGramsTier('fs_serving_macros_only')).toBe(false);
    });

    it('does not flag the other fatsecret serving tiers, whose grams are declared', () => {
        for (const tier of ['fs_default_serving', 'fs_per100g_fallback', 'label_serving_default']) {
            expect(isSyntheticGramsTier(tier)).toBe(false);
        }
    });

    it('treats an absent tier as honest, matching both sibling predicates', () => {
        expect(isSyntheticGramsTier(null)).toBe(false);
        expect(isSyntheticGramsTier(undefined)).toBe(false);
        expect(isSyntheticGramsTier('')).toBe(false);
    });

    it('is a DIFFERENT question from the other two — no member is shared', () => {
        // Spend and replay-attribution both answer "did/could a model run". This one
        // answers "is the number real". A synthetic weight here comes from
        // arithmetic on a constant, so it replays deterministically and bills nothing.
        for (const tier of SYNTHETIC_GRAMS_SERVING_TIERS) {
            expect(servingAiCallForTier(tier).called).toBe(false);
            expect(isReplayNondeterministicTier(tier)).toBe(false);
        }
    });

    it('rejects mutation for real, not just to Object.isFrozen', () => {
        expect(() => {
            (SYNTHETIC_GRAMS_SERVING_TIERS as unknown as string[]).push('nope');
        }).toThrow();
        expect(SYNTHETIC_GRAMS_SERVING_TIERS).not.toContain('nope');
    });
});

/**
 * BORROWED-OR-DEFAULTED — the fourth predicate.
 *
 * The mutation this whole block exists to kill: "simplify" the membership into a
 * name rule. Every plausible one is wrong on live tiers, and each is pinned below.
 *   - /sibling/       misses all six DEFAULTED members and takes nothing extra.
 *   - /default/       takes `label_serving_default` (the record's OWN label) and
 *                     `fs_default_serving` (the record's OWN declared serving),
 *                     and misses every borrow.
 *   - /^bare_/        splits the borrows from the own-label tiers at random:
 *                     `bare_label_serving` and `bare_plural_serving` read THIS
 *                     record, `bare_sibling_serving` reads another one.
 *   - "not from this record" (aim A) sweeps in `count_unresolved_floor`, which is
 *     the honest "we do not know" floor and was the stated reason aim A was
 *     rejected.
 *
 * Sizing and the full per-tier classification table are owned by
 * sync-docs/reports/2026-08-17_the-b-tier-set-enumerated.md (mobile repo); this
 * file pins MEMBERSHIP only, so a corpus that grows cannot red it.
 */
describe('isBorrowedOrDefaultedTier — weights that are not this food\'s', () => {
    // MUTATION: drop any one of these. Each is a DIFFERENT product's label or
    // package, read by a named borrow function in serving/hydration-lane.ts.
    it('flags the six BORROWED tiers, all three borrow functions', () => {
        // borrowSiblingLabelServing() — same-brand median label serving.
        expect(isBorrowedOrDefaultedTier('bare_sibling_serving')).toBe(true);
        // borrowSiblingPackageGrams() — same-brand median packageQuantity, two
        // call sites and therefore two tier strings.
        expect(isBorrowedOrDefaultedTier('package_count_sibling')).toBe(true);
        expect(isBorrowedOrDefaultedTier('package_quantity_sibling')).toBe(true);
        // borrowNameSiblingLabelServing() — same-NAME median, one rung, three tiers.
        expect(isBorrowedOrDefaultedTier('bare_name_sibling_serving')).toBe(true);
        expect(isBorrowedOrDefaultedTier('bare_name_sibling_serving_tight')).toBe(true);
        expect(isBorrowedOrDefaultedTier('bare_name_sibling_serving_plural')).toBe(true);
    });

    // MUTATION: drop any one of these. Each reads a table that knows nothing
    // about the matched record.
    it('flags the ten DEFAULTED tiers, from four generic tables', () => {
        // getDefaultCountServing() / getSubPieceDefault() — the count seed table.
        expect(isBorrowedOrDefaultedTier('seed_count_default')).toBe(true);
        expect(isBorrowedOrDefaultedTier('fdc_sub_piece_default')).toBe(true);
        // getBareQueryDefault() — the bare-query category lexicon, two call sites.
        expect(isBorrowedOrDefaultedTier('bare_category_default')).toBe(true);
        expect(isBorrowedOrDefaultedTier('bare_query_default')).toBe(true);
        // discretePieceFloor() — DISCRETE_PIECE_FLOOR_GRAMS.
        expect(isBorrowedOrDefaultedTier('bare_discrete_floor')).toBe(true);
        // resolveVolumeGrams() / volumeToGrams() — the density lexicon, two lanes.
        expect(isBorrowedOrDefaultedTier('volume_unit')).toBe(true);
        expect(isBorrowedOrDefaultedTier('fs_volume_density')).toBe(true);
        // Hardcoded per-unit constants.
        expect(isBorrowedOrDefaultedTier('fdc_unit_heuristic')).toBe(true);
        expect(isBorrowedOrDefaultedTier('bare_dose_count_reconciled')).toBe(true);
        expect(isBorrowedOrDefaultedTier('fs_serving_macros_only_est')).toBe(true);
    });

    // MUTATION: change the array length without deciding about the new member.
    // Sixteen is not a magic number — it is the count that the classification
    // table in the owner report justifies row by row.
    it('has exactly sixteen members and no duplicates', () => {
        expect(BORROWED_OR_DEFAULTED_SERVING_TIERS.length).toBe(16);
        expect(new Set(BORROWED_OR_DEFAULTED_SERVING_TIERS).size).toBe(16);
    });
});

describe('isBorrowedOrDefaultedTier — the pinned NON-members', () => {
    /**
     * MUTATION: add any of these. Each was read and rejected, and each is a
     * name-neighbour of a member, which is why they are pinned rather than merely
     * absent.
     */
    it('does not flag the honest floors — the reason aim A was rejected', () => {
        // `count_unresolved_floor` bills a flat 100 g on 3,280 of its own 3,280
        // events (measured 2026-08-17). It is not a claim about a different
        // product or a table lookup; it is the absence of an answer, and the
        // bare-query guard's own REPLACE_TIERS groups it with flat_100g_default
        // for exactly that reason.
        expect(isBorrowedOrDefaultedTier('count_unresolved_floor')).toBe(false);
        // Same class. `grams = 100 * qty`, so only 11 of its 27 events are
        // literally 100 g — the tier is the placeholder, not the number.
        expect(isBorrowedOrDefaultedTier('flat_100g_default')).toBe(false);
        // The FatSecret twin: `grams = 100 * qty` when no serving is usable.
        expect(isBorrowedOrDefaultedTier('fs_per100g_fallback')).toBe(false);
    });

    it('does not flag the tiers that read THIS record\'s own label', () => {
        for (const tier of [
            'bare_label_serving',          // usableBareLabelServing(hydrated.servingGrams)
            'label_serving_default',       // qty * hydrated.servingGrams
            'label_serving_package_unit',  // same field, package-like unit
            'label_unit_match',            // hydrated.servingGrams / servingUnitCount
            'label_count_derived',         // the same, divided by the label's own count
            'bare_plural_serving',         // hydrated.servingGrams, plural band
            'fs_default_serving',          // this record's declared defaultServingId
            'fs_label_count',              // this record's serving, label-enumerated
            'fs_label_volume',             // this record's volumeMl-bearing serving
            'fs_label_volume_declared',    // this record's declared cup/tbsp row
            'fdc_label_volume',            // findOwnFdcVolumeServing(), genuine leg
            'fs_serving_macros_only',      // gramsFromPer100gPanel(), own panel
            'package_count_own',           // this SKU's own packageQuantity
            'package_quantity_own',        // the same, package-like-unit branch
        ]) {
            expect(isBorrowedOrDefaultedTier(tier)).toBe(false);
        }
    });

    it('does not flag the tiers where the USER stated the weight', () => {
        // Nothing is borrowed or defaulted when the line says "150 g" — the
        // conversion table is unit arithmetic, not a claim about the food. This is
        // the fork that makes `volume_unit` a member and `weight_unit` not: a
        // volume needs a DENSITY this record does not publish.
        expect(isBorrowedOrDefaultedTier('weight_unit')).toBe(false);
        expect(isBorrowedOrDefaultedTier('fs_weight_direct')).toBe(false);
    });

    it('does not flag the two cached tiers, whose provenance the NAME cannot see', () => {
        // `count_unit_cached` is a `findExistingServing()` hit on a row keyed
        // (foodId, bare unit) — written either by an AI estimate for THIS food or
        // by borrowSiblingServing() from another. Of the OFF rows reachable that
        // way, 223 are source='ai' and 37 source='sibling_borrow' (measured
        // 2026-08-17), and 7,236 of the tier's 7,242 events are on off_ records.
        // So it is ~14% genuinely borrowed and a tier-keyed predicate cannot say
        // which — the same shape as `discrete_unit_backfill`'s note above, and the
        // same fix: a provenance field at the producer, not a longer list.
        expect(isBorrowedOrDefaultedTier('count_unit_cached')).toBe(false);
        // `fdc_volume_cached` is findOwnFdcVolumeServing()'s `genuine: false` leg —
        // a persisted isAiEstimated FdcServing row for THIS fdcId. Not another
        // product and not a generic table, so it is out by definition, even though
        // an independent audit lists it as a mis-filed HONEST tier. It wants a
        // fifth predicate ("persisted estimate"), not membership here.
        expect(isBorrowedOrDefaultedTier('fdc_volume_cached')).toBe(false);
    });

    it('treats an absent tier as own-record, matching all three sibling predicates', () => {
        // Deliberate, not inherited — 805 null-tier events are two populations
        // (the zero-calorie fast path, and the legacy unstamped cascade) and only
        // one of them is defaulted. See the predicate's own docstring.
        expect(isBorrowedOrDefaultedTier(null)).toBe(false);
        expect(isBorrowedOrDefaultedTier(undefined)).toBe(false);
        expect(isBorrowedOrDefaultedTier('')).toBe(false);
    });

    it('rejects mutation for real, not just to Object.isFrozen', () => {
        const before = BORROWED_OR_DEFAULTED_SERVING_TIERS.length;
        expect(() => (BORROWED_OR_DEFAULTED_SERVING_TIERS as string[]).push('x')).toThrow(TypeError);
        expect(BORROWED_OR_DEFAULTED_SERVING_TIERS.length).toBe(before);
    });
});

/**
 * THE RELATIONSHIPS BETWEEN THE FOUR SETS.
 *
 * Pinned so a future edit cannot slide a tier from one list into another and
 * quietly change what a consumer of the OTHER list sees. Two of these are
 * strict subset/disjointness claims and one is an overlap that is on purpose.
 */
describe('the four predicates: what must stay disjoint and what must overlap', () => {
    // MUTATION: add any REPLAY_NONDETERMINISTIC member to the borrowed list, or
    // vice versa. `count_unit_ai` is the tempting one — it can resolve from the
    // seed table OR from a sibling borrow OR from a live model, and it is in N
    // precisely because the name collapses all three. Putting it in both sets
    // would make the two counts non-additive and break the union arithmetic the
    // aim comparison rests on.
    it('is DISJOINT from replay-nondeterminism — no tier is in both', () => {
        for (const tier of BORROWED_OR_DEFAULTED_SERVING_TIERS) {
            expect(isReplayNondeterministicTier(tier)).toBe(false);
        }
        for (const tier of REPLAY_NONDETERMINISTIC_SERVING_TIERS) {
            expect(isBorrowedOrDefaultedTier(tier)).toBe(false);
        }
    });

    // Follows from the above (SERVING_AI_TIERS ⊆ N is asserted higher up), and is
    // stated separately because it is the claim a reader actually wants: nothing
    // in this set bills a model.
    it('bills nothing — no member is in the spend allowlist', () => {
        for (const tier of BORROWED_OR_DEFAULTED_SERVING_TIERS) {
            expect(servingAiCallForTier(tier).called).toBe(false);
        }
    });

    // MUTATION: remove FS_SERVING_MACROS_ONLY_EST_TIER from the borrowed list.
    // The overlap is deliberate: `/api/nlp/parse` derives `portionEstimated` from
    // isSyntheticGramsTier() today, so any wider predicate that does NOT contain
    // this tier would silently unflag the population #314 shipped the flag for.
    it('CONTAINS the synthetic-grams set — a widening must not unflag it', () => {
        for (const tier of SYNTHETIC_GRAMS_SERVING_TIERS) {
            expect(isBorrowedOrDefaultedTier(tier)).toBe(true);
        }
        // …but not the reverse: this set is strictly larger.
        expect(BORROWED_OR_DEFAULTED_SERVING_TIERS.length)
            .toBeGreaterThan(SYNTHETIC_GRAMS_SERVING_TIERS.length);
        // …and the synthetic set's honest sibling stays out of BOTH.
        expect(isSyntheticGramsTier('fs_serving_macros_only')).toBe(false);
        expect(isBorrowedOrDefaultedTier('fs_serving_macros_only')).toBe(false);
    });
});
