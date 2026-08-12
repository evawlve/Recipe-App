/**
 * apply-repoints.ts — data-ops batch repoint of FoodMapping cache rows.
 *
 * Input: a JSON array of { seed, target, class, severity, wasFood } entries
 * (produced from a triage run — e.g. repoints-2026-07-20.json, generated from
 * the 2026-07-20 warm-cache-triage multi-agent audit). For each entry the
 * script computes the cache key with the pipeline's own canonicalizeCacheKey,
 * validates the target record exists (OffFood / FdcFood / FatSecretFood) and
 * has nutrition, then upserts the row pointing at the target with validatedBy
 * 'human-triage'.
 *
 * Rows are UPDATEd when the seed already has a cache row and CREATEd when it
 * doesn't (pre-validating seeds that were below the 0.85 confidence save
 * threshold, or whose picks the save gates rejected). Dry-run by default.
 *
 * A REPOINT DOES NOT SELF-HEAL, IN EITHER DIRECTION. This header used to say a
 * later live request could overwrite a repointed row through
 * saveValidatedMapping's upsert. That is no longer true and predates the
 * write-guard: saveValidatedMapping() now returns early on any row whose
 * validatedBy is 'human-triage', and getValidatedMappingByNormalizedName()
 * grants those rows read-time trust through isTrustedHumanRow(), which skips
 * six name-heuristic rejections that would otherwise discard the row. So a
 * WRONG aim is as sticky as a right one, and the only exit is re-running this
 * script. That is why --apply refuses without --snapshot: the snapshot is the
 * restore anchor, and there is no staging copy of this database.
 *
 * THE NUTRITION GUARD ASKS PRODUCTION'S QUESTION, NOT ITS OWN. Until
 * 2026-08-12 every branch read kcal from `nutrientsPer100g` alone and SKIPped
 * the row when it was absent. For FatSecret that is the wrong test: an empty
 * per-100g panel is not "no nutrition". persistFatSecretHits() in
 * src/lib/mapping/fatsecret-lane.ts writes `nutrientsPer100g: (per100 ?? {})`,
 * and FatSecret's generic chain-restaurant records are exactly the shape
 * `{}` + a single macro-bearing `1 serving` / `1 can` row with no grams.
 * buildFatSecretResult() bills those directly — it refuses a record only when
 * `!per100 && !anyServingHasMacros` — so the script was refusing rows
 * production serves every day. Measured 2026-08-12: 3,472 of 24,123
 * FatSecretFood rows (14.4%) carry an empty panel; re-derive with
 *   SELECT count(*) FILTER (WHERE "nutrientsPer100g"::text = '{}'), count(*)
 *     FROM "FatSecretFood";
 * That refusal, not a missing panel, is what killed repair batch 1's
 * `claw mango white` row (owner:
 * sync-docs/reports/2026-08-12_repair-batch-2-executed.md §4, mobile repo).
 * fsServingKcalBasis() below now supplies the fallback, and it reads the
 * serving Json through servingMacros() — the SAME function the lane bills
 * from — rather than re-deriving it (playbook §11 class A). OffFood and
 * FdcFood keep the panel-only test on purpose: neither production read path
 * has a per-serving macro source to fall back to.
 *
 * A serving-basis plan reports kcal PER SERVING, never per 100 g, and it
 * cannot predict billed grams: those come from the serving cascade, which
 * chose a rung nobody predicted on batch 2's `stevia`. A newly-unblocked row
 * still needs a verification draw.
 *
 * Target vocabulary is an EXPLICIT ALLOWLIST — off_ / fdc_ / fs_ — and an
 * unrecognised prefix fails the whole run before any DB work. It used to be one
 * `startsWith('off_')` test with an unguarded fall-through that treated
 * everything else as FDC, which meant `fs_4513` was read as FdcFood 513: note
 * the prefix widths differ (`fs_` is three characters, the other two are four),
 * so the fall-through also ate a digit. That never corrupted anything in
 * practice — none of the mangled ids happened to exist in FdcFood, which holds
 * only 4,133 rows — but it was luck, not a guard, and it is now a guard.
 *
 * Run (from repo root, DATABASE_URL must point at the target DB):
 *   npx ts-node --transpile-only --compilerOptions '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/eval/apply-repoints.ts --file scripts/eval/repoints-2026-07-20.json
 *   # then, to write:
 *   npx ts-node ... scripts/eval/apply-repoints.ts --file <f> \
 *     --snapshot snapshots/FoodMapping-pre-repoint-<date>.json --apply
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { canonicalizeCacheKey } from '../../src/lib/mapping/normalization-rules';
import { servingMacros } from '../../src/lib/mapping/fs-serving-macros';

const prisma = new PrismaClient();

export interface Repoint {
    seed: string;
    target: string;     // off_<barcode> | fdc_<digits> | fs_<digits>
    class: string;
    severity: string;
    wasFood: string;
    /**
     * Explicit cache-key override (pre-canonicalize). Use when the pipeline's
     * normalization rewrites the seed to a different lookup key — telemetry
     * (MappingEventLog.normalizedForm) is the authority, e.g. "bell pepper"
     * resolves under "capsicum", "shrimp" under "prawns".
     */
    key?: string;
}

