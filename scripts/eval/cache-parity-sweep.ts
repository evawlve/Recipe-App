/**
 * cache-parity-sweep.ts — replay every cached FoodMapping key through the full
 * pipeline cold (nocache=1) and diff what fresh retrieval resolves vs what the
 * cache row held. Divergences = cache rows that disagree with the current
 * pipeline (stale ranking-era picks, pre-dedupe records, plausibility misses).
 *
 * NOTE (intended side effect): the pipeline's saveValidatedMapping is NOT
 * gated by skipCache, so each cold run OVERWRITES its cache row with the
 * fresh result. Snapshot the table first (pg_dump -t '"FoodMapping"').
 *
 * Run (from repo root):
 *   npx ts-node --transpile-only --compilerOptions '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/eval/cache-parity-sweep.ts --before scripts/eval/results/foodmapping-before-2026-07-20.json \
 *     --observed scripts/eval/results/observed-forms-<date>.json \
 *     [--base http://192.168.1.133:3000] [--concurrency 4]
 *
 * The --before file is a JSON array of FoodMapping rows:
 *   select json_agg(row_to_json(t)) from (select "normalizedForm","foodName",
 *   "brandName",source,"offBarcode","fdcId","fsId","aiConfidence","usedCount"
 *   from "FoodMapping" order by "normalizedForm") t;
 *
 * "fsId" is REQUIRED — omitting it makes every fatsecret-sourced row (441 of
 * 3,246 as of 2026-07-26) report as a changed record, because the incumbent's
 * id cannot be reconstructed. The script counts such rows as
 * `unresolvableBefore` and warns rather than scoring them as changes.
 *
 * The --observed file recovers the word order the stored key destroyed; build it
 * with the query in the `ObservedRow` docblock below. It MUST carry the
 * `coldEvents` column, or this script cannot tell a user query from its own
 * previous replay (see `buildReplayIndex`).
 *
 * Writes results/cache-parity-<timestamp>.json (full) and prints a summary +
 * the changed-record list to stdout.
 */

import * as fs from 'fs';
import * as path from 'path';
import { canonicalizeCacheKey } from '../../src/lib/mapping/normalization-rules';

const args = process.argv.slice(2);
function argValue(flag: string): string | undefined {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
}

const BASE = argValue('--base') ?? process.env.EVAL_API_BASE ?? 'http://192.168.1.133:3000';
const API_KEY = process.env.EVAL_API_KEY ?? 'adminAPI_dev_key_bypass';
const CONCURRENCY = Number(argValue('--concurrency') ?? 4);
const TIMEOUT_MS = Number(argValue('--timeout') ?? 30000);

interface BeforeRow {
    normalizedForm: string;
    foodName: string;
    brandName: string | null;
    source: string;
    offBarcode: string | null;
    fdcId: number | null;
    /**
     * Optional so a --before file captured before the FatSecret lane shipped
     * still parses. Absent means "this row's identity cannot be expressed", and
     * the diff counts it as unresolvable rather than as a change — see beforeId.
     */
    fsId?: string | null;
    aiConfidence: number;
    usedCount: number;
}

