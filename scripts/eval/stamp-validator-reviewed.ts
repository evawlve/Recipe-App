/**
 * stamp-validator-reviewed.ts — the ONLY writer of
 * MappingValidationVerdict.reviewedAt / reviewedBy.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * validator-triage-queue.ts (the table's reader) reports the same candidates on
 * every run until someone records a decision, because nothing wrote `reviewedAt`
 * from the day the column was declared (2026-08-11) until Program Plan 9 / A3
 * (2026-08-21). "A human looked at this and routed it" was therefore a fact that
 * lived in write-offs and nowhere a script could see — which is how
 * `avocado bowl cava harissa` kept reading as an open 7/7 candidate for a week
 * after repair batch 4 had already repointed it.
 *
 * This script records the decision. It is the second half of "validator-triage
 * operating loop v1": the queue reads, a human decides, this stamps, the queue
 * reads the stamp back and drains. `reviewedAt > 0` is the program's
 * repair-intake metric (Program Plan 9 §Verification).
 *
 * ---------------------------------------------------------------------------
 * THIS IS A GRANTED WRITE
 * ---------------------------------------------------------------------------
 * Lane A's standing rule is no DB writes without a per-batch Diego grant recorded
 * in that session's write-off `grants:` frontmatter. So:
 *   - the DEFAULT is a dry run — it prints the plan and writes nothing;
 *   - `--apply` needs `--grant "<citation>"` (e.g. "D-A3 batch 1, Diego 2026-08-22"),
 *     which goes into the receipt verbatim;
 *   - every apply writes a receipt JSON (`scripts/eval/results/validator-stamps-*.json`)
 *     carrying each row's PRIOR reviewedAt/reviewedBy, and `--undo <receipt>` restores
 *     exactly those values on exactly those ids. An UPDATE has no snapshot unless
 *     you take one — this is the one (owner of that lesson: mobile
 *     reports/2026-08-11_the-head-repoint-campaign-31-of-35-fixed.md, the
 *     `_restore_rows.ts` trap).
 *
 * ---------------------------------------------------------------------------
 * WHAT A STAMP MEANS — and what it does NOT
 * ---------------------------------------------------------------------------
 * `reviewedBy` is written as `<who>:<disposition>`, disposition from a FIXED
 * vocabulary (DISPOSITIONS below — anything else is refused, exit 2). A stamp is
 * a claim about the evidence that existed when it was written: the sweep keeps
 * re-validating the hot head nightly, and the reader re-opens a stamped pair the
 * moment a fresh verdict lands (`newSinceReview`). It is not a mute — EXCEPT that
 * since 2026-09-03 (backend #412) a fresh verdict on an UNCHANGED bill is suppressed
 * at the validator for every disposition but `watch`, so in practice a stamp other
 * than `watch` re-opens only when the bill moves. `watch` is the disposition that
 * asks for more verdicts, and it still gets them.
 *
 * It touches NO other table. It never repoints, evicts, or marks — those are
 * apply-repoints.ts, the eviction snapshots, and the corrupt-mark route, each
 * with their own grant. Stamping `repoint` files intent; it does not repoint.
 *
 * Run (from the backend repo root):
 *   npx ts-node --project tsconfig.scripts.json --transpile-only \
 *     -r tsconfig-paths/register scripts/eval/stamp-validator-reviewed.ts \
 *     --form "core fairlife power" --food off_0711620020636 \
 *     --by lane-a-2026-08-21 --disposition cascade            # dry run (default)
 *   ... --batch dispositions.tsv --by lane-a-2026-08-21        # normalizedForm<TAB>foodId<TAB>disposition
 *   ... --apply --grant "D-A3 batch 1, Diego 2026-08-22"       # actually write, with the citation
 *   ... --undo scripts/eval/results/validator-stamps-<ts>.json --apply --grant "..."
 *   --force   also re-stamp rows that already carry a reviewedAt (default: skip them)
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

/**
 * Where a reviewed pair goes. Fixed, so `reviewedBy` stays queryable
 * (`split_part("reviewedBy", ':', 2)`) and a typo cannot invent a lane.
 */
