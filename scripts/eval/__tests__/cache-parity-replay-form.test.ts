/**
 * cache-parity-sweep replay-form selection.
 *
 * NO NETWORK, NO DATABASE. `cache-parity-sweep.ts` guards `main()` with
 * `require.main === module`, so importing it runs no POSTs — which matters more
 * here than usual, because every POST that script makes is a WRITE
 * (saveValidatedMapping is not gated by skipCache, so a cold replay OVERWRITES
 * the cache row it replays).
 *
 * The one import-time side effect left is `normalization-rules` -> `../db`,
 * which constructs a PrismaClient. It is mocked below so this suite passes with
 * no DATABASE_URL in the environment.
 *
 * WHAT THIS PINS
 *
 * The rule being replaced was:
 *     if (form.trim() === canonicalizeCacheKey(form)) continue;   // skip canonical order
 * "canonical order" was used as a proxy for "this is the sweep replaying its own
 * stored key". The proxy is wrong in one direction and right in the other:
 *
 *   - WRONG: a singular, single-word or alphabetically-ordered USER query is its
 *     own canonical key, so the rule discarded it no matter how dominant it was.
 *     `chicken thigh` (136 events) lost to `chicken thighs` (2).
 *   - RIGHT: the sweep really does log canonical-order forms. It posts
 *     `100g <name>`; the route writes a MappingEventLog row with
 *     noCache=true, and when <name> was the stored key the logged
 *     normalizedForm IS the token-sorted key. Those rows then look like
 *     observed query forms on the next run.
 *
 * So "pick the max-event form" ALONE would reintroduce the second hazard. The
 * `selfReplayCanOutvoteUserQuery` and `sweepArtifactDoesNotWinOnCount` tests
 * below are the ones that keep that honest; they are built from real
 * MappingEventLog rows where every event is noCache=true.
 *
 * All counts in the fixtures were measured on the live box on 2026-07-26:
 *   select "noCache", "normalizedForm", count(*) from "MappingEventLog"
 *   where "normalizedForm" is not null group by 1,2;
 */

jest.mock('@/lib/db', () => ({ prisma: {} }));

import {
    buildReplayIndex,
    selectReplayForm,
    type ObservedRow,
} from '../cache-parity-sweep';
import { canonicalizeCacheKey } from '../../../src/lib/mapping/normalization-rules';

/**
 * The predicate this change replaces, transcribed from
 * cache-parity-sweep.ts@e227f36 lines 92-103. Kept here as a fixture so the
 * behavioural difference is asserted rather than asserted-about — `git checkout`
 * is not available to diff against (it would destroy parallel work in this
 * tree), and a comment claiming "this would have failed before" is not evidence.
 */
function legacySelectReplayForm(storedKey: string, rows: ObservedRow[]): string {
    const observedByKey = new Map<string, { form: string; events: number }>();
    for (const r of rows) {
        if (!r.normalizedForm) continue;
        if (r.normalizedForm.trim() === canonicalizeCacheKey(r.normalizedForm)) continue;
        const key = canonicalizeCacheKey(r.normalizedForm);
        const cur = observedByKey.get(key);
        if (!cur || r.events > cur.events) observedByKey.set(key, { form: r.normalizedForm, events: r.events });
    }
    return observedByKey.get(storedKey)?.form ?? storedKey;
}

/** A max-total-events rule with no self-replay exclusion — the naive fix. */
function naiveMaxEventsForm(storedKey: string, rows: ObservedRow[]): string {
    let best: ObservedRow | null = null;
    for (const r of rows) {
        if (!r.normalizedForm) continue;
        if (canonicalizeCacheKey(r.normalizedForm) !== storedKey) continue;
        if (!best || r.events > best.events || (r.events === best.events && r.normalizedForm < best.normalizedForm)) best = r;
    }
    return best?.normalizedForm ?? storedKey;
}

function pick(storedKey: string, rows: ObservedRow[]) {
    return selectReplayForm(storedKey, buildReplayIndex(rows));
}

// ---------------------------------------------------------------------------
// Real fixtures. `events` is ALL rows; `coldEvents` is the noCache=true subset.
// ---------------------------------------------------------------------------

