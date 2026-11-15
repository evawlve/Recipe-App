/**
 * validator-bulk-review.ts — run the SHIPPED cache validator over every saved
 * FoodMapping row (s458 VR, 2026-11-14).
 *
 * WRITES. MappingValidationVerdict rows, through runCacheValidation() (the
 * request path's own function: same suppression, same prompt, same verdict
 * guards), plus this script's own files under --out-dir. Nothing else — no
 * FoodMapping column, no cache, no eviction. Diego's word 2026-11-14. A
 * --dry-run issues SELECTs only and zero LLM calls.
 *
 * WHY MEL, NOT A RE-PARSE. The validator's input is (phrase, record identity,
 * billed grams/kcal, serving tier) — exactly what a MappingEventLog event
 * already holds. 57/57 verdicts since 2026-10-01 match their MEL event on
 * phrase = rawLine, grams, kcal and servingTier. Re-parsing would bump
 * FoodMapping.usedCount on every cache hit, so this script never calls the
 * parser.
 *
 * THE JOIN. The live key is collapseAdjacentDuplicateTokens(
 * canonicalizeCacheKey(normalizedForm)); an event belongs to a FoodMapping row
 * only when that key equals row.normalizedForm AND the event's foodId is the
 * row's CURRENT target. The key join cannot see discriminator / brand-prefix
 * keys (the save path appends them), so those rows go untupled (or, rarely,
 * borrow a discriminated line) — they are listed in untupled.tsv, not judged.
 *
 * ORDER. Tupled rows run usedCount desc, then normalizedForm asc, so a capped
 * run covers the most-used keys first.
 *
 * CAP ACCOUNTING. spent = usd of the cache_validate usage-counter deltas +
 * WORST_CALL_USD for every llm_error whose own usage delta is 0 (a failed call
 * may still have been billed). At --concurrency 2 the per-call delta is shared
 * with the other worker, so that term can only under-count; the cap check also
 * reserves WORST_CALL_USD for every call in flight.
 *
 * Exit codes: 0 done / max_usd / max_calls · 2 bad flag or refused preflight ·
 * 3 inside the 03:30-05:30 America/Los_Angeles blackout (nightly sweep window)
 * · 4 five consecutive llm_error.
 */

import * as fs from 'fs';
import * as path from 'path';
import { canonicalizeCacheKey } from '../../src/lib/mapping/normalization-rules';
import { collapseAdjacentDuplicateTokens } from '../../src/lib/mapping/cache-key-core';
import { mappingTargetId, pointerStatusOf } from './validator-triage-queue';
import type { MappingPointer } from './validator-triage-queue';
import type { CacheValidatorInput, CacheValidationOutcome } from '../../src/lib/mapping/cache-validator';

// claude-sonnet-5 list price, claude-api price table cached 2026-11-03: $2 / $10 per MTok.
export function usdFor(inTok: number, outTok: number): number {
    return (inTok * 2) / 1e6 + (outTok * 10) / 1e6;
}
export const WORST_CALL_USD = usdFor(1200, 2048);

export interface BulkEvent {
    nf: string;
    foodId: string;
    rawLine: string;
    foodName: string;
    brandName: string | null;
    grams: number;
    totalKcal: number;
    servingTier: string | null;
    noCache: boolean;
    lastSeen: Date;
}

export type Tupled = { input: CacheValidatorInput; lastSeen: Date; noCache: boolean; keyPhrase: boolean };
export type Untupled = { untupled: 'no_event_for_target' | 'no_exact_key_event' };

/** The judged phrase IS the token-sorted key (a 'rolled oats' line cannot tell us what the user typed). */
export function keyPhrase(e: Pick<BulkEvent, 'rawLine'>, row: Pick<MappingPointer, 'normalizedForm'>): boolean {
    const p = e.rawLine.trim().toLowerCase().replace(/^100 ?g /, '');
    return p === row.normalizedForm && p.includes(' ');
}

