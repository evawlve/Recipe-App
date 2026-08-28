/**
 * write-policy.ts — request-scoped write suppression (P6).
 *
 * WHAT THIS ANSWERS: "for the duration of THIS request, is a given class of computed row
 * allowed to be persisted, and if it was refused, which rows were they and did the writers
 * ever ask?" It is the chokepoint that lets `/api/nlp/parse?nosave=1` mean the wide thing —
 * "this request persists nothing it computed" — without threading a policy argument through
 * the twelve production call sites of `hydrateAndSelectServing()` and the one site inside
 * `build-fatsecret-result.ts` that no such argument can reach.
 *
 * WHAT IT DOES NOT ANSWER: anything about writes that no writer routed through it. A table
 * this module has never heard of is not protected by it. The closed union below is the
 * complete list of what `nosave` suppresses; `MappingEventLog`, the FoodMapping `usedCount`
 * bumps, `FatSecretFood`, `AiGeneratedFood` and `LearnedSynonym` are deliberately outside
 * it — see the owner doc. The OFF mirror was too until 2026-08-27, when `offMirror` brought
 * `OffFood`/`OffServing` in for the ONE request that asks for them: `/api/foods/barcode`,
 * whose only two write sites they are. The mapping lane reaches the same writer through
 * `buildOffResult()` and does NOT ask, so `/api/nlp/parse?nosave=1` mirrors OFF exactly as
 * it did before.
 *
 * FOUR DESIGN CONSTRAINTS, EACH LOAD-BEARING
 *
 * 1. IMPORTS ONLY `node:async_hooks`. No dotenv, no prisma, no `../mapping/config`. Every
 *    writer in the mapping graph and the route itself both import this module, so it must be
 *    free to import from anywhere without dragging a dependency graph behind it. Same rule as
 *    `src/lib/ai/llm-usage-metrics.ts`, and for the same reason.
 *
 * 2. THE `AsyncLocalStorage` INSTANCE LIVES ON `globalThis`, UNCONDITIONALLY. Note that
 *    `src/lib/db.ts` puts its prisma singleton on `globalThis` only when
 *    `NODE_ENV !== 'production'`. Do NOT copy that pattern here. The deployed Next build
 *    demonstrably emits `src/lib/**` modules into more than one server chunk (measured
 *    2026-08-17: `logicalSuccesses` from `llm-usage-metrics.ts` appears in BOTH
 *    `.next/server/chunks/2130.js` and `.next/server/app/api/ok/route.js`). A module-local
 *    instance could therefore be a DIFFERENT one in the route's chunk from the writer's:
 *    the writer would read no store and WRITE — a fail-open in the expensive direction, and
 *    one jest cannot reproduce because jest does not bundle. The live falsifier is the arm:
 *    a receipt that names a refusal while the row still lands.
 *
 * 3. `consulted` IS THE INSTRUMENT, NOT A STATISTIC. `refused: []` alone cannot tell
 *    "the policy refused nothing" from "no writer ever saw the policy" — which is exactly the
 *    fail-open constraint 2 exists to catch. `isWriteSuppressed()` therefore increments
 *    `consulted` EVERY time it finds a store, including when it answers `false`. Read it that
 *    way: **`consulted === 0` on a response that also carries an AI serving tier is a
 *    structural RED, never a green.** It means the writers and the route are looking at two
 *    different stores (or the guards were removed), and "no rows were refused" is then a
 *    statement about nothing. A real "the policy refused nothing" reading is
 *    `consulted > 0 && refusedTotal === 0`.
 *
 * 4. A CAPPED SAMPLE AND AN EXACT COUNT MUST NOT READ ALIKE. Every field on the receipt is one
 *    of exactly two kinds and the doc-check claims quote the kind:
 *      EXACT  — `consulted`, `refusedTotal`. Counted at the call, never sampled, never reset.
 *      SAMPLE — `refused`, capped at REFUSAL_SAMPLE_CAP entries. It is evidence of WHICH rows
 *               were refused, not of HOW MANY: a 60-line request that refused 60 writes ships
 *               50 entries and `refusedTotal: 60`. Never derive a count from `refused.length`;
 *               that is the `SERVING_AI_TIERS` upper-bound-read-as-a-count defect one layer
 *               down. The cap also keeps the receipt inside a response HEADER
 *               (`X-Write-Receipt`), where the practical budget is single-digit kilobytes.
 *
 * SCOPE SEMANTICS. `runWithWritePolicy()` nests: a child inherits the parent's suppressed
 * kinds, stamps its own `line` onto every refusal it records, and SHARES the parent's
 * `refused` array and `counters` object so one read at the top of the request sees everything
 * every item did. Suppression is monotonic — a nested run may add kinds, never remove them, so
 * no inner frame can un-suppress what the request asked to suppress.
 *
 * Outside any `runWithWritePolicy()` there is no store: `isWriteSuppressed()` is `false`,
 * `noteRefusedWrite()` is a no-op and `currentWriteReceipt()` is `null`. That is what keeps
 * every script, every other route and every warm-cache job behaving exactly as before.
 *
 * Owner doc: mobile:sync-docs/reports/2026-08-17_request-scoped-write-suppression-design.md
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The closed set of write classes a request may suppress.
 *
 * `foodMapping` is deliberately NOT a member: the FoodMapping write is already gated by the
 * `skipSave` option on `mapIngredientWithFallback()`, that path works and is claimed, and
 * moving it here would buy nothing. A new class is a new member of this union plus a guard at
 * its writer — never a widening of the meaning of an existing one.
 *
 * `offMirror` (2026-08-27) is the OffFood + OffServing upsert pair inside
 * `hydrateOffCandidate()`, added for `/api/foods/barcode?nosave=1` — a device sitting must be
 * able to scan without leaving rows, and those two upserts are that route's ENTIRE write
 * surface (measured: its FatSecret branch calls `ensureFoodCached` with no `client`, which
 * is the only door to `upsertFoodFromDetails()`). Named for the write class and not for the
 * route, because the same writer serves the mapping lane. Note what refusing it costs, which
 * is why no other caller asks: `resolveFoodDetails()` reads OffFood, so refusing the mirror
 * for a barcode we have never seen makes that product unanswerable for the rest of the
 * request. The OffServing row is the half that would outlive it either way — a label-derived
 * serving the cascade reads, the class the 2026-08-02 batch-rollback report measured moving
 * `15 pretzels` from 105 g to 45 g.
 */
