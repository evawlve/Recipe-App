/**
 * judge.ts — the hard-case loop's model calls: the judge (many rows per call) and the
 * Mode G line generator. Two arms, switchable per run with `--judge`:
 *
 *   claude-cli (default)  `claude -p` on Diego's Claude Code SUBSCRIPTION, from the Mac.
 *     The lean form measured by consolidation S50b §2 (485 input tokens for a one-word
 *     reply, against ~$0.18 notional for a default headless call that loads CLAUDE.md,
 *     memory and every tool): `--tools "" --strict-mcp-config --disable-slash-commands
 *     --no-chrome --no-session-persistence --setting-sources ""` plus a system-prompt
 *     file and an inline `--json-schema`. Traps, all measured:
 *       - `--json-schema` takes inline JSON, not a path;
 *       - `--max-turns` and `--system-prompt-file` work although `--help` omits them, and
 *         a schema reply takes 2 turns internally (`num_turns: 2`) under `--max-turns 1`
 *         (a long generator reply can need 3 — see callModel());
 *       - `--bare` reads ONLY ANTHROPIC_API_KEY, so it can never use the subscription;
 *       - the `sonnet` alias resolved to claude-sonnet-5 on 2026-09-28, so the model is named in full
 *         and every reply's `modelUsage` is checked against it (MODEL_MISMATCH otherwise);
 *       - the call runs from a directory with no CLAUDE.md above it (~/.adversary);
 *       - launchd gives no PATH, so the binary is an absolute path.
 *     Any ANTHROPIC_* variable in the environment would move billing off the subscription
 *     and is refused by cli.ts's preflight, not silently inherited.
 *
 *   openrouter  a direct OpenRouter POST through correctness-screen.ts's
 *     postChatCompletion() — the same fetch callLlm() makes — with any `--model`
 *     (default `anthropic/claude-sonnet-5`, matching the CLI arm; see DEFAULT_MODEL). NOT callStructuredLlm(): it has no model option, and
 *     reaching a named model through it means touching src/. This arm bills OpenRouter
 *     credit, so it is the fallback for a Mac that is asleep or signed out.
 *
 * FAIL CLOSED. A row the reply does not return, returns twice, or returns with an
 * unreadable verdict is UNSURE with an `error`, never OK — the rule correctness-screen's
 * callLlm() settled after a truncated reply was once read as a clean row. A failed call
 * makes every row in it UNSURE. UNSURE is reported, never dropped.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import { postChatCompletion } from '../correctness-screen';
import { withOneRetry } from './retry';

export type JudgeArm = 'claude-cli' | 'openrouter';
export type VerdictWord = 'OK' | 'BAD' | 'UNSURE';

export interface JudgeRow {
    id: string;
    line: string;
    record: string;
    brand: string;
    source: string;
    foodId: string;
    grams: number | null;
    kcal: number | null;
    kcalPer100g: number | null;
    tier: string | null;
    /** Optional extra card lines (macros, a package note). */
    extra?: string[];
}

export interface Verdict {
    id: string;
    verdict: VerdictWord;
    axis: string;
    expectedGrams: number | null;
    reason: string;
    error?: string;
}

export interface CallRecord {
    arm: JudgeArm;
    model: string;
    purpose: 'judge' | 'generate';
    rows: number;
    inputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    /** The CLI's notional `total_cost_usd` (list price); null on OpenRouter unless reported. */
    costUsd: number | null;
    durationMs: number;
    error?: string;
}

export interface JudgeConfig {
    arm: JudgeArm;
    model: string;
    claudeBin: string;
    /** A directory with no CLAUDE.md above it. */
    cwd: string;
    rowsPerCall: number;
    maxCalls: number;
    budgetPerCallUsd: number;
    timeoutMs: number;
    /** Pause before the one retry of a killed `claude -p` call (retry.ts). Unset = RETRY_PAUSE_MS. */
    retryPauseMs?: number;
    /** The CLI's `--effort` (low|medium|high|xhigh|max). Unset = the CLI's per-model default, which differs by model. */
    effort?: string;
    openrouter?: { baseUrl: string; apiKey: string };
}

/**
 * THE JUDGE IS SONNET 5, NOT 5.5 — decided by ROW 0 (Lane A S63, 2026-09-29) under the
 * brief's own rule, "Sonnet 5.5 is the judge unless it catches fewer BAD or flags more GOOD
 * than 5 on the same harness". On the 81 batch-01 rows through THIS judge, 27 rows per
 * call, two draws each (`cli.ts calibrate`):
 *   --effort high     claude-sonnet-5  BAD 22, 21 /23 · GOOD 1, 0 /48
 *                     claude-sonnet-5-5 BAD 21, 20 /23 · GOOD 1, 0 /48
 *   default effort    claude-sonnet-5  BAD 22, 21 · GOOD 1, 1
 *                     claude-sonnet-5-5 BAD 18, 19 · GOOD 0, 1
 * 5.5's extra misses are near-name identity swaps (`elote dip` -> Spicy Queso Dip,
 * `unexpected cheddar` -> a cheddar chicken sausage). Sonnet 5 costs ~2.4x the output
 * tokens and ~5x the wall time per call; neither matters at Mode O's volume. Re-run
 * `calibrate` before changing either value — a new model is a one-flag experiment.
 */