export function chooseBilledTuple(row: MappingPointer, events: BulkEvent[]): Tupled | Untupled {
    const target = mappingTargetId(row);
    const ofTarget = events.filter((e) => e.foodId === target);
    if (ofTarget.length === 0) return { untupled: 'no_event_for_target' };
    const exact = ofTarget.filter(
        (e) => collapseAdjacentDuplicateTokens(canonicalizeCacheKey(e.nf)) === row.normalizedForm,
    );
    if (exact.length === 0) return { untupled: 'no_exact_key_event' };
    const ranked = exact
        .map((e) => ({ e, kp: keyPhrase(e, row) }))
        .sort((a, b) => {
            if (a.e.noCache !== b.e.noCache) return a.e.noCache ? 1 : -1;
            if (a.kp !== b.kp) return a.kp ? 1 : -1;
            const dt = b.e.lastSeen.getTime() - a.e.lastSeen.getTime();
            if (dt !== 0) return dt;
            return a.e.rawLine < b.e.rawLine ? -1 : a.e.rawLine > b.e.rawLine ? 1 : 0;
        });
    const { e, kp } = ranked[0];
    return {
        input: {
            phrase: e.rawLine.trim(),
            foodName: e.foodName,
            brandName: e.brandName,
            source: row.source,
            recordId: e.foodId,
            billedGrams: e.grams,
            billedKcal: e.totalKcal,
            servingTier: e.servingTier ?? null,
        },
        lastSeen: e.lastSeen,
        noCache: e.noCache,
        keyPhrase: kp,
    };
}

/** True when `d` falls in 03:30 <= t < 05:30 America/Los_Angeles (the nightly sweep window). */
export function inBlackoutLA(d: Date): boolean {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d);
    const h = Number(parts.find((p) => p.type === 'hour')?.value);
    const m = Number(parts.find((p) => p.type === 'minute')?.value);
    const t = h * 60 + m;
    return t >= 3 * 60 + 30 && t < 5 * 60 + 30;
}

export function rankSuspects<T extends { usedCount: number; normalizedForm: string }>(rows: T[]): T[] {
    return [...rows].sort((a, b) =>
        b.usedCount - a.usedCount || (a.normalizedForm < b.normalizedForm ? -1 : a.normalizedForm > b.normalizedForm ? 1 : 0));
}

export interface BulkDeps {
    readMappings(): Promise<MappingPointer[]>;
    readEvents(): Promise<BulkEvent[]>;
    countVerdicts(): Promise<number>;
    validate(input: CacheValidatorInput, rawCacheKey: string, opts: { dryRun: boolean }): Promise<CacheValidationOutcome>;
    usage(): { promptTokens: number; completionTokens: number };
    now(): Date;
    sleep(ms: number): Promise<void>;
    /** Optional: the exact prompts for --print-prompts. */
    prompts?(input: CacheValidatorInput): { systemPrompt: string; userPrompt: string };
    log?(line: string): void;
}

export interface BulkOpts {
    outDir: string;
    dryRun: boolean;
    maxUsd?: number;
    maxCalls?: number;
    concurrency: number;
    paceMs: number;
    printPrompts: number;
}

type RowOutcome = CacheValidationOutcome['outcome'] | 'not_reached' | 'threw';
const LLM_OUTCOMES = new Set<string>(['written', 'llm_error', 'wrong_tier', 'malformed', 'write_failed', 'threw']);
const FAILURE_OUTCOMES = new Set<string>(['llm_error', 'wrong_tier', 'malformed', 'write_failed', 'threw']);

const clean = (v: unknown): string => String(v ?? '').replace(/[\t\r\n]+/g, ' ');
const tsv = (cells: unknown[]): string => cells.map(clean).join('\t');