export interface Plan {
    seed: string;
    key: string;
    action: 'UPDATE' | 'CREATE' | 'SKIP';
    reason?: string;
    oldFood?: string;
    newFood?: string;
    newBrand?: string | null;
    kcal100?: number | null;
    /**
     * Set ONLY when the target's per-100g panel carries no kcal and the plan's
     * nutrition evidence is a serving row instead (the FatSecret empty-panel
     * shape — see the header). Deliberately ABSENT, not null, on every
     * panel-backed plan: a row that planned before this field existed must
     * serialize byte-identically after it, so the dry-run parity diff that
     * gates this change can only show newly-unblocked rows.
     *
     * `kcal` here is PER SERVING. It is not interchangeable with kcal100 and
     * the printer labels the two differently for that reason.
     */
    servingBasis?: { kcal: number; servingId: string; description: string };
    target: string;
    source?: string;
    offBarcode?: string | null;
    fdcId?: number | null;
    fsId?: string | null;
}

/**
 * The three record namespaces this script can resolve. Parsed by an explicit
 * allowlist so an unknown prefix can never be silently reinterpreted as one of
 * these — see the header. `fs_` ids are digits: all 24,123 FatSecretFood rows
 * match ^[0-9]+$ (measured 2026-08-11; re-derive with
 *   SELECT count(*) FILTER (WHERE "fsId" !~ '^[0-9]+$') FROM "FatSecretFood";
 * which returns 0). If FatSecret ever issues a non-numeric id the parse fails
 * loudly here rather than resolving the wrong record.
 */
export type TargetRef =
    | { kind: 'off'; barcode: string }
    | { kind: 'fdc'; fdcId: number }
    | { kind: 'fs'; fsId: string };

export function parseTargetRef(target: string): TargetRef | null {
    if (typeof target !== 'string') return null;
    // Ordered longest-prefix-first is not needed (the three are disjoint), but
    // each branch validates its own payload shape so a truncated or malformed
    // id is a parse failure rather than a lookup miss.
    if (target.startsWith('off_')) {
        const barcode = target.slice(4);
        return /^[A-Za-z0-9._-]+$/.test(barcode) ? { kind: 'off', barcode } : null;
    }
    if (target.startsWith('fdc_')) {
        const rest = target.slice(4);
        return /^[0-9]+$/.test(rest) ? { kind: 'fdc', fdcId: parseInt(rest, 10) } : null;
    }
    if (target.startsWith('fs_')) {
        const fsId = target.slice(3);
        return /^[0-9]+$/.test(fsId) ? { kind: 'fs', fsId } : null;
    }
    return null;
}

/** nutrientsPer100g JSON stores energy as "calories" (schema comment says kcal — stale). */
export function readKcal(nutrients: unknown): number | null {
    const n = nutrients as { calories?: number; kcal?: number } | null;
    const v = n?.calories ?? n?.kcal;
    return typeof v === 'number' ? v : null;
}

/**
 * The three target columns are mutually exclusive by invariant — the production
 * writer's own comment says "offBarcode/fdcId/fsId are ALL written every save
 * (non-matching ids are null), so the target columns stay mutually exclusive" —
 * and three separate read sites disagree on precedence when more than one is
 * set (getValidatedMappingByNormalizedName is fdc->off->fs, targetKeyOf is
 * off->fs->fdc, the write-guard's existingFoodId is off->fdc->fs). They agree
 * only while the invariant holds. This script used to write offBarcode and
 * fdcId and omit fsId entirely, so repointing a row that carried an fsId onto
 * an off_ target left TWO columns populated and the three sites diverged.
 * Measured 2026-08-11: 0 of 4,702 live rows have more than one target column
 * set, so the invariant is intact today and this keeps it that way.
 */
