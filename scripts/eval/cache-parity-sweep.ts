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
 *     [--base http://192.168.1.133:3000] [--concurrency 4]
 *
 * The --before file is a JSON array of FoodMapping rows:
 *   select json_agg(row_to_json(t)) from (select "normalizedForm","foodName",
 *   "brandName",source,"offBarcode","fdcId","aiConfidence","usedCount"
 *   from "FoodMapping" order by "normalizedForm") t;
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
const beforePath = argValue('--before');
if (!beforePath) {
    console.error('missing --before <foodmapping-rows.json>');
    process.exit(1);
}

interface BeforeRow {
    normalizedForm: string;
    foodName: string;
    brandName: string | null;
    source: string;
    offBarcode: string | null;
    fdcId: number | null;
    aiConfidence: number;
    usedCount: number;
}

const before: BeforeRow[] = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
const results: any[] = [];
let done = 0;

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
 * Build the file with:
 *   select json_agg(row_to_json(t)) from (
 *     select "normalizedForm", count(*) as events
 *     from "MappingEventLog" where "normalizedForm" is not null
 *     group by 1 order by 2 desc) t;
 */
interface ObservedRow { normalizedForm: string; events: number }
const observedPath = argValue('--observed');
const observedByKey = new Map<string, { form: string; events: number }>();
if (observedPath) {
    const rows: ObservedRow[] = JSON.parse(fs.readFileSync(observedPath, 'utf8'));
    for (const r of rows) {
        if (!r.normalizedForm) continue;
        // Skip forms that are ALREADY in canonical order — they are almost all
        // prior sweep replays feeding on themselves, and they carry no order
        // information to recover.
        if (r.normalizedForm.trim() === canonicalizeCacheKey(r.normalizedForm)) continue;
        const key = canonicalizeCacheKey(r.normalizedForm);
        const cur = observedByKey.get(key);
        if (!cur || r.events > cur.events) observedByKey.set(key, { form: r.normalizedForm, events: r.events });
    }
    console.log(`[observed] ${rows.length} logged forms → ${observedByKey.size} keys with a recoverable query order`);
} else {
    console.log('[observed] --observed not supplied: replaying STORED KEYS, which is order-destroyed for ~45% of rows');
}
let usedObserved = 0;
let usedStoredKey = 0;

async function sweepOne(row: BeforeRow) {
    const obs = observedByKey.get(row.normalizedForm);
    const name = obs?.form ?? row.normalizedForm;
    if (obs) usedObserved++; else usedStoredKey++;
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

    const beforeId = (b: BeforeRow) => b.offBarcode ? `off_${b.offBarcode}` : (b.fdcId != null ? `fdc_${b.fdcId}` : null);
    let same = 0, changedId = 0, changedSource = 0, errors = 0;
    const changes: any[] = [];
    for (const r of results) {
        if (r.cold.error) { errors++; changes.push({ key: r.key, error: r.cold.error }); continue; }
        const oldId = beforeId(r.before);
        if (r.cold.foodId === oldId) { same++; continue; }
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
    const replay = { usedObservedForm: usedObserved, usedStoredKey, storedKeyPct: +(100 * usedStoredKey / Math.max(1, results.length)).toFixed(1) };
    const summary = { total: results.length, sameRecord: same, changedRecord: changedId, changedSource, errors, replay };
    fs.writeFileSync(outPath, JSON.stringify({ base: BASE, ranAt: stamp, summary, changes, results }, null, 1));

    console.log(JSON.stringify(summary, null, 1));
    if (usedStoredKey > 0) {
        console.log(`⚠️  ${usedStoredKey} of ${results.length} rows (${replay.storedKeyPct}%) were replayed as the STORED, token-sorted key.`);
        console.log('    Those rows do not reproduce the query that owns them; treat their diffs as suggestive, not authoritative.');
    }
    for (const c of changes) {
        if (c.error) console.log(`  ⚠️ [${c.key}] ERROR: ${c.error}`);
        else console.log(`  ↻ [${c.key}]\n      was ${c.was}\n      now ${c.now}`);
    }
    console.log(`\nResults written to ${outPath}`);
}

main();