export const DISPOSITIONS = {
    /** Identity wrong AND a correct record exists in some source → repair batch (apply-repoints.ts, own grant). */
    repoint: 'identity wrong, correct record exists → repair batch (apply-repoints.ts, under its own grant)',
    /** Record right, serving rung wrong → the A4 serving-axis pile. Not repoint-shaped; no cache write fixes it. */
    cascade: 'record right, serving rung wrong → A4 serving-axis pile (cascade-owned)',
    /** Record right, its own panel wrong → corruptReason mark route (own grant). */
    'corrupt-mark': 'record right, panel wrong → corrupt-mark route',
    /** The KEY is a parser artifact (e.g. a stray token) → parser fix; the cache row is a symptom. */
    'parse-artifact': 'the normalizedForm itself is a parser artifact → parser fix, not a cache repair',
    /** Identity wrong and NO correct record in any source → corpus sourcing, not repair. */
    'no-record': 'identity wrong, no correct record in any source → corpus sourcing',
    /** The SUSPECT evidence is judged noise (e.g. a minority against a clear OK majority). */
    dismiss: 'SUSPECT evidence judged noise; no action',
    /** A repair already landed (pointer moved); these verdicts are stale evidence of the old row. */
    repaired: 'repair already landed; verdicts are stale evidence of the previous pointer',
    /** Not enough evidence to route yet; look again after more sweeps. */
    watch: 'insufficient evidence; re-review after more verdicts',
} as const;

export type Disposition = keyof typeof DISPOSITIONS;

export class StampError extends Error { }

export function parseDisposition(raw: string | undefined): Disposition {
    if (raw === undefined) throw new StampError('--disposition is required.');
    const d = raw.trim();
    if (!(d in DISPOSITIONS)) {
        throw new StampError(`Unknown disposition "${raw}". One of: ${Object.keys(DISPOSITIONS).join(', ')}.`);
    }
    return d as Disposition;
}

/**
 * `who` must not contain the separator, or parseReviewedBy() in the reader would
 * split it in the wrong place and report a disposition nobody wrote.
 */
export function parseWho(raw: string | undefined): string {
    if (raw === undefined) throw new StampError('--by is required (e.g. lane-a-2026-08-21).');
    const who = raw.trim();
    if (!who) throw new StampError('--by must not be empty.');
    if (who.includes(':')) throw new StampError(`--by must not contain ':' (it is the reviewedBy separator), got "${raw}".`);
    if (/\s/.test(who)) throw new StampError(`--by must not contain whitespace, got "${raw}".`);
    return who;
}

export function reviewedByValue(who: string, disposition: Disposition): string {
    return `${who}:${disposition}`;
}

// ---------------------------------------------------------------------------
// The plan (PURE)
// ---------------------------------------------------------------------------

export interface PairRequest {
    normalizedForm: string;
    foodId: string;
    disposition: Disposition;
}

/** One verdict row as this script reads it — exactly the columns it touches or records. */
export interface StampableRow {
    id: string;
    normalizedForm: string;
    foodId: string;
    verdict: string;
    createdAt: Date;
    reviewedAt: Date | null;
    reviewedBy: string | null;
}

export interface PairPlan {
    request: PairRequest;
    reviewedBy: string;
    /** Rows that will be written. */
    stamp: StampableRow[];
    /** Rows left alone because they already carry a stamp (and --force was not given). */
    skipAlreadyStamped: StampableRow[];
    /** Rows that already carry a stamp and WILL be overwritten (--force). */
    restamp: StampableRow[];
    suspectCount: number;
    okCount: number;
}

export interface StampPlan {
    who: string;
    pairs: PairPlan[];
    /** Requests that matched NO verdict rows — refused as a whole, see planStamps(). */
    unknownPairs: PairRequest[];
    totalToWrite: number;
}

/**
 * Decide which rows get written. PURE — no DB, no clock.
 *
 * Refuses (throws StampError) when any request matches no rows: a typo in a key
 * must not produce a clean-looking "stamped 0 rows" success. Also refuses when a
 * batch names the same pair twice — two dispositions for one pair is a contradiction,
 * not a merge.
 */
