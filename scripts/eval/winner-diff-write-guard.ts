/**
 * winner-diff-write-guard.ts — the Prisma write guard behind winner-diff's READ-ONLY
 * promise.
 * ==========================================================================
 * No import of any kind and no PrismaClient. `winner-diff.ts` installs it on the
 * `@/lib/db` singleton; `__tests__/winner-diff.test.ts` pins it against fixture
 * middleware params, which it could not do while the guard lived in the runner
 * (importing the runner constructs a PrismaClient — see `winner-diff-screens.ts`).
 *
 * WHAT IT NO-OPS — everything else goes to `next`, untouched:
 *   1. every `params.action` in `MUTATING`: the mutating model actions plus
 *      executeRaw/executeRawUnsafe. Tally key `<model>.<action>`, or
 *      `raw.<action>` when the action has no model.
 *   2. every `params.action` in `RAW_ACTIONS` (queryRaw, queryRawUnsafe) whose SQL
 *      text, as `rawSqlOf()` reads it, matches `MUTATING_SQL`. Tally key
 *      `raw.<action>:MUTATING`.
 *
 * WHY (2) EXISTS. Prisma reports `$queryRaw` as a read action, so a guard keyed on
 * the action alone cannot see a write issued through it — and the mapper issues one
 * on every normalize-cache lookup. `getAiNormalizeCache()` reads through
 * `touchAndFetchCacheRow()` in `src/lib/mapping/validated-mapping-helpers.ts`, which
 * tries a raw `UPDATE "AiNormalizeCache" SET "useCount" = "useCount" + 1,
 * "lastUsedAt" = now() … RETURNING *` FIRST, and falls back to `findUnique` plus
 * `aiNormalizeCache.update()` only when that statement throws. A guard made of (1)
 * alone matches the fallback's `update` and never the raw statement. The inspection
 * is ported from the Lane A S49 composite arm (`s49row3_pinned_composite_arm.ts`),
 * which found the hole.
 *
 * WHY A NO-OPED MUTATING RAW QUERY RETURNS `null`, NOT `[]`.
 * `touchAndFetchCacheRow()` reads `rows[0]` inside its own try/catch. `null` makes
 * that read throw; the catch demotes the process to the fallback for good (logging
 * `ai_normalize_cache.raw_touch_unsupported` once per process — expected under this
 * guard, not a driver fault), where `findUnique` — a read — passes and `update` is
 * suppressed by (1). A genuine cache
 * HIT therefore still reaches the caller and only the usage bump is lost. `[]` would
 * read as a MISS (`rows[0] ?? null`) and send the line to the LLM, so a snapshot
 * would differ from what production serves.
 *
 * WHY NOTHING THROWS. A throw out of the fallback's `update` escapes
 * `touchAndFetchCacheRow()` into `getAiNormalizeCache()`'s try/catch, which returns
 * `null`: the HIT becomes a MISS and `aiNutritionEstimate`/`isBrandedQuery` vanish
 * from the snapshot.
 *
 * WHAT IT CANNOT SEE — a zero tally is not proof that nothing was written:
 *   - a mutating statement that does not OPEN with a `MUTATING_SQL` verb (a
 *     `WITH … UPDATE` CTE, a leading SQL comment, `MERGE`, `COPY`, `CALL`/`DO`,
 *     `SELECT … INTO`, `SELECT nextval()`/`setval()`) — none is reachable from the
 *     code winner-diff runs on 2026-09-14, by a grep of `$queryRaw`/`$executeRaw`
 *     over `src/`;
 *   - an args shape `rawSqlOf()` does not recognise: its fallback is a JSON dump the
 *     anchored `MUTATING_SQL` cannot match, so that statement PASSES;
 *   - any client other than the one it is installed on.
 */

/** Actions no-oped outright: the mutating model actions and the raw executes. */
export const MUTATING: ReadonlySet<string> = new Set([
    'create', 'createMany', 'createManyAndReturn', 'update', 'updateMany',
    'upsert', 'delete', 'deleteMany', 'executeRaw', 'executeRawUnsafe',
]);

/** Raw READ actions: inspected, and no-oped only when the statement mutates. */
export const RAW_ACTIONS: ReadonlySet<string> = new Set(['queryRaw', 'queryRawUnsafe']);

/** A statement that opens with a mutating verb, in any case, after any whitespace. */
export const MUTATING_SQL = /^\s*(UPDATE|INSERT|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/i;

/** The slice of a Prisma middleware's `params` the guard reads. */
export interface GuardParams {
    action: string;
    model?: string;
    args?: unknown;
}

/** Called once per suppressed operation, with its tally key. */
export type SuppressTally = (key: string) => void;

/**
 * `any` at the Prisma seam only: a PrismaClient's `$use` takes `Prisma.Middleware`,
 * whose `next` is typed on Prisma's own params rather than on `GuardParams`.
 */
export type WriteGuardMiddleware = (params: GuardParams, next: (params: any) => Promise<any>) => Promise<any>;

function stringField(value: unknown, key: 'sql' | 'text'): string | null {
    if (typeof value !== 'object' || value === null) return null;
    const field = (value as Record<string, unknown>)[key];
    return typeof field === 'string' ? field : null;
}

function joinedStrings(value: unknown): string | null {
    if (typeof value !== 'object' || value === null) return null;
    const strings = (value as Record<string, unknown>).strings;
    return Array.isArray(strings) ? strings.join(' ') : null;
}

/** Best-effort read of the SQL text out of a raw action's middleware `params.args`. */
export function rawSqlOf(args: unknown): string {
    try {
        if (!args) return '';
        if (typeof args === 'string') return args;
        if (Array.isArray(args)) {
            const first: unknown = args[0];
            if (typeof first === 'string') return first;
            const firstStrings = joinedStrings(first);
            if (firstStrings !== null) return firstStrings;
            if (Array.isArray(first)) return first.join(' ');   // a template strings array
            const firstText = stringField(first, 'sql') ?? stringField(first, 'text');
            if (firstText !== null) return firstText;
        }
        const argsText = stringField(args, 'sql') ?? joinedStrings(args);
        if (argsText !== null) return argsText;
        return JSON.stringify(args).slice(0, 400);
    } catch {
        return '';
    }
}

/** The `$use` middleware. `onSuppress` is read at call time, once per suppressed operation. */
export function createWriteGuardMiddleware(onSuppress: SuppressTally): WriteGuardMiddleware {
    return async (params, next) => {
        if (MUTATING.has(params.action)) {
            onSuppress(`${params.model ?? 'raw'}.${params.action}`);
            return null;   // NO-OP, never throw — see the header
        }
        if (RAW_ACTIONS.has(params.action) && MUTATING_SQL.test(rawSqlOf(params.args))) {
            onSuppress(`raw.${params.action}:MUTATING`);
            return null;   // null, not [] — see the header
        }
        return next(params);
    };
}

/** Install the guard on a client. */
export function installWriteGuard(
    prisma: { $use(middleware: WriteGuardMiddleware): void },
    onSuppress: SuppressTally,
): void {
    prisma.$use(createWriteGuardMiddleware(onSuppress));
}