/** key `chicken thigh`: dominant spelling is the SINGULAR, which the old rule threw away. */
const CHICKEN_THIGH: ObservedRow[] = [
    { normalizedForm: 'chicken thigh', events: 136, coldEvents: 2 },
    { normalizedForm: 'chicken thighs', events: 2, coldEvents: 0 },
];

/** key `egg`: dominant spelling is the PLURAL. The fix must NOT change this one. */
const EGG: ObservedRow[] = [
    { normalizedForm: 'egg', events: 517, coldEvents: 4 },
    { normalizedForm: 'eggs', events: 959, coldEvents: 0 },
];

/** key `onion`: the mirror image of `egg` — 124 singular vs 1 plural. */
const ONION: ObservedRow[] = [
    { normalizedForm: 'onion', events: 124, coldEvents: 1 },
    { normalizedForm: 'onions', events: 1, coldEvents: 0 },
];

/**
 * key `dressing goddess green`: one sweep artifact and one real user query, TIED
 * at one event each. Ranking by total events (and breaking the tie on spelling)
 * elects the artifact; ranking by user events elects the human.
 */
const GREEN_GODDESS: ObservedRow[] = [
    { normalizedForm: 'goddess green dressing', events: 1, coldEvents: 1 },
    { normalizedForm: 'green goddess dressing', events: 1, coldEvents: 0 },
];

/**
 * key `chips chocolate`: NO user events at all. Both spellings are cold. The
 * stored-key spelling has MORE events than the natural one — this is precisely
 * the self-feeding the old comment described, and it is where the old rule was
 * right.
 */
const CHOCOLATE_CHIPS: ObservedRow[] = [
    { normalizedForm: 'chips chocolate', events: 2, coldEvents: 2 },
    { normalizedForm: 'chocolate chips', events: 1, coldEvents: 1 },
];

/** key `bell pepper`: cold-only, and the only spelling IS the stored key. */
const BELL_PEPPER: ObservedRow[] = [
    { normalizedForm: 'bell pepper', events: 1, coldEvents: 1 },
];

describe('canonicalizeCacheKey assumptions the fixtures rest on', () => {
    it('collapses singular and plural onto one key, and sorts tokens', () => {
        expect(canonicalizeCacheKey('chicken thigh')).toBe('chicken thigh');
        expect(canonicalizeCacheKey('chicken thighs')).toBe('chicken thigh');
        expect(canonicalizeCacheKey('egg')).toBe('egg');
        expect(canonicalizeCacheKey('eggs')).toBe('egg');
        expect(canonicalizeCacheKey('green goddess dressing')).toBe('dressing goddess green');
        expect(canonicalizeCacheKey('chocolate chips')).toBe('chips chocolate');
    });

    it('is why the old predicate discarded singulars: a singular equals its own key', () => {
        for (const form of ['chicken thigh', 'onion', 'egg', 'bell pepper']) {
            expect(form.trim()).toBe(canonicalizeCacheKey(form));
        }
    });
});

describe('selectReplayForm — dominant user spelling wins', () => {
    it('replays the dominant SINGULAR (chicken thigh 136 vs chicken thighs 2)', () => {
        const choice = pick('chicken thigh', CHICKEN_THIGH);
        expect(choice.form).toBe('chicken thigh');
        expect(choice.source).toBe('dominant_observed');
        expect(choice.userEvents).toBe(134); // 136 total - 2 of this script's own replays
    });

    it('the OLD rule replayed the 2-event plural instead (this test fails against it)', () => {
        expect(legacySelectReplayForm('chicken thigh', CHICKEN_THIGH)).toBe('chicken thighs');
        expect(pick('chicken thigh', CHICKEN_THIGH).form).not.toBe(
            legacySelectReplayForm('chicken thigh', CHICKEN_THIGH),
        );
    });

    it('replays the dominant PLURAL (eggs 959 vs egg 517) — unchanged by this fix', () => {
        const choice = pick('egg', EGG);
        expect(choice.form).toBe('eggs');
        expect(choice.source).toBe('dominant_observed');
        // Honest pin: the old rule reached the same answer here, for the wrong
        // reason (it discarded `egg` as canonical-order rather than as a minority
        // spelling). `eggs` genuinely is the dominant form, 959 to 513.
        expect(legacySelectReplayForm('egg', EGG)).toBe('eggs');
    });

    it('replays the dominant singular for `onion` (124 vs 1)', () => {
        expect(pick('onion', ONION).form).toBe('onion');
        expect(legacySelectReplayForm('onion', ONION)).toBe('onions');
    });
});