export function planStamps(
    who: string,
    requests: ReadonlyArray<PairRequest>,
    rows: ReadonlyArray<StampableRow>,
    opts: { force?: boolean } = {},
): StampPlan {
    const seen = new Set<string>();
    for (const r of requests) {
        const k = `${r.normalizedForm}\n${r.foodId}`;
        if (seen.has(k)) throw new StampError(`Pair named twice: "${r.normalizedForm}" → ${r.foodId}. One disposition per pair.`);
        seen.add(k);
    }

    const byPair = new Map<string, StampableRow[]>();
    for (const row of rows) {
        const k = `${row.normalizedForm}\n${row.foodId}`;
        const hit = byPair.get(k);
        if (hit) hit.push(row);
        else byPair.set(k, [row]);
    }

    const pairs: PairPlan[] = [];
    const unknownPairs: PairRequest[] = [];
    for (const request of requests) {
        const matched = byPair.get(`${request.normalizedForm}\n${request.foodId}`) ?? [];
        if (matched.length === 0) { unknownPairs.push(request); continue; }
        const sorted = [...matched].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        const unstamped = sorted.filter(r => r.reviewedAt == null);
        const stamped = sorted.filter(r => r.reviewedAt != null);
        pairs.push({
            request,
            reviewedBy: reviewedByValue(who, request.disposition),
            stamp: opts.force ? sorted : unstamped,
            skipAlreadyStamped: opts.force ? [] : stamped,
            restamp: opts.force ? stamped : [],
            suspectCount: sorted.filter(r => r.verdict === 'SUSPECT').length,
            okCount: sorted.filter(r => r.verdict !== 'SUSPECT').length,
        });
    }
    if (unknownPairs.length > 0) {
        throw new StampError('Refusing the whole batch: no verdict rows for '
            + unknownPairs.map(p => `"${p.normalizedForm}" → ${p.foodId}`).join(', ')
            + '. Keys are the token-sorted FoodMapping form (copy them from the triage report), not the phrase.');
    }
    return { who, pairs, unknownPairs, totalToWrite: pairs.reduce((n, p) => n + p.stamp.length, 0) };
}

/**
 * `normalizedForm<TAB>foodId<TAB>disposition`, one pair per line; `#` comments and
 * blank lines ignored. Tabs, because a normalizedForm contains spaces.
 */
export function parseBatchTsv(text: string): PairRequest[] {
    const out: PairRequest[] = [];
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
        const t = line.trim();
        if (!t || t.startsWith('#')) return;
        const cols = line.split('\t').map(c => c.trim());
        if (cols.length < 3 || !cols[0] || !cols[1] || !cols[2]) {
            throw new StampError(`Batch line ${i + 1}: expected normalizedForm<TAB>foodId<TAB>disposition, got "${line}".`);
        }
        out.push({ normalizedForm: cols[0], foodId: cols[1], disposition: parseDisposition(cols[2]) });
    });
    if (out.length === 0) throw new StampError('Batch file names no pairs.');
    return out;
}

// ---------------------------------------------------------------------------
// The receipt (what --undo reads)
// ---------------------------------------------------------------------------

export interface ReceiptRow {
    id: string;
    normalizedForm: string;
    foodId: string;
    priorReviewedAt: string | null;
    priorReviewedBy: string | null;
    reviewedBy: string;
}

export interface StampReceipt {
    kind: 'validator-stamps';
    at: string;
    who: string;
    grant: string;
    force: boolean;
    reviewedAt: string;
    rows: ReceiptRow[];
}

export function buildReceipt(plan: StampPlan, at: Date, grant: string, force: boolean): StampReceipt {
    const rows: ReceiptRow[] = [];
    for (const p of plan.pairs) {
        for (const r of p.stamp) {
            rows.push({
                id: r.id,
                normalizedForm: r.normalizedForm,
                foodId: r.foodId,
                priorReviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
                priorReviewedBy: r.reviewedBy,
                reviewedBy: p.reviewedBy,
            });
        }
    }
    return { kind: 'validator-stamps', at: at.toISOString(), who: plan.who, grant, force, reviewedAt: at.toISOString(), rows };
}