export function targetColumns(ref: TargetRef): { source: string; offBarcode: string | null; fdcId: number | null; fsId: string | null } {
    switch (ref.kind) {
        case 'off': return { source: 'openfoodfacts', offBarcode: ref.barcode, fdcId: null, fsId: null };
        case 'fdc': return { source: 'fdc', offBarcode: null, fdcId: ref.fdcId, fsId: null };
        case 'fs': return { source: 'fatsecret', offBarcode: null, fdcId: null, fsId: ref.fsId };
    }
}

/** The FatSecretFood columns the nutrition guard reads. Structural, so a test can build one. */
export interface FsNutritionSource {
    defaultServingId: string | null;
    servings: Array<{ servingId: string; description: string; nutrients: unknown }>;
}

/**
 * The kcal basis production would bill for a FatSecret record whose per-100g
 * panel is empty — i.e. the serving buildFatSecretResult()'s macro-only branch
 * picks: the record's own default serving when that serving carries macros,
 * otherwise the first serving that does. Returns null exactly when
 * `anyServingHasMacros` is false there, which is the condition under which the
 * lane itself logs `fs.build_result.no_nutrition` and returns null.
 *
 * The macro read goes through servingMacros() from
 * src/lib/mapping/fs-serving-macros.ts, which is that module's stated contract:
 * "any future caller that needs 'what kcal does the FatSecret lane bill from
 * this nutrients Json' must import this, never re-derive it." A re-derivation
 * here would fork on string-typed Json exactly as the correctness screen's
 * first draft did.
 *
 * NOTE the deliberate scope limit: this answers "can production bill this
 * record", not "what will it bill". Grams on this shape come from the serving
 * cascade (panel inversion / estimateServingGrams / the bare-query rungs), and
 * that rung is not predictable from a record read — batch 2's `stevia` landed
 * on `bare_sibling_serving` against three independent predictions of
 * `label_serving_default`.
 */
export function fsServingKcalBasis(
    food: FsNutritionSource,
): { kcal: number; servingId: string; description: string } | null {
    const hasMacros = (s: { nutrients: unknown }) =>
        servingMacros(s.nutrients as Record<string, unknown> | null) != null;
    const picked =
        (food.defaultServingId
            ? food.servings.find(s => s.servingId === food.defaultServingId && hasMacros(s))
            : undefined)
        ?? food.servings.find(hasMacros);
    if (!picked) return null;
    const m = servingMacros(picked.nutrients as Record<string, unknown> | null)!;
    return { kcal: m.kcal, servingId: picked.servingId, description: picked.description };
}

