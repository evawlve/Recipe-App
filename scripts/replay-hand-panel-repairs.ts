/**
 * replay-hand-panel-repairs.ts — write and REPLAY hand-authored PANEL RESCALES.
 *
 * The companion to replay-hand-corrupt-marks.ts, for the case that script's
 * instrument gets wrong: a row whose panel is not junk but is written on the
 * wrong BASIS. Marking such a row deletes a correct record from the corpus and
 * hands its query to whatever ranks next. See src/lib/mapping/hand-panel-repair.ts
 * for the class, the licence (a mandatory live panel witness) and why the
 * formula alone is not evidence.
 *
 * WHY A REPLAY AND NOT A ONE-OFF UPDATE. An OFF refresh rewrites
 * `nutrientsPer100g` from the upstream dump, so a hand repair has exactly the
 * survival profile of a hand MARK: nothing re-derives it, and the 2026-07-30
 * refresh is on record destroying all 50 hand marks of the 2026-07-21 batch.
 * The authored record is git-tracked and every entry carries the measurements
 * it was authored from, so the refresh path re-runs the human's comparison
 * against the live row instead of trusting a stored conclusion.
 *
 * THE SEARCH INDEX IS PART OF THE WRITE, NOT A FOLLOW-UP. `off_foods`
 * documents store `nutrientsPer100g` as a string, so a repaired row keeps
 * billing the old panel off a search hit until its document is rewritten — and
 * a row that was corrupt-MARKED has no document at all, because
 * purge-corrupt-typesense.ts deleted it. Repair batch 6 measured the
 * symmetric failure on the mark side ("a corrupt-mark is INERT at retrieval
 * until Typesense is purged"), so the upsert runs inside --apply and its
 * failure is residue (exit 3), never a silent success. --no-typesense exists
 * for a host without the index and reports residue by construction.
 *
 * The upsert is a SINGLE DOCUMENT keyed by barcode, not a rebuild: the
 * document id IS the barcode, so the write is idempotent and a later full
 * sync-typesense.ts rebuild produces the identical document. A full rebuild is
 * Diego's call and is not needed for this class.
 *
 * Run (from the backend repo root, on a DEV MACHINE; DATABASE_URL and
 * TYPESENSE_HOST must point at the target):
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register \
 *     scripts/replay-hand-panel-repairs.ts                              # dry run
 *   ... scripts/replay-hand-panel-repairs.ts --emit-plan /tmp/panel-plan.json
 *   ... scripts/replay-hand-panel-repairs.ts --apply --plan /tmp/panel-plan.json
 *   ... scripts/replay-hand-panel-repairs.ts --apply --replay             # refresh path
 *
 * Exit codes: 0 = success or dry run; 2 = refused (nothing written);
 *             3 = applied, with residue an operator must reconcile; 1 = crash.
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import {
    HandPanelRepairEntry,
    HandPanelLiveRow,
    decideHandPanelRepair,
    readRepairLiveRow,
} from '../src/lib/mapping/hand-panel-repair';
import { buildOffIndexDoc, OffIndexRow, OFF_INDEX_DOC_COLUMNS } from '../src/lib/ops/off-index-doc';

const AUTHORED_PATH = path.join(__dirname, '..', 'src', 'lib', 'mapping', 'hand-panel-repairs.json');
const PLAN_KIND = 'hand-panel-repair';
const PLAN_VERSION = 1;

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const val = (f: string): string | undefined => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
};

const APPLY = has('--apply');
const REPLAY = has('--replay');
const PLAN_IN = val('--plan');
const EMIT_PLAN = val('--emit-plan');
const NO_TYPESENSE = has('--no-typesense');
const ONLY_BARCODE = val('--barcode');

const TS_HOST = process.env.TYPESENSE_HOST ?? 'http://localhost:8108';
const TS_KEY = process.env.TYPESENSE_API_KEY ?? '';
const COLLECTION = 'off_foods';

const prisma = new PrismaClient();

interface PlanEntry {
    barcode: string;
    seed: string;
    authoredAt: string;
    clearsMark: string | null;
    name: string;
    servingGrams: number;
    before: Record<string, number>;
    after: Record<string, number>;
    witnessBarcode: string;
    witnessPanel: Record<string, number>;
}

function sha256File(p: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function readAuthored(): HandPanelRepairEntry[] {
    const raw = JSON.parse(fs.readFileSync(AUTHORED_PATH, 'utf8'));
    if (!Array.isArray(raw)) throw new Error('hand-panel-repairs.json must be an array');
    return raw as HandPanelRepairEntry[];
}

async function liveRow(barcode: string): Promise<{ live: HandPanelLiveRow; indexRow: OffIndexRow } | null> {
    const rows = await prisma.$queryRaw<Array<OffIndexRow & { corruptReason: string | null }>>(
        Prisma.sql`
            SELECT barcode, name, "brandName", "nutrientsPer100g",
                   "servingGrams", "servingSize", categories, "corruptReason",
                   embedding::text AS embedding
            FROM "OffFood" WHERE barcode = ${barcode}
        `
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
        live: readRepairLiveRow({
            barcode: r.barcode,
            name: r.name,
            corruptReason: r.corruptReason,
            nutrientsPer100g: r.nutrientsPer100g,
            servingGrams: r.servingGrams,
        }),
        indexRow: r,
    };
}

async function typesenseUpsert(doc: Record<string, unknown>): Promise<void> {
    const res = await fetch(`${TS_HOST}/collections/${COLLECTION}/documents?action=upsert`, {
        method: 'POST',
        headers: { 'X-TYPESENSE-API-KEY': TS_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(doc),
    });
    if (!res.ok) throw new Error(`Typesense upsert failed ${res.status}: ${await res.text()}`);
}

async function typesenseHas(barcode: string): Promise<boolean> {
    const res = await fetch(`${TS_HOST}/collections/${COLLECTION}/documents/${encodeURIComponent(barcode)}`, {
        headers: { 'X-TYPESENSE-API-KEY': TS_KEY },
    });
    return res.ok;
}

function fmtPanel(p: Record<string, number>): string {
    return Object.keys(p).sort().map(k => `${k}=${Number(p[k].toFixed(6))}`).join(' ');
}

async function main(): Promise<number> {
    if (APPLY && !PLAN_IN && !REPLAY) {
        console.error('REFUSED: --apply needs either --plan <approved.json> (first write) or --replay (refresh path).');
        return 2;
    }
    if (APPLY && PLAN_IN && REPLAY) {
        console.error('REFUSED: --plan and --replay are different approval records; pass exactly one.');
        return 2;
    }

    const authoredSha = sha256File(AUTHORED_PATH);
    let entries = readAuthored();
    if (ONLY_BARCODE) entries = entries.filter(e => e.barcode === ONLY_BARCODE);

    let plan: { authoredSha256: string; entries: PlanEntry[] } | null = null;
    if (PLAN_IN) {
        const p = JSON.parse(fs.readFileSync(PLAN_IN, 'utf8'));
        if (p.planKind !== PLAN_KIND || p.planVersion !== PLAN_VERSION) {
            console.error(`REFUSED: ${PLAN_IN} is not a ${PLAN_KIND} v${PLAN_VERSION} plan.`);
            return 2;
        }
        if (p.authoredSha256 !== authoredSha) {
            console.error('REFUSED: hand-panel-repairs.json has changed since this plan was emitted.');
            console.error(`  plan: ${p.authoredSha256}`);
            console.error(`  file: ${authoredSha}`);
            return 2;
        }
        plan = p;
    }

    console.log(`hand-panel-repair replay ${APPLY ? (REPLAY ? '(APPLY --replay)' : '(APPLY --plan)') : '(DRY RUN)'}`);
    console.log(`  authored record : ${AUTHORED_PATH}`);
    console.log(`  sha256          : ${authoredSha}`);
    console.log(`  entries         : ${entries.length}`);
    console.log('');

    const planEntries: PlanEntry[] = [];
    let written = 0;
    let residue = 0;
    const skipped: string[] = [];

    for (const entry of entries) {
        const target = await liveRow(entry.barcode);
        const witness = entry.witness ? await liveRow(entry.witness.barcode) : null;
        const decision = decideHandPanelRepair(entry, target?.live ?? null, witness?.live ?? null);

        if (!decision.repair) {
            console.log(`SKIP  ${entry.barcode}  ${entry.seed}  -> ${decision.skip}${decision.detail ? ` (${decision.detail})` : ''}`);
            skipped.push(`${entry.barcode}:${decision.skip}`);
            continue;
        }

        const before = target!.live.panel;
        const after = decision.panel;
        console.log(`REPAIR ${entry.barcode}  ${entry.seed}   servingGrams=${target!.live.servingGrams}`);
        console.log(`   before : ${fmtPanel(before)}`);
        console.log(`   after  : ${fmtPanel(after)}`);
        console.log(`   witness: ${entry.witness.barcode}  ${fmtPanel(witness!.live.panel)}`);
        console.log(`   clears : ${entry.clearsMark ?? '(no mark)'}`);

        const pe: PlanEntry = {
            barcode: entry.barcode,
            seed: entry.seed,
            authoredAt: entry.authoredAt,
            clearsMark: entry.clearsMark,
            name: target!.live.name,
            servingGrams: target!.live.servingGrams!,
            before,
            after,
            witnessBarcode: entry.witness.barcode,
            witnessPanel: witness!.live.panel,
        };
        planEntries.push(pe);

        if (!APPLY) continue;

        // --plan is an approval of a SET. A barcode the plan does not list is
        // refused even though the authored file names it.
        if (plan) {
            const approved = plan.entries.find(x => x.barcode === entry.barcode);
            if (!approved) {
                console.log(`   REFUSED: not in the approved plan.`);
                residue++;
                continue;
            }
            // Plan drift: the write is RECOMPUTED above from the live row and
            // must agree with what was approved. A hand-edited "after" cannot
            // reach the database.
            const keys = Object.keys(after).sort();
            const drift = keys.find(k => !(Math.abs(after[k] - (approved.after[k] ?? NaN)) <= 1e-9));
            if (drift || keys.join(',') !== Object.keys(approved.after).sort().join(',')) {
                console.log(`   REFUSED: plan drift on ${drift ?? 'field set'}.`);
                residue++;
                continue;
            }
        }

        const data: Prisma.OffFoodUpdateInput = { nutrientsPer100g: after as Prisma.InputJsonValue };
        if (entry.clearsMark !== null) data.corruptReason = null;
        await prisma.offFood.update({ where: { barcode: entry.barcode }, data });
        written++;
        console.log(`   WROTE  panel${entry.clearsMark !== null ? ' + cleared corruptReason' : ''}`);

        // The refresh chain runs this stage BEFORE its full sync-typesense.ts
        // rebuild, which reindexes every row from Postgres. Upserting here
        // would be redundant and can race a collection being recreated, so the
        // replay path skips it deliberately — and says so, because "the index
        // was not touched" must never be inferred from silence.
        if (REPLAY) {
            console.log(`   INDEX  skipped (--replay: the refresh chain's sync-typesense.ts rebuild follows and reindexes this row).`);
            continue;
        }
        if (NO_TYPESENSE) {
            console.log(`   RESIDUE: --no-typesense, the ${COLLECTION} document still carries the OLD panel (or is absent).`);
            residue++;
            continue;
        }
        try {
            const fresh = await liveRow(entry.barcode);
            await typesenseUpsert(buildOffIndexDoc(fresh!.indexRow));
            const present = await typesenseHas(entry.barcode);
            console.log(`   INDEX  upserted ${COLLECTION}/${entry.barcode} (present=${present})`);
            if (!present) residue++;
        } catch (e) {
            console.log(`   RESIDUE: Typesense upsert failed — ${(e as Error).message}`);
            residue++;
        }
    }

    console.log('');
    console.log('--------------------------------------------------');
    console.log(`  repairs decided : ${planEntries.length}`);
    console.log(`  skipped         : ${skipped.length}${skipped.length ? ` (${skipped.join(', ')})` : ''}`);
    if (APPLY) {
        console.log(`  rows written    : ${written}`);
        console.log(`  residue         : ${residue}`);
    }

    if (EMIT_PLAN) {
        const out = {
            planKind: PLAN_KIND,
            planVersion: PLAN_VERSION,
            at: new Date().toISOString(),
            authoredSha256: authoredSha,
            entries: planEntries,
            skipped,
            snapshot: {
                pre: `COPY (SELECT barcode, "corruptReason", "nutrientsPer100g", "servingGrams", "updatedAt" FROM "OffFood" WHERE barcode IN (${planEntries.map(e => `'${e.barcode}'`).join(',') || `''`}) ORDER BY barcode) TO STDOUT WITH (FORMAT csv, HEADER)`,
                post: `COPY (SELECT barcode, "corruptReason", "nutrientsPer100g", "servingGrams", "updatedAt" FROM "OffFood" WHERE barcode IN (${planEntries.map(e => `'${e.barcode}'`).join(',') || `''`}) ORDER BY barcode) TO STDOUT WITH (FORMAT csv, HEADER)`,
            },
        };
        fs.writeFileSync(EMIT_PLAN, JSON.stringify(out, null, 1));
        console.log(`  plan written    : ${EMIT_PLAN}`);
    }

    if (!APPLY) return 0;
    return residue > 0 ? 3 : 0;
}

main()
    .then(async code => { await prisma.$disconnect(); process.exit(code); })
    .catch(async err => { console.error(err); await prisma.$disconnect(); process.exit(1); });