describe('selectReplayForm — a self-replay must not outvote a user query', () => {
    it('selfReplayCanOutvoteUserQuery: user events beat a tied sweep artifact', () => {
        const choice = pick('dressing goddess green', GREEN_GODDESS);
        expect(choice.form).toBe('green goddess dressing');
        expect(choice.userEvents).toBe(1);
        // The naive "most events wins" rule picks the artifact on the spelling
        // tie-break. This is the regression the fix must not ship.
        expect(naiveMaxEventsForm('dressing goddess green', GREEN_GODDESS)).toBe('goddess green dressing');
    });

    it('a sweep artifact with strictly MORE events still loses to a real user query', () => {
        const rows: ObservedRow[] = [
            // as if this sweep had run five times against the stored key
            { normalizedForm: 'breast chicken skinless', events: 5, coldEvents: 5 },
            { normalizedForm: 'skinless chicken breast', events: 2, coldEvents: 0 },
        ];
        expect(pick('breast chicken skinless', rows).form).toBe('skinless chicken breast');
        expect(naiveMaxEventsForm('breast chicken skinless', rows)).toBe('breast chicken skinless');
    });

    it('a user-event TIE is not broken by the sweep\'s own replay volume', () => {
        // Found in review. The first draft of this fix ranked
        // [-userEvents, -totalEvents, ...]. Tier 1 correctly ignored cold events;
        // tier 2 did not — so on a 1-1 user tie the spelling with 50 of this
        // script's own replays won, and the sweep re-elected its own artifact.
        // That is the self-feeding loop the whole function exists to prevent,
        // arriving one tier lower down than where it was being guarded.
        //
        // Both spellings below have exactly ONE user event. The stored-key
        // spelling additionally carries 50 sweep replays. It must still lose.
        const rows: ObservedRow[] = [
            { normalizedForm: 'chips chocolate', events: 51, coldEvents: 50 },
            { normalizedForm: 'chocolate chips', events: 1, coldEvents: 0 },
        ];
        const choice = pick('chips chocolate', rows);
        expect(choice.userEvents).toBe(1);
        expect(choice.form).toBe('chocolate chips');
        // Non-vacuity: the rejected spelling really does have more total events,
        // so a total-event tie-break would genuinely have chosen it.
        expect(choice.dominantForm).toBe('chips chocolate');
        expect(choice.dominantTotalEvents).toBe(51);
        expect(naiveMaxEventsForm('chips chocolate', rows)).toBe('chips chocolate');
    });

    it('sweepArtifactDoesNotWinOnCount: cold-only key drops the stored-key spelling', () => {
        const choice = pick('chips chocolate', CHOCOLATE_CHIPS);
        expect(choice.form).toBe('chocolate chips');
        expect(choice.source).toBe('cold_only_observed');
        expect(choice.userEvents).toBe(0);
        // reported honestly: the most-logged spelling was rejected
        expect(choice.dominantForm).toBe('chips chocolate');
        expect(choice.dominantTotalEvents).toBe(2);
        // naive max-events would have re-elected the artifact
        expect(naiveMaxEventsForm('chips chocolate', CHOCOLATE_CHIPS)).toBe('chips chocolate');
    });
});

describe('selectReplayForm — stored-key fallbacks', () => {
    it('falls back to the stored key when NO form was ever observed', () => {
        const choice = pick('barbecue kraft original sauce', CHICKEN_THIGH);
        expect(choice.form).toBe('barbecue kraft original sauce');
        expect(choice.source).toBe('stored_key_no_observation');
        expect(choice.dominantForm).toBeNull();
    });

    it('falls back to the stored key when the only spelling logged was its own replay', () => {
        const choice = pick('bell pepper', BELL_PEPPER);
        expect(choice.form).toBe('bell pepper');
        expect(choice.source).toBe('stored_key_self_replay_only');
        // Same string either way, so nothing is lost by refusing it.
        expect(legacySelectReplayForm('bell pepper', BELL_PEPPER)).toBe('bell pepper');
    });

    it('an empty observed file replays every key as its stored key', () => {
        const index = buildReplayIndex([]);
        expect(index.byKey.size).toBe(0);
        expect(selectReplayForm('chicken thigh', index).source).toBe('stored_key_no_observation');
    });
});