/**
 * Replay the OBSERVED query form, not the stored key.
 *
 * `FoodMapping.normalizedForm` is `canonicalizeCacheKey` output: token-sorted
 * alphabetically. Feeding it back in as the query text is not a replay — it is
 * a different query that merely happens to share a cache row, because
 * `deriveMustHaveTokens` reads the first two core tokens in SOURCE ORDER and
 * the sort has destroyed that order.
 *
 * Measured 2026-07-26 over 39,414 MappingEventLog rows: for **1,103 of 2,443
 * keys (45.15%)** the sorted key computes a DIFFERENT required-token set than
 * the user word order that owns the row — and since saveValidatedMapping is not
 * gated by skipCache, the sweep then overwrites the row with whatever that
 * different admission produced. Examples:
 *
 *   skinless chicken breast  users [skinless,chicken]  sweep [breast,chicken]
 *   mission tortilla chips   users [mission,tortilla]  sweep [chips,mission]
 *   premier protein caramel  users [premier,protein]   sweep [caramel,premier]
 *
 * This is a concrete mechanism for the "cache-parity-sweep clobbers a few good
 * OFF picks" behaviour on record from the 2026-07-24 fs-refresh wave (saltine
 * sleeve, m&ms). Pass --observed to replay the real query form instead.
 *
 * Build the file with (the `coldEvents` column is REQUIRED — see
 * `selectReplayForm` for why a file without it degrades):
 *
 *   select json_agg(row_to_json(t)) from (
 *     select "normalizedForm",
 *            count(*)::int as events,
 *            count(*) filter (where "noCache")::int as "coldEvents"
 *     from "MappingEventLog" where "normalizedForm" is not null
 *     group by 1 order by 2 desc) t;
 */
export interface ObservedRow {
    normalizedForm: string;
    /** ALL MappingEventLog rows that logged this exact normalizedForm. */
    events: number;
    /**
     * Of `events`, how many were logged with `MappingEventLog.noCache = true`.
     * Optional only for backward compatibility with pre-2026-07-26 export files;
     * omitting it disables self-replay exclusion (loudly warned about at runtime).
     */
    coldEvents?: number;
}

/** One observed spelling of a query, with its event split. */
export interface FormTally {
    form: string;
    /** all logged events for this exact spelling */
    totalEvents: number;
    /** events logged with noCache=true — i.e. THIS script's own prior replays */
    coldEvents: number;
    /** totalEvents - coldEvents: events a human (or a warm batch) actually produced */
    userEvents: number;
    /**
     * This spelling is the token-sorted key AND the key has more than one token,
     * so replaying it recovers no word order and it cannot be told apart from
     * this script's own artifact.
     *
     * The multi-token condition is load-bearing, not a refinement. Measured: a
     * version without it moved 8 real keys the wrong way — `apricot`→`apricots`,
     * `tomato`→`tomatoes`, `cheese`→`Cheese` — because for a ONE-token key the
     * sorted form IS the natural spelling and there is no order to recover, so
     * the signal fires on every singular noun and elects the plural. That is the
     * original defect's harm re-created through a narrower door.
     *
     * Used ONLY as a tie-break (see rankKey), never as a filter.
     */
    carriesNoWordOrder: boolean;
}

export type ReplaySource =
    /** the form with the most user events, and also the overall most-logged form */
    | 'dominant_observed'
    /** a form with user events that is NOT the overall most-logged form */
    | 'minority_observed'
    /**
     * no user events for this key at all: every logged spelling came from a cold
     * (nocache) run, i.e. from this script. The stored-key spelling is dropped as
     * a self-replay and the remaining spelling — which at least carries word
     * order the sorted key destroyed — is used.
     */
    | 'cold_only_observed'
    /** nothing was ever logged for this key */
    | 'stored_key_no_observation'
    /** the only thing ever logged for this key was this script replaying the stored key */
    | 'stored_key_self_replay_only';

export interface ReplayChoice {
    /** the text actually sent to /api/nlp/parse */
    form: string;
    source: ReplaySource;
    userEvents: number;
    totalEvents: number;
    /** most-logged spelling for this key, eligible or not (for reporting only) */
    dominantForm: string | null;
    dominantTotalEvents: number;
    /** user events behind `dominantForm`; 0 means the most-logged spelling was a self-replay */
    dominantUserEvents: number;
}

export interface KeyObservation {
    key: string;
    forms: FormTally[];
    dominantForm: string;
    dominantTotalEvents: number;
    dominantUserEvents: number;
    /** the spelling this key will be replayed as, or null to fall back to the key */
    winner: FormTally | null;
    winnerSource: Extract<ReplaySource, 'dominant_observed' | 'minority_observed' | 'cold_only_observed'> | null;
}