async function planOne(r: Repoint): Promise<Plan> {
    const key = canonicalizeCacheKey(r.key ?? r.seed);
    const existing = await prisma.foodMapping.findUnique({ where: { normalizedForm: key } });
    const was = existing ? `${existing.foodName}${existing.brandName ? ` [${existing.brandName}]` : ''}` : undefined;
    const base = { seed: r.seed, key, target: r.target };

    // Validated up front by assertTargetsParse(); this is belt-and-braces.
    const ref = parseTargetRef(r.target);
    if (!ref) return { ...base, action: 'SKIP', reason: 'unsupported target prefix' };
    const cols = targetColumns(ref);

    let name: string;
    let brand: string | null;
    let kcal: number | null;
    let dupNote = '';
    let servingBasis: Plan['servingBasis'];

    if (ref.kind === 'off') {
        const off = await prisma.offFood.findUnique({ where: { barcode: ref.barcode } });
        if (!off) return { ...base, action: 'SKIP', reason: 'target OffFood not found' };
        name = off.name;
        brand = off.brandName;
        kcal = readKcal(off.nutrientsPer100g);
        dupNote = off.duplicateOfBarcode ? ` (dup-marked -> ${off.duplicateOfBarcode})` : '';
    } else if (ref.kind === 'fdc') {
        const fdc = await prisma.fdcFood.findUnique({ where: { fdcId: ref.fdcId } });
        if (!fdc) return { ...base, action: 'SKIP', reason: 'target FdcFood not found' };
        name = fdc.description;
        brand = fdc.brandName;
        kcal = readKcal(fdc.nutrientsPer100g);
    } else {
        const fsFood = await prisma.fatSecretFood.findUnique({
            where: { fsId: ref.fsId },
            select: {
                name: true, brandName: true, nutrientsPer100g: true, defaultServingId: true,
                servings: { select: { servingId: true, description: true, nutrients: true } },
            },
        });
        if (!fsFood) return { ...base, action: 'SKIP', reason: 'target FatSecretFood not found' };
        name = fsFood.name;
        brand = fsFood.brandName;
        kcal = readKcal(fsFood.nutrientsPer100g);
        // An empty per-100g panel is not "no nutrition" on this lane — see the
        // header. Ask the question buildFatSecretResult() asks, through the
        // reader it bills with.
        if (kcal == null) servingBasis = fsServingKcalBasis(fsFood) ?? undefined;
    }

    // The nutrition test is `== null`, never `!kcal`. persistFatSecretHits()
    // writes `nutrientsPer100g: (per100 ?? {})` — an EMPTY OBJECT, not null —
    // when derivation fails, so readKcal returns null and this catches it; but
    // a genuine zero-calorie record (fs_6409498 Bang Energy Drink) must pass.
    // The FDC branch used not to check at all; it does now.
    if (kcal == null && servingBasis == null) {
        return {
            ...base,
            action: 'SKIP',
            reason: ref.kind === 'fs'
                // Say which of the two sources was empty, so a skip cannot be
                // written up as "our copy has no nutrition" again — batch 1
                // recorded exactly that for a record whose `1 can` row carries
                // 100 kcal.
                ? 'target fs record has no nutrition: per-100g panel is empty AND no FatSecretServing carries macros'
                : `target ${ref.kind} record has no nutrition`,
        };
    }

    return {
        ...base,
        action: existing ? 'UPDATE' : 'CREATE',
        oldFood: was,
        newFood: name + dupNote,
        newBrand: brand,
        kcal100: kcal,
        // Absent, not null, on panel-backed plans — see the field's doc.
        ...(servingBasis ? { servingBasis } : {}),
        ...cols,
    };
}

/**
 * Fail closed on a mis-shaped file BEFORE any DB work. An unrecognised prefix
 * means the file was produced by something that does not share this script's
 * target vocabulary, which is a generator bug — reporting it as a per-row SKIP
 * would let a half-applied batch read as a success.
 */
export function unparseableTargets(repoints: Repoint[]): string[] {
    return repoints.filter(r => parseTargetRef(r.target) === null).map(r => `${r.seed} -> ${JSON.stringify(r.target)}`);
}

/** Keys targeted more than once with DIFFERENT targets — last write would win silently. */
export function conflictingKeys(plans: Plan[]): Array<{ key: string; detail: string }> {
    const byKey = new Map<string, Plan[]>();
    for (const p of plans) {
        if (p.action === 'SKIP') continue;
        const list = byKey.get(p.key) ?? [];
        list.push(p);
        byKey.set(p.key, list);
    }
    const out: Array<{ key: string; detail: string }> = [];
    for (const [key, list] of byKey) {
        if (list.length > 1 && new Set(list.map(p => p.target)).size > 1) {
            out.push({ key, detail: list.map(p => `${p.seed}->${p.target}`).join(', ') });
        }
    }
    return out;
}

export interface SnapshotCheck {
    ok: boolean;
    reason?: string;
    rowCount?: number;
    sha256?: string;
    missingKeys?: string[];
}

/**
 * The snapshot is the ONLY restore path (see header). It must cover every row
 * this run would overwrite — a CREATE has nothing to restore, but an UPDATE
 * destroys a row whose prior content exists nowhere else.
 */
export function checkSnapshotCoversPlans(snapshotRaw: string, plans: Plan[]): SnapshotCheck {
    let parsed: unknown;
    try {
        parsed = JSON.parse(snapshotRaw);
    } catch (e) {
        return { ok: false, reason: `snapshot is not valid JSON: ${(e as Error).message}` };
    }
    const snap = parsed as { table?: string; rows?: Array<{ normalizedForm?: string }> };
    if (snap?.table !== 'FoodMapping') {
        return { ok: false, reason: `snapshot table is ${JSON.stringify(snap?.table)}, expected "FoodMapping"` };
    }
    if (!Array.isArray(snap.rows)) {
        return { ok: false, reason: 'snapshot has no rows[] array' };
    }
    const have = new Set(snap.rows.map(r => r.normalizedForm).filter((k): k is string => typeof k === 'string'));
    const missing = plans.filter(p => p.action === 'UPDATE' && !have.has(p.key)).map(p => p.key);
    if (missing.length > 0) {
        return {
            ok: false,
            reason: `snapshot does not contain ${missing.length} row(s) this run would OVERWRITE — it is not a restore anchor for this batch`,
            rowCount: snap.rows.length,
            missingKeys: missing.slice(0, 10),
        };
    }
    return { ok: true, rowCount: snap.rows.length, sha256: crypto.createHash('sha256').update(snapshotRaw).digest('hex') };
}