describe('buildReplayIndex — bookkeeping the summary depends on', () => {
    it('reports whether the export could distinguish user events from sweep replays', () => {
        expect(buildReplayIndex(CHICKEN_THIGH).hasColdBreakdown).toBe(true);
        const legacyShape: ObservedRow[] = [
            { normalizedForm: 'chicken thigh', events: 136 },
            { normalizedForm: 'chicken thighs', events: 2 },
        ];
        expect(buildReplayIndex(legacyShape).hasColdBreakdown).toBe(false);
        // Degrades to max-total-events rather than crashing; still beats the old
        // rule on this key, but cannot exclude self-replays — hence the warning.
        expect(selectReplayForm('chicken thigh', buildReplayIndex(legacyShape)).form).toBe('chicken thigh');
    });

    it('counts excluded cold events and folds duplicate rows for one spelling', () => {
        const index = buildReplayIndex([
            { normalizedForm: 'onion', events: 123, coldEvents: 0 },
            { normalizedForm: 'onion', events: 1, coldEvents: 1 },
            { normalizedForm: 'onions', events: 1, coldEvents: 0 },
        ]);
        expect(index.coldEventsSeen).toBe(1);
        expect(index.distinctForms).toBe(2);
        const choice = selectReplayForm('onion', index);
        expect(choice.form).toBe('onion');
        expect(choice.totalEvents).toBe(124);
        expect(choice.userEvents).toBe(123);
    });

    it('ignores blank and malformed rows instead of minting an empty replay form', () => {
        const index = buildReplayIndex([
            { normalizedForm: '   ', events: 99, coldEvents: 0 },
            { normalizedForm: 'onion', events: 5, coldEvents: 0 },
        ]);
        expect(index.distinctForms).toBe(1);
        expect(selectReplayForm('onion', index).form).toBe('onion');
    });

    it('is deterministic under input reordering', () => {
        const rows = [...GREEN_GODDESS, ...CHICKEN_THIGH, ...EGG];
        const a = selectReplayForm('dressing goddess green', buildReplayIndex(rows));
        const b = selectReplayForm('dressing goddess green', buildReplayIndex([...rows].reverse()));
        expect(a.form).toBe(b.form);
    });

    it('breaks a genuine user-event tie deterministically, not by insertion order', () => {
        const rows: ObservedRow[] = [
            { normalizedForm: 'zebra cake little', events: 3, coldEvents: 0 },
            { normalizedForm: 'little zebra cake', events: 3, coldEvents: 0 },
        ];
        const key = canonicalizeCacheKey('little zebra cake');
        expect(selectReplayForm(key, buildReplayIndex(rows)).form).toBe('little zebra cake');
        expect(selectReplayForm(key, buildReplayIndex([...rows].reverse())).form).toBe('little zebra cake');
    });

    it('prefers the lowercase spelling on a tie, so stray capitalisation is not elected', () => {
        // Real pair: key `roll spring` had "spring roll" and "Spring Rolls",
        // one user event each. Plain lexicographic order puts "S" before "s".
        const rows: ObservedRow[] = [
            { normalizedForm: 'Spring Rolls', events: 1, coldEvents: 0 },
            { normalizedForm: 'spring roll', events: 1, coldEvents: 0 },
        ];
        const choice = selectReplayForm('roll spring', buildReplayIndex(rows));
        expect(choice.form).toBe('spring roll');
        // and the reporting agrees, so a pure tie is not miscounted as "minority"
        expect(choice.source).toBe('dominant_observed');
        expect(choice.dominantForm).toBe('spring roll');
    });

    it('reports whether the most-logged spelling had any user events behind it', () => {
        const cold = selectReplayForm('dressing goddess green', buildReplayIndex(GREEN_GODDESS));
        expect(cold.dominantForm).toBe('goddess green dressing');
        expect(cold.dominantUserEvents).toBe(0); // -> counted as dominantWasSelfReplay
        const healthy = selectReplayForm('chicken thigh', buildReplayIndex(CHICKEN_THIGH));
        expect(healthy.dominantForm).toBe('chicken thigh');
        expect(healthy.dominantUserEvents).toBe(134);
    });
});