export function parseReceipt(text: string): StampReceipt {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new StampError('Receipt is not JSON.'); }
    const r = parsed as Partial<StampReceipt>;
    if (!r || r.kind !== 'validator-stamps' || !Array.isArray(r.rows) || typeof r.reviewedAt !== 'string') {
        throw new StampError('Receipt is not a validator-stamps receipt (kind/rows/reviewedAt missing).');
    }
    for (const row of r.rows) {
        if (typeof row.id !== 'string' || typeof row.reviewedBy !== 'string') throw new StampError('Receipt row malformed.');
    }
    return r as StampReceipt;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function renderPlan(plan: StampPlan, opts: { apply: boolean; force: boolean }): string {
    const L: string[] = [];
    L.push('');
    L.push(`MappingValidationVerdict — stamp plan (${opts.apply ? 'APPLY' : 'DRY RUN — nothing written'})`);
    L.push('='.repeat(78));
    L.push(`  who: ${plan.who}${opts.force ? '   (--force: re-stamping already-reviewed rows)' : ''}`);
    for (const p of plan.pairs) {
        L.push(`  ${p.request.normalizedForm} → ${p.request.foodId}`);
        L.push(`      ${p.suspectCount} SUSPECT / ${p.okCount} OK · reviewedBy = "${p.reviewedBy}"`);
        L.push(`      ${DISPOSITIONS[p.request.disposition]}`);
        L.push(`      stamp ${p.stamp.length} row(s)`
            + (p.skipAlreadyStamped.length ? ` · skip ${p.skipAlreadyStamped.length} already stamped (${describeStamps(p.skipAlreadyStamped)})` : '')
            + (p.restamp.length ? ` · OVERWRITE ${p.restamp.length} prior stamp(s) (${describeStamps(p.restamp)})` : ''));
    }
    L.push(`  total rows to write: ${plan.totalToWrite}`);
    L.push('');
    return L.join('\n');
}

function describeStamps(rows: StampableRow[]): string {
    const bys = Array.from(new Set(rows.map(r => r.reviewedBy ?? '(null)')));
    return bys.join(', ');
}

// ---------------------------------------------------------------------------
// DB access (never reached by the unit tests)
// ---------------------------------------------------------------------------

export interface PrismaLike {
    mappingValidationVerdict: {
        findMany: (args: unknown) => Promise<StampableRow[]>;
        updateMany: (args: unknown) => Promise<{ count: number }>;
        update: (args: unknown) => Promise<unknown>;
    };
    $transaction: <T>(fn: (tx: PrismaLike) => Promise<T>) => Promise<T>;
    $disconnect: () => Promise<void>;
}

export function openPrisma(): PrismaLike {
    require('dotenv/config');
    const { PrismaClient } = require('@prisma/client');
    return new PrismaClient() as PrismaLike;
}

const SELECT = { id: true, normalizedForm: true, foodId: true, verdict: true, createdAt: true, reviewedAt: true, reviewedBy: true };

async function readRowsForPairs(prisma: PrismaLike, requests: PairRequest[]): Promise<StampableRow[]> {
    return prisma.mappingValidationVerdict.findMany({
        where: { OR: requests.map(r => ({ normalizedForm: r.normalizedForm, foodId: r.foodId })) },
        select: SELECT,
    });
}

async function readRowsByIds(prisma: PrismaLike, ids: string[]): Promise<StampableRow[]> {
    return prisma.mappingValidationVerdict.findMany({ where: { id: { in: ids } }, select: SELECT });
}