export const DEFAULT_MODEL: Record<JudgeArm, string> = {
    'claude-cli': 'claude-sonnet-5',
    openrouter: 'anthropic/claude-sonnet-5',
};
/**
 * Pinned, never inherited: without `--effort`, 5.5 spent 1.6k output tokens a call against 2.5k with
 * it, so the flag changes what the model does; and launchd carries no CLAUDE_EFFORT variable (the
 * session that ran ROW 0 had CLAUDE_EFFORT=high, so its "default" draws may not be the CLI default).
 */
export const DEFAULT_EFFORT = 'high';

export const VERDICT_SCHEMA = {
    type: 'object',
    properties: {
        verdicts: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    verdict: { type: 'string', enum: ['OK', 'BAD', 'UNSURE'] },
                    axis: { type: 'string', enum: ['identity', 'portion', 'none'] },
                    expected_grams: { type: ['number', 'null'] },
                    reason: { type: 'string' },
                },
                required: ['id', 'verdict', 'axis', 'expected_grams', 'reason'],
            },
        },
    },
    required: ['verdicts'],
};

export const GENERATOR_SCHEMA = {
    type: 'object',
    properties: {
        lines: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    line: { type: 'string' },
                    shape: { type: 'string', enum: ['count', 'volume', 'dictation', 'brand', 'multi', 'spanish'] },
                    foods: { type: 'integer' },
                    mutation_of: { type: ['string', 'null'] },
                },
                required: ['line', 'shape', 'foods', 'mutation_of'],
            },
        },
    },
    required: ['lines'],
};

const n1 = (x: number | null) => (x == null ? '?' : Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1));

/** The card one row shows the judge. Deterministic given the row. */
export function renderCard(r: JudgeRow): string {
    const lines = [
        `[${r.id}] line: "${r.line}"`,
        `  record: ${r.record || '(no name)'} | brand: ${r.brand || '(none)'} | ${r.source || '?'} ${r.foodId || ''}`.trimEnd(),
        `  billed: ${n1(r.grams)} g, ${n1(r.kcal)} kcal`
            + (r.kcalPer100g != null ? ` (${n1(r.kcalPer100g)} kcal/100 g)` : '')
            + (r.tier ? ` | serving tier: ${r.tier}` : ''),
        ...(r.extra ?? []).map(e => `  ${e}`),
    ];
    return lines.join('\n');
}

export function renderBatchPrompt(rows: JudgeRow[]): string {
    return `Judge these ${rows.length} rows. Return exactly one verdict per id.\n\n${rows.map(renderCard).join('\n\n')}\n`;
}

/**
 * Map a reply onto the ids that were asked. Fail closed: every asked id gets exactly one
 * verdict; a missing, duplicated-later or unreadable one is UNSURE with an `error`.
 * Ids the model invented are ignored.
 */
export function readVerdicts(raw: unknown, ids: string[]): Verdict[] {
    const list = (raw && typeof raw === 'object' && Array.isArray((raw as { verdicts?: unknown }).verdicts))
        ? (raw as { verdicts: unknown[] }).verdicts : null;
    const got = new Map<string, Verdict>();
    if (list) {
        for (const v of list) {
            if (!v || typeof v !== 'object') continue;
            const o = v as Record<string, unknown>;
            const id = String(o.id ?? '');
            if (!ids.includes(id) || got.has(id)) continue;
            const word = String(o.verdict ?? '').trim().toUpperCase();
            const eg = o.expected_grams;
            const expectedGrams = typeof eg === 'number' && Number.isFinite(eg) ? eg : null;
            if (word !== 'OK' && word !== 'BAD' && word !== 'UNSURE') {
                got.set(id, { id, verdict: 'UNSURE', axis: 'none', expectedGrams: null, reason: `unreadable verdict ${JSON.stringify(o.verdict ?? null)}`, error: 'unparseable-verdict' });
                continue;
            }
            got.set(id, { id, verdict: word, axis: String(o.axis ?? 'none'), expectedGrams, reason: String(o.reason ?? '') });
        }
    }
    return ids.map(id => got.get(id)
        ?? { id, verdict: 'UNSURE' as const, axis: 'none', expectedGrams: null, reason: list ? 'row missing from the reply' : 'no readable reply', error: list ? 'missing-row' : 'call-failed' });
}