export interface ReplayIndex {
    byKey: Map<string, KeyObservation>;
    /** false when NO input row carried `coldEvents` — self-replays cannot be excluded */
    hasColdBreakdown: boolean;
    inputRows: number;
    distinctForms: number;
    coldEventsSeen: number;
}

/**
 * Total order over the spellings of one key, most-preferred first:
 *   1. most USER events — the whole point of the selection;
 *   2. already lowercase — `Quinoa` and `quinoa` are the same query; preferring
 *      the lowercase spelling stops a stray capitalisation from being elected
 *      on a 1-1 tie and churning the replay text for no reason;
 *   3. carries word order — see below;
 *   4. the spelling itself, so the choice is reproducible.
 * A tuple order (rather than an ad-hoc comparator) keeps this transitive, which
 * a linear max-scan needs to be deterministic under input reordering.
 *
 * NO TOTAL-EVENT TERM, deliberately. An earlier draft broke user-event ties on
 * total events, which silently re-armed the exact hazard this whole function
 * exists to close: `chips chocolate` with 1 user event + 50 of THIS SCRIPT's own
 * replays beat `chocolate chips` with 1 user event, so the sweep elected its own
 * artifact and the loop fed itself. Cold events must carry zero weight at every
 * tier, not just the first.
 *
 * TIER 3 IS THE ORIGINAL DEFECT, DEMOTED TO ITS CORRECT WEIGHT. The rule this
 * function replaced was `if (form === canonicalizeCacheKey(form)) continue` — it
 * threw away every spelling that equals its own key, which is every singular
 * noun, costing 1,430 spellings carrying 16,502 user events. But the signal was
 * never wrong, only mis-weighted and mis-scoped: for a MULTI-TOKEN key, a
 * spelling identical to the sorted key recovers no word order and cannot be told
 * apart from this script's own replay. As a hard filter that is catastrophic; as
 * a narrow tie-break it is exactly right. Deleting the total-event term alone
 * did NOT close the hazard above — `chips chocolate` still won on the
 * lexicographic tier, because 'i' < 'o'. A tie decided by alphabetical accident
 * is not a decision. Tier 3 makes it one.
 *
 * Two guards keep tier 3 from re-creating the harm it descends from:
 *   - it reads only on an exact user-event tie, so `chicken thigh` (134 user
 *     events, and identical to its own key) still beats `chicken thighs` (2);
 *   - it is scoped to multi-token keys (see `carriesNoWordOrder`), so it cannot
 *     touch a singular noun, and it sits BELOW the lowercase tier so it cannot
 *     elect `Caesar Salad` over `caesar salad`.
 * Both were added after measuring 8 wrong-direction flips without them.
 */
function rankKey(f: FormTally): [number, number, number, string] {
    return [-f.userEvents, f.form === f.form.toLowerCase() ? 0 : 1, f.carriesNoWordOrder ? 1 : 0, f.form];
}
/**
 * Order for REPORTING the most-logged spelling, which does count this script's
 * own replays. Never used to choose what we POST — only to name the spelling a
 * run had to overrule, so `rejectedDominant[]` stays meaningful.
 */
function rankByTotalEvents(f: FormTally): [number, number, number, string] {
    return [-f.totalEvents, f.form === f.form.toLowerCase() ? 0 : 1, f.carriesNoWordOrder ? 1 : 0, f.form];
}
function beatsBy(rank: (f: FormTally) => Array<number | string>, a: FormTally, b: FormTally): boolean {
    const ra = rank(a), rb = rank(b);
    for (let i = 0; i < ra.length; i++) {
        if (ra[i] === rb[i]) continue;
        return ra[i] < rb[i];
    }
    return false;
}
const beats = (a: FormTally, b: FormTally) => beatsBy(rankKey, a, b);