export type SuppressibleWrite = 'aiServing' | 'segmentationCache' | 'offMirror';

/** One refused write. `line` is present when the refusal happened inside a per-line scope. */
export interface WriteRefusal {
    kind: SuppressibleWrite;
    /** The table the row would have landed in, as the writer names it. */
    table: string;
    /** Enough of the row's identity to find it — e.g. `fdc_747997:1 cup`. */
    key: string;
    /** The raw input line whose mapping refused this write, when the scope carried one. */
    line?: string;
}

/** Shared across a request and every nested per-line scope. See constraint 3. */
interface WritePolicyCounters {
    /** EXACT. `isWriteSuppressed()` calls that found a store — the fail-open detector. */
    consulted: number;
    /** EXACT. `noteRefusedWrite()` calls that found a store, uncapped. */
    refusedTotal: number;
}

interface WritePolicyStore {
    suppress: Set<SuppressibleWrite>;
    /** Shared by reference with every nested scope; capped at REFUSAL_SAMPLE_CAP. */
    refused: WriteRefusal[];
    /** The raw line this scope is mapping, stamped onto refusals recorded under it. */
    line?: string;
    /** Shared by reference with every nested scope. */
    counters: WritePolicyCounters;
}

/**
 * What the route echoes on `X-Write-Receipt`. `consulted`/`refusedTotal` are EXACT;
 * `refused` is a CAPPED SAMPLE of at most `refusedCap` entries. See constraint 4.
 */
export interface WriteReceipt {
    /** The kinds this request suppressed. Empty means the policy was active but suppressed nothing. */
    suppress: SuppressibleWrite[];
    /** EXACT. Zero here alongside an AI serving tier is a structural RED — see constraint 3. */
    consulted: number;
    /** EXACT. The number of writes actually refused, whether or not they fit in the sample. */
    refusedTotal: number;
    /** CAPPED SAMPLE — evidence of which, never a count. Read `refusedTotal` for how many. */
    refused: WriteRefusal[];
    /** The cap `refused` was truncated at, so a reader can see the sample is a sample. */
    refusedCap: number;
}

