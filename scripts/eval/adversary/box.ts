/**
 * box.ts — every contact the hard-case loop makes with the box.
 *
 * ADDRESSING. The MagicDNS short name `dhl32-opt-5060`, always, for both HTTP and ssh:
 *   - never the `100.90.5.18` literal: on an IPv6-only network Apple's resolver NAT64s it
 *     out of the tunnel (memory mac-env-points-at-tailnet-ip);
 *   - never the `.ts.net` FQDN: over http that is the PUBLIC Funnel, where a keyed request
 *     is refused (memory public-keyed-probe-is-refused);
 *   - never `192.168.1.133`: home LAN only.
 * The short name resolves only on the tailnet, so off it every call here fails closed.
 *
 * READS. `psql` runs inside `docker exec` on the box with
 * `PGOPTIONS=-c default_transaction_read_only=on`, so a read here cannot write even if a
 * statement tried to. SQL goes over ssh STDIN (no shell quoting of the statement), and
 * each query returns ONE `json_agg` value, parsed here on the Mac — the box has no jq.
 *
 * THE ONE WRITE PATH is probeParse(): a keyed `POST /api/nlp/parse?nosave=1`. It still
 * writes a MappingEventLog row per item, bumps usedCount, and can CREATE LearnedSynonym,
 * AiGeneratedFood and AiNormalizeCache rows (memory nosave-write-scope). Only Mode G calls
 * it, on demand, bracketed by tableCounts().
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import type { MelEvent } from './filters';
import { RETRY_PAUSE_MS, withOneRetry, type SpawnOutcome } from './retry';

export const BOX_HOST = 'dhl32-opt-5060';
export const BOX_BASE = `http://${BOX_HOST}:3000`;
const SSH = '/usr/bin/ssh';
const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4'];
const PSQL = `docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' mealspire-db psql -U postgres -d mealspire -At -v ON_ERROR_STOP=1`;

function runPsql(sql: string): SpawnOutcome {
    const r = spawnSync(SSH, [...SSH_OPTS, `owner@${BOX_HOST}`, PSQL], { input: sql, encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
}

/**
 * Run one read-only statement that yields a single JSON value; null → []. A transient ssh
 * failure (retry.ts: killed by the timeout, or ssh's 255 "timed out") is retried ONCE after
 * a pause, and the error then says so.
 */
export function psqlJson<T>(sql: string, run: (sql: string) => SpawnOutcome = runPsql, pauseMs = RETRY_PAUSE_MS): T {
    const { result: r, retried } = withOneRetry(() => run(sql), pauseMs);
    if (r.error || r.status !== 0) {
        throw new Error(`box psql failed${retried ? ' after one retry' : ''} (exit ${r.status ?? 'null'}): ${(r.stderr || r.error?.message || '').trim().slice(0, 300)}`);
    }
    const out = r.stdout.trim();
    return (out ? JSON.parse(out) : []) as T;
}

/** A PDT or UTC stamp we are about to splice into SQL: digits, dashes, colons and one space only. */
export function sqlStamp(s: string): string {
    if (!/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(s)) throw new Error(`refusing a non-timestamp in SQL: ${JSON.stringify(s)}`);
    return s;
}

const PT = `("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')`;

/** noCache=false MEL events whose PDT time is in [sincePt, untilPt). */
export function fetchMelWindow(sincePt: string, untilPt: string): MelEvent[] {
    const sql = `SELECT coalesce(json_agg(t ORDER BY t.utc), '[]') FROM (
  SELECT id, to_char("createdAt",'YYYY-MM-DD HH24:MI:SS') AS utc, to_char(${PT},'YYYY-MM-DD HH24:MI:SS') AS pt,
         "rawLine", "normalizedForm", "foodId", "foodName", "brandName", source, "servingTier",
         grams, "totalKcal", "funnelStage", "cacheHit"
  FROM "MappingEventLog"
  WHERE "noCache" = false AND ${PT} >= '${sqlStamp(sincePt)}' AND ${PT} < '${sqlStamp(untilPt)}'
) t;`;
    return psqlJson<MelEvent[]>(sql);
}

/** rawLines the nightly sweep itself sent: noCache=false events in any 04:xx PDT hour of [sincePt, untilPt). */
export function fetchSweepStrings(sincePt: string, untilPt: string): string[] {
    const sql = `SELECT coalesce(json_agg(DISTINCT "rawLine"), '[]') FROM "MappingEventLog"
  WHERE "noCache" = false AND ${PT} >= '${sqlStamp(sincePt)}' AND ${PT} < '${sqlStamp(untilPt)}'
    AND extract(hour FROM ${PT}) = 4;`;
    return psqlJson<string[]>(sql);
}

/** MEL rows (both noCache values) written in [startUtc, endUtc] — a Mode G probe's own rows, plus anyone else's. */
export function fetchMelBetweenUtc(startUtc: string, endUtc: string): MelEvent[] {
    const sql = `SELECT coalesce(json_agg(t ORDER BY t.utc), '[]') FROM (
  SELECT id, to_char("createdAt",'YYYY-MM-DD HH24:MI:SS.MS') AS utc, to_char(${PT},'YYYY-MM-DD HH24:MI:SS') AS pt,
         "rawLine", "normalizedForm", "foodId", "foodName", "brandName", source, "servingTier",
         grams, "totalKcal", "funnelStage", "cacheHit", "noCache"
  FROM "MappingEventLog"
  WHERE "createdAt" >= '${sqlStamp(startUtc.slice(0, 19))}'::timestamp - interval '1 second'
    AND "createdAt" <= '${sqlStamp(endUtc.slice(0, 19))}'::timestamp + interval '2 seconds'
) t;`;
    return psqlJson<MelEvent[]>(sql);
}