/**
 * Group logged forms by cache key and pick, per key, the spelling a real user
 * most often typed.
 *
 * WHAT THE OLD RULE WAS PROTECTING AGAINST, AND WHY THIS IS NOT THE SAME RULE.
 *
 * The predicate this replaces was
 *     `if (form.trim() === canonicalizeCacheKey(form)) continue;`
 * with the comment "already in canonical order → almost all prior sweep replays
 * feeding on themselves". The *hazard* is real and I confirmed it on live data:
 * this script posts `100g <name>`, the route logs `telemetry.normalizedForm` for
 * that line, and `noCache` is true — so a stored-key replay writes a
 * MappingEventLog row whose normalizedForm IS the token-sorted key. Next run it
 * looks exactly like an observed query form. Live examples (2026-07-26,
 * MappingEventLog, all events noCache=true, zero user events):
 *
 *     key `chips chocolate`  → "chips chocolate" 2 vs "chocolate chips" 1
 *     key `juice orange`     → "juice orange"   2 vs "orange juice"    1
 *     key `preworkout ryse`  → "preworkout ryse" 1 vs "ryse preworkout" 1
 *
 * So "pick the form with the most events" ON ITS OWN **would** reintroduce it:
 * on those three keys the sweep's own artifact outvotes (or lexicographically
 * out-ties) the natural spelling. The old rule was therefore *right about the
 * hazard* — it was just applied to the wrong population. Canonical order is a
 * property of the STRING, not of who typed it: "chicken thigh", "onion", "bell
 * pepper" are all their own canonical key, and discarding them threw away
 * 16,502 genuine user events across 1,430 spellings, 839 of which carry user
 * events at all.
 *
 * CAUTION ON THE BLAST-RADIUS NUMBER. Measuring this defect as "rows where the
 * old pick differs from the most-LOGGED spelling" gives 355 of 3,246 — but 329
 * of those 355 are cases where the most-logged spelling has ZERO user events,
 * i.e. the yardstick is itself contaminated by the self-replays above. Ranked by
 * user events, only **31 of 3,246 keys actually change the text they replay**
 * (9 case-only, 18 singular/plural, 4 word-order), 15 of them by a strictly
 * larger user-event margin. The big ones are real: `quinoa` moves from "Quinoa"
 * (1 user event) to "quinoa" (381), `chicken` from "Chicken" (0) to "chicken"
 * (244), `chicken thigh` from "chicken thighs" (2) to "chicken thigh" (134),
 * `onion` from "onions" (1) to "onion" (123), `coffee` from "Coffee" (2) to
 * "coffee" (91).
 *
 * The discriminator that actually separates the two populations is
 * `MappingEventLog.noCache`. Verified: `?nocache=1` is only ever sent by THIS
 * script (`grep -rn "nocache" scripts/ src/` → cache-parity-sweep.ts is the only
 * client; warm-cache.ts documents itself as "the NORMAL cache-first path (no
 * nocache)"), the route only honours it under `isDevBypass` (parse/route.ts:178),
 * and the 1,576 noCache=true rows are dominated by the two parity sweeps on
 * record — 2026-07-20 (276) and 2026-07-24 (1,295) — with 5 strays (1 on
 * 2026-07-19, 4 on 2026-07-23) consistent with hand-run curls. The stray rows
 * do not weaken the discriminator: a hand-run nocache curl is no more a user
 * query than a sweep replay is. NOTE the corollary:
 * warm-cache.ts also posts `100g <seed>` but on the normal path, so its events
 * count as user events. That is deliberate — a warm seed is a natural-language
 * spelling, so it carries the word order the sorted key destroyed; only the
 * stored-key replay does not. So:
 *
 *   1. rank by USER events (noCache=false) — sweep replays get zero votes;
 *   2. if a key has no user events at all, drop any spelling identical to the
 *      stored key (that is definitionally the self-replay, and substituting it
 *      changes nothing anyway) and use the best of what is left;
 *   3. otherwise fall back to the stored key.
 *
 * Step 2 is the only part of the old rule worth keeping, now confined to the
 * 137 keys where it was actually correct.
 */