export function receiptPath(at: Date): string {
    const ts = at.toISOString().replace(/[:.]/g, '-');
    return path.join(__dirname, 'results', `validator-stamps-${ts}.json`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage(): void {
    console.log('Usage:');
    console.log('  stamp-validator-reviewed.ts --form "<normalizedForm>" --food <foodId> --by <who> --disposition <d> [--apply --grant "<cite>"] [--force]');
    console.log('  stamp-validator-reviewed.ts --batch <file.tsv> --by <who> [--apply --grant "<cite>"] [--force]');
    console.log('  stamp-validator-reviewed.ts --undo <receipt.json> [--apply --grant "<cite>"]');
    console.log('');
    console.log('  Dispositions:');
    for (const [k, v] of Object.entries(DISPOSITIONS)) console.log(`    ${k.padEnd(15)} ${v}`);
    console.log('');
    console.log('  DRY RUN unless --apply. --apply requires --grant (the Diego grant citation; goes in the receipt).');
    console.log('  Every apply writes scripts/eval/results/validator-stamps-<ts>.json; --undo restores the prior values.');
    console.log('  Writes ONLY reviewedAt/reviewedBy on MappingValidationVerdict. Never repoints, evicts or marks.');
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const has = (flag: string) => args.includes(flag);
    const val = (flag: string): string | undefined => {
        const i = args.indexOf(flag);
        return i >= 0 ? args[i + 1] : undefined;
    };
    if (has('--help') || has('-h') || args.length === 0) { usage(); return; }

    const apply = has('--apply');
    const force = has('--force');
    const grant = val('--grant');
    if (apply && (!grant || !grant.trim())) {
        throw new StampError('--apply requires --grant "<citation>" — this is a granted write and the receipt records the grant.');
    }

    const prisma = openPrisma();
    try {
        const at = new Date();

        if (has('--undo')) {
            const receipt = parseReceipt(fs.readFileSync(val('--undo')!, 'utf8'));
            const ids = receipt.rows.map(r => r.id);
            const current = await readRowsByIds(prisma, ids);
            const byId = new Map(current.map(r => [r.id, r]));
            const missing = ids.filter(id => !byId.has(id));
            if (missing.length) throw new StampError(`Undo refused: ${missing.length} receipt row id(s) no longer exist.`);
            const drifted = receipt.rows.filter(r => byId.get(r.id)!.reviewedBy !== r.reviewedBy);
            console.log(`\nUNDO ${receipt.rows.length} row(s) from ${path.basename(val('--undo')!)} (stamped ${receipt.reviewedAt} by ${receipt.who}, grant "${receipt.grant}")`);
            if (drifted.length) {
                console.log(`  ${drifted.length} row(s) no longer carry the receipt's reviewedBy — restamped since? Refusing; inspect by hand.`);
                process.exitCode = 2;
                return;
            }
            if (!apply) { console.log('  DRY RUN — pass --apply --grant "<cite>" to restore the prior values.'); return; }
            let n = 0;
            await prisma.$transaction(async tx => {
                for (const r of receipt.rows) {
                    await tx.mappingValidationVerdict.update({
                        where: { id: r.id },
                        data: { reviewedAt: r.priorReviewedAt ? new Date(r.priorReviewedAt) : null, reviewedBy: r.priorReviewedBy },
                    });
                    n++;
                }
            });
            console.log(`  restored ${n} row(s).`);
            return;
        }

        const who = parseWho(val('--by'));
        let requests: PairRequest[];
        if (has('--batch')) {
            requests = parseBatchTsv(fs.readFileSync(val('--batch')!, 'utf8'));
        } else {
            const form = val('--form');
            const food = val('--food');
            if (!form || !food) throw new StampError('Need --form and --food (or --batch <file.tsv>).');
            requests = [{ normalizedForm: form, foodId: food, disposition: parseDisposition(val('--disposition')) }];
        }

        const rows = await readRowsForPairs(prisma, requests);
        const plan = planStamps(who, requests, rows, { force });
        console.log(renderPlan(plan, { apply, force }));

        if (plan.totalToWrite === 0) {
            console.log('  Nothing to write: every matched row already carries a stamp. Pass --force to overwrite. Exit 2.');
            process.exitCode = 2;
            return;
        }
        if (!apply) {
            console.log('  DRY RUN — nothing written. Re-run with --apply --grant "<cite>" under a recorded grant.');
            return;
        }

        const receipt = buildReceipt(plan, at, grant!.trim(), force);
        const out = receiptPath(at);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        // Receipt BEFORE the write: if the process dies mid-transaction the prior values are on disk.
        fs.writeFileSync(out, JSON.stringify(receipt, null, 1));
        let written = 0;
        await prisma.$transaction(async tx => {
            for (const p of plan.pairs) {
                if (p.stamp.length === 0) continue;
                const res = await tx.mappingValidationVerdict.updateMany({
                    where: { id: { in: p.stamp.map(r => r.id) } },
                    data: { reviewedAt: at, reviewedBy: p.reviewedBy },
                });
                written += res.count;
            }
        });
        console.log(`  wrote ${written} row(s) at ${at.toISOString()}. Receipt: ${out}`);
        if (written !== plan.totalToWrite) {
            console.log(`  WARNING: planned ${plan.totalToWrite}, wrote ${written} — re-read the table before trusting the receipt.`);
            process.exitCode = 1;
        }
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    main().catch(err => {
        if (err instanceof StampError) {
            console.error(`\n${err.message}\nRun with --help for usage. Nothing was written.`);
            process.exit(2);
        }
        console.error(err);
        process.exit(1);
    });
}