export interface TableCounts { at: string; mel: number; learnedSynonym: number; aiGeneratedFood: number; aiNormalizeCache: number; foodMapping: number }

/** The four tables the brief brackets a Mode G run with, plus FoodMapping (which nosave must not move). */
export function tableCounts(): TableCounts {
    const sql = `SELECT json_build_object(
  'at', to_char(now() AT TIME ZONE 'America/Los_Angeles','YYYY-MM-DD HH24:MI:SS'),
  'mel', (SELECT count(*) FROM "MappingEventLog"),
  'learnedSynonym', (SELECT count(*) FROM "LearnedSynonym"),
  'aiGeneratedFood', (SELECT count(*) FROM "AiGeneratedFood"),
  'aiNormalizeCache', (SELECT count(*) FROM "AiNormalizeCache"),
  'foodMapping', (SELECT count(*) FROM "FoodMapping"));`;
    return psqlJson<TableCounts>(sql);
}

/** DEV_API_KEY from the backend .env, read by regex — never printed, never put in argv. */
export function readDevKey(envPath: string): string {
    const txt = fs.readFileSync(envPath, 'utf8');
    const m = txt.match(/^DEV_API_KEY=(.*)$/m);
    const key = (m?.[1] ?? '').trim().replace(/^["']|["']$/g, '').replace(/\r$/, '');
    if (!key) throw new Error(`DEV_API_KEY is not set in ${envPath}`);
    return key;
}

export interface ApiOk {
    buildId: string | null;
    authorized: boolean | null;
    since: string | null;
    pid: number | null;
    /** per purpose: responses and logicalSuccesses, quoted together or not at all. */
    purposes: Record<string, { responses: number | null; logicalSuccesses: number | null }>;
    raw: unknown;
}

export async function apiOk(key?: string): Promise<ApiOk> {
    const res = await fetch(`${BOX_BASE}/api/ok`, {
        headers: key ? { 'x-api-key': key } : {},
        signal: AbortSignal.timeout(10_000),
    });
    const d = await res.json() as Record<string, unknown>;
    const llm = (d.llm ?? {}) as Record<string, unknown>;
    const src = (llm.purposes ?? llm.byPurpose ?? {}) as Record<string, Record<string, unknown>>;
    const purposes: ApiOk['purposes'] = {};
    for (const [p, v] of Object.entries(src)) {
        if (v && typeof v === 'object') {
            purposes[p] = {
                responses: typeof v.responses === 'number' ? v.responses : null,
                logicalSuccesses: typeof v.logicalSuccesses === 'number' ? v.logicalSuccesses : null,
            };
        }
    }
    return {
        buildId: typeof d.buildId === 'string' ? d.buildId : null,
        authorized: typeof llm.authorized === 'boolean' ? llm.authorized : null,
        since: typeof llm.since === 'string' ? llm.since : null,
        pid: typeof llm.pid === 'number' ? llm.pid : null,
        purposes, raw: d,
    };
}

export interface ProbeItem { foodId: string | null; foodName: string | null; brandName: string | null; source: string | null; grams: number | null; kcal: number | null; funnelStage: string | null; cacheHit: string | null }
export interface ProbeResult { status: number; items: ProbeItem[]; ms: number; receipt: string | null; error?: string }

/**
 * One keyed `nosave=1` parse, 60 s cap (the brief's `curl -m 60`). Never throws. Warm by
 * default — the answer a user would be served. `nocache` adds `nocache=1`, the cold
 * pipeline, whose MEL rows land `noCache=true`.
 */
export async function probeParse(line: string, key: string, nocache = false): Promise<ProbeResult> {
    const t0 = Date.now();
    try {
        const res = await fetch(`${BOX_BASE}/api/nlp/parse?nosave=1${nocache ? '&nocache=1' : ''}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': key },
            body: JSON.stringify({ text: line }),
            signal: AbortSignal.timeout(60_000),
        });
        const receipt = res.headers.get('x-write-receipt');
        const body = await res.json().catch(() => null) as unknown;
        const ms = Date.now() - t0;
        if (!Array.isArray(body)) return { status: res.status, items: [], ms, receipt, error: `non-array body: ${JSON.stringify(body).slice(0, 160)}` };
        const items = body.map((it: Record<string, unknown>) => {
            const nut = (it.nutrition ?? {}) as Record<string, unknown>;
            return {
                foodId: (it.foodId as string) ?? null, foodName: (it.foodName as string) ?? null,
                brandName: (it.brandName as string) ?? null, source: (it.source as string) ?? null,
                grams: typeof it.grams === 'number' ? it.grams : null,
                kcal: typeof nut.calories === 'number' ? nut.calories : null,
                funnelStage: (it.funnelStage as string) ?? null, cacheHit: (it.cacheHit as string) ?? null,
            };
        });
        return { status: res.status, items, ms, receipt };
    } catch (e) {
        return { status: 0, items: [], ms: Date.now() - t0, receipt: null, error: e instanceof Error ? e.message : String(e) };
    }
}