export function buildReplayIndex(
    rows: ObservedRow[],
    canonicalize: (s: string) => string = canonicalizeCacheKey,
): ReplayIndex {
    const tallies = new Map<string, FormTally>();
    let hasColdBreakdown = false;
    let coldEventsSeen = 0;
    let inputRows = 0;

    for (const r of rows) {
        if (!r || typeof r.normalizedForm !== 'string' || !r.normalizedForm.trim()) continue;
        inputRows++;
        const total = Number(r.events) || 0;
        let cold = 0;
        if (r.coldEvents != null) {
            hasColdBreakdown = true;
            cold = Math.min(Number(r.coldEvents) || 0, total);
        }
        coldEventsSeen += cold;
        const cur = tallies.get(r.normalizedForm)
            ?? {
                form: r.normalizedForm,
                totalEvents: 0,
                coldEvents: 0,
                userEvents: 0,
                // Computed through the injected canonicalize so the tests can
                // substitute a stub and still exercise this tier. Multi-token
                // only: a one-token key has no word order to lose.
                carriesNoWordOrder:
                    r.normalizedForm.trim() === canonicalize(r.normalizedForm)
                    && canonicalize(r.normalizedForm).includes(' '),
            };
        cur.totalEvents += total;
        cur.coldEvents += cold;
        cur.userEvents = cur.totalEvents - cur.coldEvents;
        tallies.set(r.normalizedForm, cur);
    }

    const byKey = new Map<string, KeyObservation>();
    for (const t of tallies.values()) {
        const key = canonicalize(t.form);
        const obs = byKey.get(key)
            ?? { key, forms: [], dominantForm: t.form, dominantTotalEvents: -1, dominantUserEvents: 0, winner: null, winnerSource: null };
        obs.forms.push(t);
        byKey.set(key, obs);
    }

    for (const obs of byKey.values()) {
        // Dominant = most-logged spelling overall, ignoring WHO logged it.
        // Reported even when it is not the one we replay, so a run that had to
        // reject it stays visible. Ranked by TOTAL events (the winner is ranked
        // by USER events) with the same lower-tier tie-breaks, so a pure tie is
        // not miscounted as a "minority" pick.
        let dominant = obs.forms[0];
        for (const f of obs.forms) {
            if (beatsBy(rankByTotalEvents, f, dominant)) dominant = f;
        }
        obs.dominantForm = dominant.form;
        obs.dominantTotalEvents = dominant.totalEvents;
        obs.dominantUserEvents = dominant.userEvents;

        const withUsers = obs.forms.filter(f => f.userEvents > 0);
        if (withUsers.length > 0) {
            let best = withUsers[0];
            for (const f of withUsers) if (beats(f, best)) best = f;
            obs.winner = best;
            obs.winnerSource = best.form === obs.dominantForm ? 'dominant_observed' : 'minority_observed';
            continue;
        }
        // No user evidence. Everything here came from a cold run — i.e. from this
        // script. Drop the spelling that IS the stored key (pure self-replay;
        // using it is identical to falling back anyway) and keep the best of the
        // rest, which at least carries word order the sorted key destroyed.
        const notSelfReplay = obs.forms.filter(f => f.form.trim() !== obs.key);
        if (notSelfReplay.length > 0) {
            let best = notSelfReplay[0];
            for (const f of notSelfReplay) if (beats(f, best)) best = f;
            obs.winner = best;
            obs.winnerSource = 'cold_only_observed';
        }
    }

    return { byKey, hasColdBreakdown, inputRows, distinctForms: tallies.size, coldEventsSeen };
}

/**
 * Resolve one stored cache key to the text this sweep will POST.
 * Pure — no I/O, no globals. This is the whole selection defect surface.
 */