/** argv for one `claude -p` call. The prompt goes on stdin, so a large batch never reaches argv. */
export function claudeArgs(model: string, systemPromptFile: string, schema: object, budgetUsd: number, effort?: string, maxTurns = 1): string[] {
    return [
        ...(effort ? ['--effort', effort] : []),
        '-p',
        '--model', model,
        '--max-turns', String(maxTurns),
        '--output-format', 'json',
        '--tools', '',
        '--strict-mcp-config',
        '--disable-slash-commands',
        '--no-chrome',
        '--no-session-persistence',
        '--setting-sources', '',
        '--system-prompt-file', systemPromptFile,
        '--json-schema', JSON.stringify(schema),
        '--max-budget-usd', String(budgetUsd),
    ];
}

/** Read the CLI's `--output-format json` result into (structured output, call record). */
export function readCliResult(stdout: string, model: string, purpose: CallRecord['purpose'], rows: number): { structured: unknown; call: CallRecord } {
    const call: CallRecord = {
        arm: 'claude-cli', model, purpose, rows,
        inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 0, costUsd: null, durationMs: 0,
    };
    let d: Record<string, unknown>;
    try {
        d = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
        return { structured: null, call: { ...call, error: `unreadable CLI output: ${stdout.slice(0, 160)}` } };
    }
    const u = (d.usage ?? {}) as Record<string, number>;
    call.inputTokens = Number(u.input_tokens ?? 0);
    call.cacheCreationTokens = Number(u.cache_creation_input_tokens ?? 0);
    call.cacheReadTokens = Number(u.cache_read_input_tokens ?? 0);
    call.outputTokens = Number(u.output_tokens ?? 0);
    call.costUsd = typeof d.total_cost_usd === 'number' ? d.total_cost_usd : null;
    call.durationMs = Number(d.duration_ms ?? 0);
    const seen = Object.keys((d.modelUsage ?? {}) as object);
    if (d.is_error === true || d.subtype !== 'success') {
        call.error = `CLI ${String(d.subtype ?? 'error')}: ${String(d.result ?? d.api_error_status ?? '').slice(0, 160)}`;
        return { structured: null, call };
    }
    if (!seen.includes(model)) {
        call.error = `MODEL_MISMATCH: asked ${model}, modelUsage reports ${seen.join(',') || 'nothing'}`;
        return { structured: null, call };
    }
    return { structured: d.structured_output ?? null, call };
}

function emptyCall(cfg: JudgeConfig, purpose: CallRecord['purpose'], rows: number): CallRecord {
    return { arm: cfg.arm, model: cfg.model, purpose, rows, inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 0, costUsd: null, durationMs: 0 };
}

/** One model call, either arm. Never throws: a failure is `structured: null` + `call.error`. */
export async function callModel(
    cfg: JudgeConfig, purpose: CallRecord['purpose'], systemPromptFile: string, schema: object, prompt: string, rows: number,
): Promise<{ structured: unknown; call: CallRecord }> {
    if (cfg.arm === 'claude-cli') {
        const t0 = Date.now();
        // The judge keeps the calibrated `--max-turns 1` (every ROW 0 and acceptance call
        // succeeded under it). The generator gets 3: measured 2026-09-29, a 40-line
        // generator reply ended `error_max_turns` under 1 and succeeded with
        // `num_turns: 3` — the model spends an extra structured-output turn on long
        // replies. The per-call dollar cap still bounds it.
        // A call killed mid-flight (spawnSync's timeout, which can expire across a sleep) is
        // retried ONCE, the same rule as the box's psql (retry.ts). The retry is the same call:
        // it counts once against --max-calls.
        const { result: res, retried } = withOneRetry(() => spawnSync(cfg.claudeBin, claudeArgs(cfg.model, systemPromptFile, schema, cfg.budgetPerCallUsd, cfg.effort, purpose === 'generate' ? 3 : 1), {
            cwd: cfg.cwd, input: prompt, encoding: 'utf8', timeout: cfg.timeoutMs, maxBuffer: 32 * 1024 * 1024,
        }), cfg.retryPauseMs);
        if (res.error || (res.status !== 0 && !res.stdout)) {
            return {
                structured: null,
                call: { ...emptyCall(cfg, purpose, rows), durationMs: Date.now() - t0, error: `claude exited ${res.status ?? 'null'}${retried ? ' after one retry' : ''}${res.error ? ` (${res.error.message})` : ''}: ${(res.stderr ?? '').slice(0, 160)}` },
            };
        }
        return readCliResult(res.stdout, cfg.model, purpose, rows);
    }
    const or = cfg.openrouter;
    if (!or) return { structured: null, call: { ...emptyCall(cfg, purpose, rows), error: 'openrouter arm without a key' } };
    const t0 = Date.now();
    const system = fs.readFileSync(systemPromptFile, 'utf8')
        + `\n\nAnswer with ONE JSON object, no prose and no markdown fence, matching this JSON schema:\n${JSON.stringify(schema)}`;
    try {
        const r = await postChatCompletion({ model: cfg.model, baseUrl: or.baseUrl, apiKey: or.apiKey }, system, prompt, 8000);
        const u = (r.usage ?? {}) as Record<string, number>;
        const call: CallRecord = {
            ...emptyCall(cfg, purpose, rows),
            inputTokens: Number(u.prompt_tokens ?? 0), outputTokens: Number(u.completion_tokens ?? 0),
            costUsd: typeof u.cost === 'number' ? u.cost : null, durationMs: Date.now() - t0,
        };
        if (!r.ok) return { structured: null, call: { ...call, error: `HTTP ${r.status}` } };
        try {
            return { structured: JSON.parse(r.content.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()), call };
        } catch {
            return { structured: null, call: { ...call, error: `unreadable reply: ${r.content.slice(0, 160)}` } };
        }
    } catch (e) {
        return { structured: null, call: { ...emptyCall(cfg, purpose, rows), durationMs: Date.now() - t0, error: e instanceof Error ? e.message : String(e) } };
    }
}