/** Sample cap for `refused`. `refusedTotal` stays exact past it. */
export const REFUSAL_SAMPLE_CAP = 50;

/** Module-private key on globalThis. See constraint 2 for why this is not a module-local const. */
const ALS_KEY = '__recipeAppWritePolicyAls__';

/**
 * The one AsyncLocalStorage instance for this process, created on first use and held on
 * `globalThis` so a second copy of this module (a second server chunk) shares it rather than
 * silently starting its own — which would make every writer in that chunk fail OPEN.
 */
function als(): AsyncLocalStorage<WritePolicyStore> {
    const g = globalThis as unknown as Record<string, AsyncLocalStorage<WritePolicyStore> | undefined>;
    let instance = g[ALS_KEY];
    if (!instance) {
        instance = new AsyncLocalStorage<WritePolicyStore>();
        g[ALS_KEY] = instance;
    }
    return instance;
}

export interface WritePolicyOptions {
    /** Kinds to refuse for the duration of `fn`. Added to whatever an enclosing scope suppressed. */
    suppress: SuppressibleWrite[];
    /** The raw line this scope maps, stamped onto refusals recorded under it. */
    line?: string;
}

/**
 * Run `fn` under a write policy. Returns whatever `fn` returns (so an async `fn` gives back its
 * promise unchanged) — the store survives `await`, `Promise.all`, timers and dynamic `import()`,
 * and a caller awaiting ANOTHER scope's promise keeps its OWN store, which is what makes the
 * mapper's in-flight lock safe: a real request that waits on a `nosave` request's lock re-reads
 * the cache and does its own mapping under its own policy.
 *
 * Nesting: the child inherits the parent's suppressed kinds (monotonic — a nested `suppress: []`
 * cannot un-suppress), stamps its own `line`, and shares the parent's `refused` array and
 * `counters` object.
 */
export function runWithWritePolicy<T>(options: WritePolicyOptions, fn: () => T): T {
    const parent = als().getStore();
    const suppress = new Set<SuppressibleWrite>(parent ? parent.suppress : []);
    for (const kind of options.suppress) suppress.add(kind);

    const store: WritePolicyStore = {
        suppress,
        refused: parent ? parent.refused : [],
        line: options.line ?? parent?.line,
        counters: parent ? parent.counters : { consulted: 0, refusedTotal: 0 },
    };

    return als().run(store, fn);
}

/**
 * Is this class of write refused for the current request?
 *
 * Counts a consultation whenever a store exists — INCLUDING when the answer is `false`. That
 * count is the only way a reader can tell "the policy refused nothing" from "the writers never
 * saw the policy" (constraint 3). Outside any policy this is `false` and counts nothing, which
 * is what leaves scripts, other routes and warm-cache jobs untouched.
 */
export function isWriteSuppressed(kind: SuppressibleWrite): boolean {
    const store = als().getStore();
    if (!store) return false;
    store.counters.consulted++;
    return store.suppress.has(kind);
}

/**
 * Record that a write was refused. A no-op outside any policy.
 *
 * `refusedTotal` is bumped every time; the `refused` sample stops growing at
 * REFUSAL_SAMPLE_CAP so the receipt stays inside a response header.
 */
export function noteRefusedWrite(kind: SuppressibleWrite, table: string, key: string): void {
    const store = als().getStore();
    if (!store) return;
    store.counters.refusedTotal++;
    if (store.refused.length < REFUSAL_SAMPLE_CAP) {
        store.refused.push(store.line ? { kind, table, key, line: store.line } : { kind, table, key });
    }
}

/**
 * The receipt for the current request, or `null` outside any policy. The route reads this once,
 * after `Promise.all`, and echoes it on `X-Write-Receipt`. Copies the sample so a reader cannot
 * mutate the live store.
 */
export function currentWriteReceipt(): WriteReceipt | null {
    const store = als().getStore();
    if (!store) return null;
    return {
        suppress: Array.from(store.suppress).sort(),
        consulted: store.counters.consulted,
        refusedTotal: store.counters.refusedTotal,
        refused: store.refused.slice(0, REFUSAL_SAMPLE_CAP).map((r) => ({ ...r })),
        refusedCap: REFUSAL_SAMPLE_CAP,
    };
}