export function selectReplayForm(storedKey: string, index: ReplayIndex): ReplayChoice {
    const obs = index.byKey.get(storedKey);
    if (!obs) {
        return {
            form: storedKey, source: 'stored_key_no_observation',
            userEvents: 0, totalEvents: 0, dominantForm: null, dominantTotalEvents: 0, dominantUserEvents: 0,
        };
    }
    if (!obs.winner || !obs.winnerSource) {
        return {
            form: storedKey, source: 'stored_key_self_replay_only',
            userEvents: 0, totalEvents: 0,
            dominantForm: obs.dominantForm, dominantTotalEvents: obs.dominantTotalEvents,
            dominantUserEvents: obs.dominantUserEvents,
        };
    }
    return {
        form: obs.winner.form, source: obs.winnerSource,
        userEvents: obs.winner.userEvents, totalEvents: obs.winner.totalEvents,
        dominantForm: obs.dominantForm, dominantTotalEvents: obs.dominantTotalEvents,
        dominantUserEvents: obs.dominantUserEvents,
    };
}

const EMPTY_INDEX: ReplayIndex = {
    byKey: new Map(), hasColdBreakdown: false, inputRows: 0, distinctForms: 0, coldEventsSeen: 0,
};

const results: any[] = [];
let done = 0;
let replayIndex: ReplayIndex = EMPTY_INDEX;
const sourceCounts: Record<ReplaySource, number> = {
    dominant_observed: 0,
    minority_observed: 0,
    cold_only_observed: 0,
    stored_key_no_observation: 0,
    stored_key_self_replay_only: 0,
};
/** keys where the most-logged spelling was rejected, with why */
const rejectedDominant: string[] = [];
/** of those, the ones rejected because the most-logged spelling had ZERO user events */
let dominantWasSelfReplay = 0;

async function sweepOne(row: BeforeRow) {
    const choice = selectReplayForm(row.normalizedForm, replayIndex);
    const name = choice.form;
    sourceCounts[choice.source]++;
    if (choice.dominantForm && choice.dominantForm !== name) {
        if (choice.dominantUserEvents === 0) dominantWasSelfReplay++;
        if (rejectedDominant.length < 50) {
            rejectedDominant.push(`${row.normalizedForm}: replayed "${name}" (${choice.userEvents} user ev) over most-logged "${choice.dominantForm}" (${choice.dominantTotalEvents} ev, ${choice.dominantUserEvents} user)`);
        }
    }
    // 100 g weight unit → grams resolution is trivial and identical for every
    // record, so per-100g nutrition compares apples-to-apples.
    const body = { items: [{ rawText: `100g ${name}`, quantity: 100, unit: 'g', name }] };
    const t0 = Date.now();
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const ctrl = new AbortController();
            const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
            const res = await fetch(`${BASE}/api/nlp/parse?nocache=1`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
                body: JSON.stringify(body),
                signal: ctrl.signal,
            });
            clearTimeout(to);
            const items: any = await res.json();
            const it = Array.isArray(items) ? items[0] : null;
            return {
                // `key` must stay the CACHE key so the diff lines up with the
                // --before rows; `queriedAs` records what was actually sent.
                key: row.normalizedForm,
                queriedAs: name,
                before: row,
                cold: it ? {
                    foodId: it.foodId ?? null,
                    foodName: it.foodName ?? null,
                    brandName: it.brandName ?? null,
                    source: it.source ?? null,
                    confidence: it.matchConfidence ?? null,
                    kcal100: it.nutritionPer100g?.kcal100 ?? null,
                    protein100: it.nutritionPer100g?.protein100 ?? null,
                } : { error: `no item (HTTP ${res.status})` },
                ms: Date.now() - t0,
            };
        } catch (e) {
            if (attempt === 1) return { key: row.normalizedForm, queriedAs: name, before: row, cold: { error: String(e).slice(0, 120) }, ms: Date.now() - t0 };
        }
    }
}