/**
 * The nutrition figure printed for a plan, LABELLED with its basis. Never label
 * a per-serving figure "kcal/100g": on the empty-panel FatSecret shape the two
 * differ by the serving weight, which is the one number this plan does not
 * know. Exported so the byte-identical-output property the dry-run parity gate
 * rests on is pinned by a test and not only by a diff someone ran once.
 */
export function formatNutritionBasis(p: Plan): string {
    if (p.kcal100 != null) return `${Math.round(p.kcal100)} kcal/100g`;
    if (p.servingBasis) return `${Math.round(p.servingBasis.kcal)} kcal per "${p.servingBasis.description}"`;
    return 'kcal n/a';
}

function argValue(args: string[], flag: string): string | undefined {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
    const args = process.argv.slice(2);
    const FILE = argValue(args, '--file');
    const SNAPSHOT = argValue(args, '--snapshot');
    const APPLY = args.includes('--apply');
    if (!FILE) {
        console.error('missing --file <repoints.json>');
        process.exit(1);
    }
    // A repoint is sticky in both directions, so the restore anchor is not
    // optional. Refusing here (rather than warning) is the same discipline
    // repair-panel-scale-divided.ts applies to its own --execute.
    if (APPLY && !SNAPSHOT) {
        console.error('--apply refuses without --snapshot <FoodMapping-*.json>: a repointed row is protected'
            + ' from overwrite by the human-row write-guard, so a wrong aim does NOT self-heal and the snapshot'
            + ' is the only way back. Take one with scripts/eval/_snap_foodmapping.ts immediately before applying.');
        process.exit(1);
    }

    const repoints: Repoint[] = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!Array.isArray(repoints) || repoints.length === 0) {
        // Fail closed: "Plan: 0 updates, 0 creates, 0 skips" over exit 0 reads
        // as a successful apply of nothing — an empty or mis-shaped file must
        // be loud instead.
        console.error(`FAIL: ${FILE} contains ZERO repoints — nothing to plan; exit 2.`);
        process.exit(2);
    }

    const bad = unparseableTargets(repoints);
    if (bad.length > 0) {
        console.error(`FAIL: ${bad.length} target(s) are not in this script's vocabulary (off_<barcode> | fdc_<digits> | fs_<digits}):`);
        for (const b of bad) console.error(`  ${b}`);
        console.error('Nothing was planned. Fix the generator — a prefix this script cannot parse must never be guessed at.');
        process.exit(2);
    }

    console.log(`${repoints.length} repoints from ${FILE} — ${APPLY ? 'APPLYING' : 'DRY RUN'}\n`);

    const plans: Plan[] = [];
    for (const r of repoints) plans.push(await planOne(r));

    const conflicts = conflictingKeys(plans);
    for (const c of conflicts) {
        console.error(`CONFLICT: key "${c.key}" targeted by ${c.detail} — resolve before applying`);
    }
    if (conflicts.length > 0) process.exit(1);

    for (const p of plans) {
        if (p.action === 'SKIP') {
            console.log(`  SKIP   ${p.seed.padEnd(32)} ${p.target}: ${p.reason}`);
            continue;
        }
        const kcal = formatNutritionBasis(p);
        console.log(`  ${p.action.padEnd(6)} ${p.seed.padEnd(32)} key="${p.key}"`);
        if (p.oldFood) console.log(`         was: ${p.oldFood}`);
        console.log(`         now: ${p.newFood}${p.newBrand ? ` [${p.newBrand}]` : ''} (${p.target}, ${kcal})`);
        if (p.servingBasis) {
            console.log('         note: per-100g panel EMPTY — nutrition basis is a SERVING row, which is what'
                + ' production bills from. Billed GRAMS come from the serving cascade and are NOT predictable'
                + ' from this plan; verify with a draw before believing it.');
        }
    }

    const updates = plans.filter(p => p.action === 'UPDATE');
    const creates = plans.filter(p => p.action === 'CREATE');
    const skips = plans.filter(p => p.action === 'SKIP');
    console.log(`\nPlan: ${updates.length} updates, ${creates.length} creates, ${skips.length} skips`);

    if (!APPLY) {
        console.log('Dry run — re-run with --snapshot <file> --apply to write.');
        return;
    }

    const snapRaw = fs.readFileSync(SNAPSHOT!, 'utf8');
    const snapCheck = checkSnapshotCoversPlans(snapRaw, plans);
    if (!snapCheck.ok) {
        console.error(`REFUSING: ${snapCheck.reason}`);
        if (snapCheck.missingKeys?.length) console.error(`  first missing: ${snapCheck.missingKeys.join(', ')}`);
        process.exit(2);
    }
    console.log(`Snapshot ${SNAPSHOT} covers the batch (${snapCheck.rowCount} rows, sha256 ${snapCheck.sha256!.slice(0, 16)}…)\n`);

    const written: Plan[] = [];
    const stampedAt = new Date();
    for (const p of plans) {
        if (p.action === 'SKIP') continue;
        const foodName = p.newFood!.replace(/ \(dup-marked.*\)$/, '');
        const cols = {
            foodName,
            brandName: p.newBrand ?? null,
            source: p.source!,
            // All three written every time — the mutual-exclusion invariant.
            offBarcode: p.offBarcode ?? null,
            fdcId: p.fdcId ?? null,
            fsId: p.fsId ?? null,
            aiConfidence: 0.99,
            validatedBy: 'human-triage',
            // validatedAt has no @updatedAt, and this script never used to set
            // it — so a repointed row kept the timestamp of the original AI
            // save and there was no way to tell which campaign aimed it.
            validatedAt: stampedAt,
        };
        await prisma.foodMapping.upsert({
            where: { normalizedForm: p.key },
            create: { normalizedForm: p.key, usedCount: 1, ...cols },
            update: cols,
        });
        written.push(p);
    }
    console.log(`Wrote ${written.length} rows (validatedBy=human-triage, validatedAt=${stampedAt.toISOString()}).`);

    // Provenance lives in a sidecar, not a column: FoodMapping has no free-text
    // provenance field, and validatedBy cannot carry a campaign tag because
    // isTrustedHumanRow() tests it with exact string equality — any new value
    // would silently lose read-time trust. The pair (validatedAt stamp, this
    // file) identifies exactly which rows a campaign aimed and where to restore
    // them from. Same shape as panel-scale-repair-outcome-*.json.
    const outDir = path.join(__dirname, 'results');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `repoint-outcome-${stampedAt.toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(outPath, JSON.stringify({
        kind: 'repoint-outcome',
        version: 1,
        appliedAt: stampedAt.toISOString(),
        inputFile: FILE,
        snapshot: { path: SNAPSHOT, rowCount: snapCheck.rowCount, sha256: snapCheck.sha256 },
        counts: { planned: plans.length, updates: updates.length, creates: creates.length, skips: skips.length, written: written.length },
        skipped: skips.map(p => ({ seed: p.seed, key: p.key, target: p.target, reason: p.reason })),
        written: written.map(p => ({
            seed: p.seed, key: p.key, action: p.action, target: p.target,
            source: p.source, offBarcode: p.offBarcode ?? null, fdcId: p.fdcId ?? null, fsId: p.fsId ?? null,
            wasFood: p.oldFood ?? null, nowFood: p.newFood ?? null,
            // Absent on panel-backed rows, so an outcome file written before
            // this field existed stays comparable. Present it identifies the
            // rows whose portion is cascade-decided and therefore unverified
            // until a draw says otherwise.
            ...(p.servingBasis ? { servingBasis: p.servingBasis } : {}),
        })),
    }, null, 2) + '\n');
    console.log(`Outcome written to ${outPath}`);
    console.log(`Restore path: scripts/eval/_restore_rows.ts ${SNAPSHOT} <keys> --execute`);
}

// Guarded so the pure helpers above are importable by tests. Every comparable
// script in this directory does the same; this one did not until the guard was
// added, which is why it had gone untested. Its tests now live in
// scripts/eval/__tests__/apply-repoints.test.ts.
if (require.main === module) {
    main()
        .catch(err => { console.error(err); process.exit(2); })
        .finally(() => prisma.$disconnect());
}
