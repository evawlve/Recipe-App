/**
 * apply-repoints.ts — data-ops batch repoint of FoodMapping cache rows.
 *
 * Input: a JSON array of { seed, target, class, severity, wasFood } entries
 * (produced from a triage run — e.g. repoints-2026-07-20.json, generated from
 * the 2026-07-20 warm-cache-triage multi-agent audit). For each entry the
 * script computes the cache key with the pipeline's own canonicalizeCacheKey,
 * validates the target record exists (OffFood / FdcFood) and has nutrition,
 * then upserts the row pointing at the target with validatedBy 'human-triage'.
 *
 * Rows are UPDATEd when the seed already has a cache row and CREATEd when it
 * doesn't (pre-validating seeds that were below the 0.85 confidence save
 * threshold, or whose picks the save gates rejected). Dry-run by default.
 *
 * NOTE: a later live request can still overwrite a repointed row through
 * saveValidatedMapping's upsert — these repoints fix today's cache; the
 * lasting fixes are the rerank/serving-default levers (PR D pt3).
 *
 * Run (from repo root, DATABASE_URL must point at the target DB):
 *   npx ts-node --transpile-only --compilerOptions '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/eval/apply-repoints.ts --file scripts/eval/repoints-2026-07-20.json [--apply]
 */

import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { canonicalizeCacheKey } from '../../src/lib/mapping/normalization-rules';

const prisma = new PrismaClient();

const args = process.argv.slice(2);
function argValue(flag: string): string | undefined {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
}
const FILE = argValue('--file');
const APPLY = args.includes('--apply');
if (!FILE) {
    console.error('missing --file <repoints.json>');
    process.exit(1);
}

interface Repoint {
    seed: string;
    target: string;     // off_<barcode> | fdc_<id>
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

interface Plan {
    seed: string;
    key: string;
    action: 'UPDATE' | 'CREATE' | 'SKIP';
    reason?: string;
    oldFood?: string;
    newFood?: string;
    newBrand?: string | null;
    kcal100?: number | null;
    target: string;
    source?: string;
    offBarcode?: string | null;
    fdcId?: number | null;
}

/** nutrientsPer100g JSON stores energy as "calories" (schema comment says kcal — stale). */
function readKcal(nutrients: unknown): number | null {
    const n = nutrients as { calories?: number; kcal?: number } | null;
    const v = n?.calories ?? n?.kcal;
    return typeof v === 'number' ? v : null;
}

async function planOne(r: Repoint): Promise<Plan> {
    const key = canonicalizeCacheKey(r.key ?? r.seed);
    const existing = await prisma.foodMapping.findUnique({ where: { normalizedForm: key } });

    if (r.target.startsWith('off_')) {
        const barcode = r.target.slice(4);
        const off = await prisma.offFood.findUnique({ where: { barcode } });
        if (!off) return { seed: r.seed, key, action: 'SKIP', reason: 'target OffFood not found', target: r.target };
        const kcal = readKcal(off.nutrientsPer100g);
        if (kcal == null) {
            return { seed: r.seed, key, action: 'SKIP', reason: 'target OffFood has no nutrition', target: r.target };
        }
        const dupNote = off.duplicateOfBarcode ? ` (dup-marked -> ${off.duplicateOfBarcode})` : '';
        return {
            seed: r.seed, key,
            action: existing ? 'UPDATE' : 'CREATE',
            oldFood: existing ? `${existing.foodName}${existing.brandName ? ` [${existing.brandName}]` : ''}` : undefined,
            newFood: off.name + dupNote, newBrand: off.brandName,
            kcal100: kcal, target: r.target,
            source: 'openfoodfacts', offBarcode: barcode, fdcId: null,
        };
    }

    const fdcId = parseInt(r.target.slice(4), 10);
    const fdc = await prisma.fdcFood.findUnique({ where: { fdcId } });
    if (!fdc) return { seed: r.seed, key, action: 'SKIP', reason: 'target FdcFood not found', target: r.target };
    return {
        seed: r.seed, key,
        action: existing ? 'UPDATE' : 'CREATE',
        oldFood: existing ? `${existing.foodName}${existing.brandName ? ` [${existing.brandName}]` : ''}` : undefined,
        newFood: fdc.description, newBrand: fdc.brandName,
        kcal100: readKcal(fdc.nutrientsPer100g), target: r.target,
        source: 'fdc', offBarcode: null, fdcId,
    };
}

async function main() {
    const repoints: Repoint[] = JSON.parse(fs.readFileSync(FILE!, 'utf8'));
    console.log(`${repoints.length} repoints from ${FILE} — ${APPLY ? 'APPLYING' : 'DRY RUN'}\n`);

    const plans: Plan[] = [];
    for (const r of repoints) plans.push(await planOne(r));

    // Detect duplicate cache keys inside the batch (last write would win silently)
    const byKey = new Map<string, Plan[]>();
    for (const p of plans) {
        if (p.action === 'SKIP') continue;
        const list = byKey.get(p.key) ?? [];
        list.push(p);
        byKey.set(p.key, list);
    }
    for (const [key, list] of byKey) {
        if (list.length > 1 && new Set(list.map(p => p.target)).size > 1) {
            console.error(`CONFLICT: key "${key}" targeted by ${list.map(p => `${p.seed}->${p.target}`).join(', ')} — resolve before applying`);
            process.exit(1);
        }
    }

    for (const p of plans) {
        if (p.action === 'SKIP') {
            console.log(`  SKIP   ${p.seed.padEnd(32)} ${p.target}: ${p.reason}`);
            continue;
        }
        const kcal = p.kcal100 != null ? `${Math.round(p.kcal100)} kcal/100g` : 'kcal n/a';
        console.log(`  ${p.action.padEnd(6)} ${p.seed.padEnd(32)} key="${p.key}"`);
        if (p.oldFood) console.log(`         was: ${p.oldFood}`);
        console.log(`         now: ${p.newFood}${p.newBrand ? ` [${p.newBrand}]` : ''} (${p.target}, ${kcal})`);
    }

    const updates = plans.filter(p => p.action === 'UPDATE');
    const creates = plans.filter(p => p.action === 'CREATE');
    const skips = plans.filter(p => p.action === 'SKIP');
    console.log(`\nPlan: ${updates.length} updates, ${creates.length} creates, ${skips.length} skips`);

    if (!APPLY) {
        console.log('Dry run — re-run with --apply to write.');
        return;
    }

    let written = 0;
    for (const p of plans) {
        if (p.action === 'SKIP') continue;
        await prisma.foodMapping.upsert({
            where: { normalizedForm: p.key },
            create: {
                normalizedForm: p.key,
                foodName: p.newFood!.replace(/ \(dup-marked.*\)$/, ''),
                brandName: p.newBrand ?? null,
                source: p.source!,
                offBarcode: p.offBarcode ?? null,
                fdcId: p.fdcId ?? null,
                aiConfidence: 0.99,
                validatedBy: 'human-triage',
                usedCount: 1,
            },
            update: {
                foodName: p.newFood!.replace(/ \(dup-marked.*\)$/, ''),
                brandName: p.newBrand ?? null,
                source: p.source!,
                offBarcode: p.offBarcode ?? null,
                fdcId: p.fdcId ?? null,
                aiConfidence: 0.99,
                validatedBy: 'human-triage',
            },
        });
        written++;
    }
    console.log(`Wrote ${written} rows (validatedBy=human-triage).`);
}

main()
    .catch(err => { console.error(err); process.exit(2); })
    .finally(() => prisma.$disconnect());