export interface JudgeResult {
    verdicts: Map<string, Verdict>;
    calls: CallRecord[];
    /** Rows the caps left unjudged — reported, never read as OK. */
    unjudged: string[];
}

/** Judge rows in fixed-size batches, in the order given, within the call cap. */
export async function judgeRows(rows: JudgeRow[], cfg: JudgeConfig, systemPromptFile: string): Promise<JudgeResult> {
    const verdicts = new Map<string, Verdict>();
    const calls: CallRecord[] = [];
    const per = Math.max(1, cfg.rowsPerCall);
    const batches: JudgeRow[][] = [];
    for (let i = 0; i < rows.length; i += per) batches.push(rows.slice(i, i + per));
    const run = batches.slice(0, Math.max(0, cfg.maxCalls));
    const unjudged = batches.slice(run.length).flat().map(r => r.id);
    for (const b of run) {
        const ids = b.map(r => r.id);
        const { structured, call } = await callModel(cfg, 'judge', systemPromptFile, VERDICT_SCHEMA, renderBatchPrompt(b), b.length);
        calls.push(call);
        for (const v of readVerdicts(call.error ? null : structured, ids)) {
            verdicts.set(v.id, call.error ? { ...v, reason: call.error, error: 'call-failed' } : v);
        }
    }
    return { verdicts, calls, unjudged };
}

export interface GeneratedLine { line: string; shape: string; foods: number; mutationOf: string | null }

/** Mode G's generator: ask for `n` lines, half of them mutations of `sources`. */
export async function generateLines(
    sources: string[], n: number, cfg: JudgeConfig, systemPromptFile: string,
): Promise<{ lines: GeneratedLine[]; call: CallRecord }> {
    const prompt = `Write ${n} lines.\n\nSource lines for the mutations (one per line):\n${sources.map(s => `- ${s}`).join('\n')}\n`;
    const { structured, call } = await callModel(cfg, 'generate', systemPromptFile, GENERATOR_SCHEMA, prompt, n);
    const raw = (structured as { lines?: unknown[] } | null)?.lines ?? [];
    const lines: GeneratedLine[] = [];
    const seen = new Set<string>();
    for (const x of raw) {
        const o = (x ?? {}) as Record<string, unknown>;
        const line = String(o.line ?? '').replace(/[\t\r\n]+/g, ' ').trim();
        if (!line || seen.has(line.toLowerCase())) continue;
        seen.add(line.toLowerCase());
        lines.push({
            line, shape: String(o.shape ?? ''),
            foods: Number.isInteger(o.foods) && (o.foods as number) > 0 ? (o.foods as number) : 1,
            mutationOf: typeof o.mutation_of === 'string' && o.mutation_of ? o.mutation_of : null,
        });
        if (lines.length >= n) break;
    }
    return { lines, call };
}

export function totals(calls: CallRecord[]): { calls: number; input: number; cacheCreation: number; cacheRead: number; output: number; costUsd: number; failed: number } {
    return calls.reduce((a, c) => ({
        calls: a.calls + 1,
        input: a.input + c.inputTokens,
        cacheCreation: a.cacheCreation + c.cacheCreationTokens,
        cacheRead: a.cacheRead + c.cacheReadTokens,
        output: a.output + c.outputTokens,
        costUsd: a.costUsd + (c.costUsd ?? 0),
        failed: a.failed + (c.error ? 1 : 0),
    }), { calls: 0, input: 0, cacheCreation: 0, cacheRead: 0, output: 0, costUsd: 0, failed: 0 });
}