async function main() {
    const beforePath = argValue('--before');
    if (!beforePath) {
        console.error('missing --before <foodmapping-rows.json>');
        process.exit(1);
    }
    const before: BeforeRow[] = JSON.parse(fs.readFileSync(beforePath, 'utf8'));

    const observedPath = argValue('--observed');
    if (observedPath) {
        const rows: ObservedRow[] = JSON.parse(fs.readFileSync(observedPath, 'utf8'));
        replayIndex = buildReplayIndex(rows);
        console.log(`[observed] ${replayIndex.inputRows} logged rows → ${replayIndex.distinctForms} distinct forms → ${replayIndex.byKey.size} cache keys`);
        if (!replayIndex.hasColdBreakdown) {
            console.log('⚠️  [observed] the export carries no "coldEvents" column, so this sweep CANNOT tell a real user');
            console.log('    query from its own prior nocache replay, and may re-elect the token-sorted spelling it');
            console.log('    posted last time. Re-export with: count(*) filter (where "noCache") as "coldEvents".');
        } else {
            console.log(`[observed] ${replayIndex.coldEventsSeen} events excluded as this script's own nocache replays`);
        }
    } else {
        console.log('[observed] --observed not supplied: replaying STORED KEYS, which is order-destroyed for ~45% of rows');
    }

    const queue = [...before];
    const workers = Array.from({ length: CONCURRENCY }, async () => {
        while (queue.length) {
            const row = queue.shift()!;
            results.push(await sweepOne(row));
            done++;
            if (done % 25 === 0) console.error(`progress: ${done}/${before.length}`);
        }
    });
    await Promise.all(workers);

    // Every source the cache can hold must be expressible here. FatSecret was
    // missing, and because `beforeId` returned null for those rows the diff
    // compared `fs_1646 !== null` and called every one of them a changed record —
    // a false-positive floor equal to the whole fatsecret share of the cache
    // (441 of 3,246 rows, 13.6%, as of 2026-07-26; it was ~19 rows when the lane
    // shipped, which is why nobody noticed). Making the replay text faithful is
    // pointless if a seventh of the resulting diff is noise.
    const beforeId = (b: BeforeRow) =>
        b.offBarcode ? `off_${b.offBarcode}`
            : b.fdcId != null ? `fdc_${b.fdcId}`
                : b.fsId ? `fs_${b.fsId}`
                    : null;
    let same = 0, changedId = 0, changedSource = 0, errors = 0, unresolvableBefore = 0;
    const changes: any[] = [];
    for (const r of results) {
        if (r.cold.error) { errors++; changes.push({ key: r.key, error: r.cold.error }); continue; }
        const oldId = beforeId(r.before);
        if (r.cold.foodId === oldId) { same++; continue; }
        // No id at all for the incumbent: an old --before export missing a column,
        // not evidence the record moved. Counted separately so it can never be
        // read as a regression.
        if (oldId === null) { unresolvableBefore++; continue; }
        changedId++;
        if (r.cold.source !== r.before.source) changedSource++;
        changes.push({
            key: r.key,
            was: `${oldId} "${r.before.foodName}" (${r.before.source}, used=${r.before.usedCount})`,
            now: `${r.cold.foodId} "${r.cold.foodName}" (${r.cold.source}, conf=${r.cold.confidence?.toFixed?.(2)})`,
            kcal100: r.cold.kcal100,
        });
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = path.join(__dirname, 'results', `cache-parity-${stamp}.json`);
    // Report the replay-fidelity split explicitly. A run that silently fell back
    // to stored keys for most rows looks identical in the diff to a clean run,
    // but it is measuring a different query than the one that owns each row.
    //
    // `usedMinorityForm` is the counter that would have caught the 2026-07-26
    // defect: rows replayed as a spelling that was NOT the most-logged one, with
    // nothing in the old summary saying so. Read it together with
    // `dominantWasSelfReplay`: on the 2026-07-26 corpus 333 rows are "minority"
    // and 329 of those are minority only because the most-LOGGED spelling was
    // this script's own nocache replay with zero user events. A minority count
    // that is NOT explained by `dominantWasSelfReplay` is the one to chase.
    const usedStoredKey = sourceCounts.stored_key_no_observation + sourceCounts.stored_key_self_replay_only;
    const usedObserved = sourceCounts.dominant_observed + sourceCounts.minority_observed + sourceCounts.cold_only_observed;
    const replay = {
        // --- legacy shape, unchanged meaning: observed spelling vs stored key ---
        usedObservedForm: usedObserved,
        usedStoredKey,
        storedKeyPct: +(100 * usedStoredKey / Math.max(1, results.length)).toFixed(1),
        // --- replay-form provenance (added 2026-07-26) ---
        /** replayed with the spelling users typed most — the healthy case */
        usedDominantForm: sourceCounts.dominant_observed,
        /** replayed with an observed-but-NOT-most-logged spelling; >0 wants an explanation */
        usedMinorityForm: sourceCounts.minority_observed,
        /** of usedMinorityForm + usedColdOnlyForm: the most-logged spelling had 0 user events */
        dominantWasSelfReplay,
        /** no user events for the key: best non-self-replay cold spelling used */
        usedColdOnlyForm: sourceCounts.cold_only_observed,
        /** nothing was ever logged for the key */
        storedKeyNoObservation: sourceCounts.stored_key_no_observation,
        /** the only spelling ever logged was this script replaying the stored key */
        storedKeySelfReplayOnly: sourceCounts.stored_key_self_replay_only,
        minorityPct: +(100 * sourceCounts.minority_observed / Math.max(1, results.length)).toFixed(1),
        /** false = the --observed export could not distinguish user events from sweep replays */
        observedHasColdBreakdown: replayIndex.hasColdBreakdown,
        coldEventsExcluded: replayIndex.coldEventsSeen,
    };
    const summary = { total: results.length, sameRecord: same, changedRecord: changedId, changedSource, errors, unresolvableBefore, replay };
    fs.writeFileSync(outPath, JSON.stringify({ base: BASE, ranAt: stamp, summary, changes, rejectedDominant, results }, null, 1));

    console.log(JSON.stringify(summary, null, 1));
    if (unresolvableBefore > 0) {
        console.log(`⚠️  ${unresolvableBefore} of ${results.length} rows carry no reconstructable incumbent id and were EXCLUDED from the diff.`);
        console.log('    Almost always a --before export missing "fsId". Re-export with the SQL in this file\'s header,');
        console.log('    otherwise those rows are invisible to the sweep in BOTH directions.');
    }
    if (usedStoredKey > 0) {
        console.log(`⚠️  ${usedStoredKey} of ${results.length} rows (${replay.storedKeyPct}%) were replayed as the STORED, token-sorted key.`);
        console.log('    Those rows do not reproduce the query that owns them; treat their diffs as suggestive, not authoritative.');
    }
    if (replay.usedMinorityForm > 0) {
        console.log(`ℹ️  ${replay.usedMinorityForm} of ${results.length} rows (${replay.minorityPct}%) were replayed as an observed but NON-most-logged spelling;`);
        console.log(`    ${dominantWasSelfReplay} of the rejected spellings had ZERO user events (this script's own prior replay).`);
        console.log('    Rows in the difference were outvoted on user events alone — see rejectedDominant[] in the output file.');
    }
    if (replay.usedColdOnlyForm > 0) {
        console.log(`ℹ️  ${replay.usedColdOnlyForm} rows have NO user events at all — replayed from a spelling only this script ever produced.`);
    }
    for (const c of changes) {
        if (c.error) console.log(`  ⚠️ [${c.key}] ERROR: ${c.error}`);
        else console.log(`  ↻ [${c.key}]\n      was ${c.was}\n      now ${c.now}`);
    }
    console.log(`\nResults written to ${outPath}`);
}

// Guarded so the replay-form selection above can be unit-tested without this
// script hitting the live API (every POST here is a WRITE — the pipeline's
// saveValidatedMapping is not gated by skipCache). Same pattern as
// scripts/dedupe-off-mark.ts:227.
if (require.main === module) {
    main();
}