export async function runBulkReview(deps: BulkDeps, opts: BulkOpts): Promise<{ exitCode: number; summary: Record<string, unknown> }> {
    const log = deps.log ?? (() => undefined);
    const startedAt = deps.now();
    const verdictRowsAtStart = await deps.countVerdicts();
    const mappings = await deps.readMappings();
    const events = await deps.readEvents();
    const byFood = new Map<string, BulkEvent[]>();
    for (const e of events) {
        const l = byFood.get(e.foodId);
        if (l) l.push(e); else byFood.set(e.foodId, [e]);
    }

    type Item = { row: MappingPointer; foodId: string | null; t: Tupled | null; reason: string | null };
    const items: Item[] = mappings.map((row) => {
        const foodId = mappingTargetId(row);
        const r = foodId == null ? ({ untupled: 'no_event_for_target' } as Untupled) : chooseBilledTuple(row, byFood.get(foodId) ?? []);
        return 'untupled' in r ? { row, foodId, t: null, reason: r.untupled } : { row, foodId, t: r, reason: null };
    });
    const tupled = rankSuspects(items.filter((i) => i.t).map((i) => ({ ...i, usedCount: i.row.usedCount, normalizedForm: i.row.normalizedForm })));
    const untupled = items.filter((i) => !i.t);

    const outcomes = new Map<Item, { outcome: RowOutcome; detail?: CacheValidationOutcome }>();
    for (const t of tupled) outcomes.set(t, { outcome: 'not_reached' });

    const base = deps.usage();
    const tokensNow = () => {
        const u = deps.usage();
        return { p: u.promptTokens - base.promptTokens, c: u.completionTokens - base.completionTokens };
    };
    let zeroDeltaErrors = 0;
    const spentUsd = () => { const t = tokensNow(); return usdFor(t.p, t.c) + zeroDeltaErrors * WORST_CALL_USD; };

    let llmCalls = 0;
    let failures = 0;
    let inFlight = 0;
    let consecutiveErrors = 0;
    let stopReason = 'complete';
    let exitCode = 0;
    let next = 0;
    const stop = (reason: string, code: number) => { if (stopReason === 'complete') { stopReason = reason; exitCode = code; } };

    if (!opts.dryRun && inBlackoutLA(deps.now())) stop('blackout', 3);
    if (opts.dryRun && opts.printPrompts > 0 && deps.prompts) {
        tupled.slice(0, opts.printPrompts).forEach((t, i) => {
            const p = deps.prompts!(t.t!.input);
            if (i === 0) log(`--- SYSTEM PROMPT ---\n${p.systemPrompt}`);
            log(`--- USER PROMPT ${i + 1} (${t.row.normalizedForm}) ---\n${p.userPrompt}`);
        });
    }

    const worker = async (): Promise<void> => {
        while (stopReason === 'complete') {
            if (next >= tupled.length) return;
            if (!opts.dryRun) {
                if (inBlackoutLA(deps.now())) { stop('blackout', 3); return; }
                if (opts.maxCalls != null && llmCalls + inFlight >= opts.maxCalls) { stop('max_calls', 0); return; }
                if (opts.maxUsd != null && spentUsd() + (inFlight + 1) * WORST_CALL_USD > opts.maxUsd) { stop('max_usd', 0); return; }
            }
            const item = tupled[next++];
            const before = tokensNow();
            inFlight++;
            let detail: CacheValidationOutcome | null = null;
            try {
                detail = await deps.validate(item.t!.input, item.row.normalizedForm, { dryRun: opts.dryRun });
            } catch (err) {
                log(`validate threw for ${item.row.normalizedForm}: ${(err as Error).message}`);
            }
            inFlight--;
            const outcome: RowOutcome = detail ? detail.outcome : 'threw';
            outcomes.set(item, { outcome, detail: detail ?? undefined });
            if (LLM_OUTCOMES.has(outcome)) {
                llmCalls++;
                if (FAILURE_OUTCOMES.has(outcome)) failures++;
                const after = tokensNow();
                if (outcome === 'llm_error' && after.p === before.p && after.c === before.c) zeroDeltaErrors++;
                consecutiveErrors = outcome === 'llm_error' ? consecutiveErrors + 1 : 0;
                if (consecutiveErrors >= 5) { stop('consecutive_llm_errors', 4); return; }
                if (next < tupled.length && opts.paceMs > 0) await deps.sleep(opts.paceMs);
            }
        }
    };
    if (stopReason === 'complete') {
        await Promise.all(Array.from({ length: opts.concurrency }, () => worker()));
    }

    // ---- files ----
    fs.mkdirSync(opts.outDir, { recursive: true });
    const w = (name: string, body: string) => fs.writeFileSync(path.join(opts.outDir, name), body);
    w('selection.tsv', [tsv(['normalizedForm', 'foodId', 'usedCount', 'status', 'reason']),
        ...items.map((i) => tsv([i.row.normalizedForm, i.foodId, i.row.usedCount, i.t ? 'tupled' : 'untupled', i.reason ?? ''])),
    ].join('\n') + '\n');
    w('untupled.tsv', [tsv(['normalizedForm', 'foodId', 'usedCount', 'reason']),
        ...rankSuspects(untupled.map((i) => ({ ...i, usedCount: i.row.usedCount, normalizedForm: i.row.normalizedForm })))
            .map((i) => tsv([i.row.normalizedForm, i.foodId, i.row.usedCount, i.reason])),
    ].join('\n') + '\n');
    w('outcomes.jsonl', tupled.map((i) => JSON.stringify({
        normalizedForm: i.row.normalizedForm, foodId: i.foodId, usedCount: i.row.usedCount,
        phrase: i.t!.input.phrase, billedGrams: i.t!.input.billedGrams, billedKcal: i.t!.input.billedKcal,
        servingTier: i.t!.input.servingTier, lastSeen: i.t!.lastSeen.toISOString(),
        noCache: i.t!.noCache, keyPhrase: i.t!.keyPhrase,
        outcome: outcomes.get(i)!.outcome, detail: outcomes.get(i)!.detail ?? null,
    })).join('\n') + (tupled.length ? '\n' : ''));

    const suspectRows = tupled.flatMap((i) => {
        const d = outcomes.get(i)!.detail;
        if (!d) return [];
        let axis: string; let reason: string; let validatedBy: string;
        if (d.outcome === 'written' && d.verdict === 'SUSPECT') { axis = d.axis; reason = d.reason; validatedBy = 'bulk-review'; }
        else if (d.outcome === 'suppressed' && d.priorVerdict === 'SUSPECT') { axis = d.priorAxis; reason = d.priorReason; validatedBy = 'prior-verdict'; }
        else return [];
        return [{
            usedCount: i.row.usedCount, normalizedForm: i.row.normalizedForm, foodId: i.foodId as string,
            pointerStatus: pointerStatusOf(i.foodId as string, i.row), axis, phrase: i.t!.input.phrase,
            billedGrams: i.t!.input.billedGrams, billedKcal: i.t!.input.billedKcal, servingTier: i.t!.input.servingTier,
            lastSeen: i.t!.lastSeen.toISOString(), noCache: i.t!.noCache, keyPhrase: i.t!.keyPhrase, reason,
            validatedBy: `${i.row.validatedBy}/${validatedBy}`,
        }];
    });
    const cols = ['usedCount', 'normalizedForm', 'foodId', 'pointerStatus', 'axis', 'phrase', 'billedGrams', 'billedKcal',
        'servingTier', 'lastSeen', 'noCache', 'keyPhrase', 'reason', 'validatedBy'] as const;
    w('suspects.tsv', [
        '# usedCount is our own traffic — an ordering aid, never a price; serving-axis rows on an old lastSeen need a fresh probe; keyPhrase=true means the judged phrase is the token-sorted key',
        tsv([...cols]),
        ...rankSuspects(suspectRows).map((r) => tsv(cols.map((c) => r[c]))),
    ].join('\n') + '\n');

    const byOutcome: Record<string, number> = {};
    for (const i of tupled) { const o = outcomes.get(i)!.outcome; byOutcome[o] = (byOutcome[o] ?? 0) + 1; }
    const tok = tokensNow();
    const verdictRowsAtEnd = await deps.countVerdicts();
    const endedAt = deps.now();
    const summary = {
        fmRows: mappings.length,
        tupled: tupled.length,
        untupled: untupled.length,
        keyPhrase: tupled.filter((i) => i.t!.keyPhrase).length,
        byOutcome,
        llmCalls,
        failures,
        promptTokens: tok.p,
        completionTokens: tok.c,
        usd: usdFor(tok.p, tok.c),
        secondsPerCall: llmCalls > 0 ? (endedAt.getTime() - startedAt.getTime()) / 1000 / llmCalls : null,
        startedAt: startedAt.toISOString(),
        verdictRowsAtStart,
        verdictRowsAtEnd,
        stopReason,
        reconciled: tupled.length === Object.values(byOutcome).reduce((a, b) => a + b, 0),
    };
    w('summary.json', JSON.stringify(summary, null, 2) + '\n');
    return { exitCode, summary };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

class FlagError extends Error { }

export function parseArgs(argv: string[]): BulkOpts {
    const o: BulkOpts = { outDir: '', dryRun: false, concurrency: 1, paceMs: 1000, printPrompts: 3 };
    const num = (flag: string, raw: string | undefined, min: number): number => {
        const n = Number(raw);
        if (raw === undefined || raw === '' || !Number.isFinite(n) || n < min) throw new FlagError(`${flag} needs a number >= ${min}`);
        return n;
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--dry-run') o.dryRun = true;
        else if (a === '--out-dir') o.outDir = argv[++i] ?? '';
        else if (a === '--max-usd') o.maxUsd = num(a, argv[++i], 0);
        else if (a === '--max-calls') o.maxCalls = num(a, argv[++i], 0);
        else if (a === '--concurrency') {
            const n = num(a, argv[++i], 1);
            if (n !== 1 && n !== 2) throw new FlagError('--concurrency must be 1 or 2');
            o.concurrency = n;
        } else if (a === '--pace-ms') o.paceMs = num(a, argv[++i], 0);
        else if (a === '--print-prompts') o.printPrompts = num(a, argv[++i], 0);
        else throw new FlagError(`unknown flag ${a}`);
    }
    if (!o.outDir) throw new FlagError('--out-dir is required');
    if (!o.dryRun && o.maxUsd === undefined) throw new FlagError('--max-usd is required unless --dry-run');
    return o;
}

async function main(): Promise<number> {
    let opts: BulkOpts;
    try { opts = parseArgs(process.argv.slice(2)); } catch (err) {
        console.error(`${(err as Error).message}\nNothing was written.`);
        return 2;
    }
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { prisma } = require('@/lib/db') as typeof import('@/lib/db');
    const { Prisma } = require('@prisma/client') as typeof import('@prisma/client');
    try {
        const cfg = require('@/lib/mapping/config') as typeof import('@/lib/mapping/config');
        if (cfg.VALIDATOR_AI_MODEL !== 'claude-sonnet-5') {
            console.error(`refused: VALIDATOR_AI_MODEL must be 'claude-sonnet-5' (got '${cfg.VALIDATOR_AI_MODEL}')`);
            return 2;
        }
        if (!opts.dryRun) {
            if (cfg.VALIDATOR_AI_PROVIDER !== 'anthropic') { console.error("refused: VALIDATOR_AI_PROVIDER must be 'anthropic'"); return 2; }
            if (!process.env.ANTHROPIC_API_KEY) { console.error('refused: ANTHROPIC_API_KEY is empty'); return 2; }
        }
        const cv = require('@/lib/mapping/cache-validator') as typeof import('@/lib/mapping/cache-validator');
        const { getLlmUsageSnapshot } = require('@/lib/ai/llm-usage-metrics') as typeof import('@/lib/ai/llm-usage-metrics');
        const deps: BulkDeps = {
            readMappings: () => prisma.foodMapping.findMany({
                select: {
                    normalizedForm: true, source: true, offBarcode: true, fdcId: true, fsId: true,
                    foodName: true, brandName: true, validatedBy: true, validatedAt: true, usedCount: true,
                },
            }),
            readEvents: async () => {
                // V/sql/bulk-select.sql verbatim (SELECT only).
                const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
SELECT m."normalizedForm" AS nf, m."foodId" AS "foodId", m."rawLine" AS "rawLine", m."foodName" AS "foodName",
       m."brandName" AS "brandName", m.grams AS grams, m."totalKcal" AS "totalKcal", m."servingTier" AS "servingTier",
       m."noCache" AS "noCache", max(m."createdAt") AS "lastSeen"
FROM "MappingEventLog" m
WHERE m."foodId" IS NOT NULL AND m.grams IS NOT NULL AND m."totalKcal" IS NOT NULL AND m."normalizedForm" IS NOT NULL
  AND m."foodId" IN (SELECT COALESCE('off_'||"offBarcode", 'fdc_'||"fdcId"::text, 'fs_'||"fsId") FROM "FoodMapping")
GROUP BY 1,2,3,4,5,6,7,8,9`);
                return rows.map((r) => ({
                    nf: String(r.nf), foodId: String(r.foodId), rawLine: String(r.rawLine), foodName: String(r.foodName),
                    brandName: r.brandName == null ? null : String(r.brandName),
                    grams: Number(r.grams), totalKcal: Number(r.totalKcal),
                    servingTier: r.servingTier == null ? null : String(r.servingTier),
                    noCache: Boolean(r.noCache), lastSeen: new Date(r.lastSeen as string | Date),
                }));
            },
            countVerdicts: () => prisma.mappingValidationVerdict.count(),
            validate: (input, key, o) => cv.runCacheValidation(input, key, o),
            usage: () => {
                const u = getLlmUsageSnapshot().byPurpose.cache_validate;
                return { promptTokens: u?.promptTokens ?? 0, completionTokens: u?.completionTokens ?? 0 };
            },
            now: () => new Date(),
            sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
            prompts: cv.buildCacheValidatorPrompts,
            log: (l) => console.log(l),
        };
        const { exitCode, summary } = await runBulkReview(deps, opts);
        console.log(JSON.stringify(summary));
        return exitCode;
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    main().then(
        (code) => process.exit(code),
        (err) => { console.error(err); process.exit(1); },
    );
}
