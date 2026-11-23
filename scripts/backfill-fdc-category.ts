/**
 * backfill-fdc-category.ts — s464 A-CAT-1. Fills FdcFood.foodCategory (Postgres) and the
 * `fdc_foods` Typesense documents from a committed map built off the USDA bulk dumps.
 *
 *   --build-map <srLegacy.json> <foundation.json>   reads two local files, writes the map. No DB, no network.
 *   (default)                                       dry run over the map against DATABASE_URL: reads only.
 *   --apply-pg                                      UPDATE ... WHERE "foodCategory" IS NULL, in batches (raw SQL,
 *                                                   so @updatedAt is untouched).
 *   --apply-typesense                               PATCH the schema, then one filter_by PATCH per fdcId; asserts
 *                                                   num_updated == 1 and stops on the first other reading.
 *
 * main() runs only when this file is the entry point, so importing it runs nothing.
 * The db client and the network are touched only inside the modes above.
 */
import fs from 'fs';
import path from 'path';
import { buildCategoryMap } from '../src/ops/usda/fdc-category';

export const MAP_PATH = path.join(__dirname, 'fdc-category', 'fdc-food-category-map.json');
const BATCH = 500;

export function loadMap(): Record<string, string> {
    return JSON.parse(fs.readFileSync(MAP_PATH, 'utf-8'));
}

export function buildMapFromDumps(srLegacyPath: string, foundationPath: string): Record<string, string> {
    const sr = JSON.parse(fs.readFileSync(srLegacyPath, 'utf-8')).SRLegacyFoods as unknown[];
    const fnd = JSON.parse(fs.readFileSync(foundationPath, 'utf-8')).FoundationFoods as unknown[];
    if (!Array.isArray(sr) || !Array.isArray(fnd)) throw new Error('dump shape: expected SRLegacyFoods / FoundationFoods arrays');
    return buildCategoryMap([...sr, ...fnd]);
}

async function dryRun(map: Record<string, string>) {
    const { prisma } = await import('../src/lib/db');
    const rows = await prisma.$queryRawUnsafe<Array<{ fdcId: number; foodCategory: string | null }>>(
        'SELECT "fdcId", "foodCategory" FROM "FdcFood"');
    let matched = 0, missing = 0, already = 0;
    for (const r of rows) {
        if (map[String(r.fdcId)]) matched++; else missing++;
        if (r.foodCategory != null) already++;
    }
    console.log(JSON.stringify({ rows: rows.length, matched, missing, alreadySet: already,
        distinctCategories: new Set(Object.values(map)).size }));
}

async function applyPg(map: Record<string, string>) {
    const { prisma } = await import('../src/lib/db');
    const rows = await prisma.$queryRawUnsafe<Array<{ fdcId: number }>>('SELECT "fdcId" FROM "FdcFood"');
    const ids = rows.map(r => r.fdcId).filter(id => map[String(id)]);
    let updated = 0;
    for (let i = 0; i < ids.length; i += BATCH) {
        for (const id of ids.slice(i, i + BATCH)) {
            updated += await prisma.$executeRawUnsafe(
                'UPDATE "FdcFood" SET "foodCategory" = $1 WHERE "fdcId" = $2 AND "foodCategory" IS NULL',
                map[String(id)], id);
        }
        console.log(`batch ${i / BATCH + 1}: ${updated} updated so far`);
    }
    console.log(JSON.stringify({ considered: ids.length, updated }));
}

async function applyTypesense(map: Record<string, string>) {
    const host = process.env.TYPESENSE_HOST ?? 'http://localhost:8108';
    const key = process.env.TYPESENSE_API_KEY ?? '';
    const headers = { 'X-TYPESENSE-API-KEY': key, 'Content-Type': 'application/json' };
    const { prisma } = await import('../src/lib/db');
    const rows = await prisma.$queryRawUnsafe<Array<{ fdcId: number }>>('SELECT "fdcId" FROM "FdcFood"');

    const schemaRes = await fetch(`${host}/collections/fdc_foods`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ fields: [{ name: 'foodCategory', type: 'string', optional: true, index: false }] }),
    });
    // A re-run finds the field already there; any other failure stops.
    const schemaText = await schemaRes.text();
    if (!schemaRes.ok && !/already/i.test(schemaText)) throw new Error(`schema PATCH ${schemaRes.status}: ${schemaText}`);

    let n = 0;
    for (const { fdcId } of rows) {
        const cat = map[String(fdcId)];
        if (!cat) continue;
        const res = await fetch(`${host}/collections/fdc_foods/documents?filter_by=${encodeURIComponent(`fdcId:=\`${fdcId}\``)}`, {
            method: 'PATCH', headers, body: JSON.stringify({ foodCategory: cat }),
        });
        const body = (await res.json()) as { num_updated?: number };
        if (!res.ok || body.num_updated !== 1) {
            throw new Error(`fdcId ${fdcId}: status ${res.status}, num_updated ${body.num_updated}; stopping`);
        }
        n++;
    }
    console.log(JSON.stringify({ patched: n }));
}

async function main(argv: string[]) {
    if (argv[0] === '--build-map') {
        if (argv.length !== 3) throw new Error('usage: --build-map <srLegacy.json> <foundation.json>');
        const map = buildMapFromDumps(argv[1], argv[2]);
        fs.mkdirSync(path.dirname(MAP_PATH), { recursive: true });
        fs.writeFileSync(MAP_PATH, JSON.stringify(map, null, 0) + '\n');
        console.log(`wrote ${Object.keys(map).length} entries to ${MAP_PATH}`);
        return;
    }
    const map = loadMap();
    if (argv[0] === '--apply-pg') await applyPg(map);
    else if (argv[0] === '--apply-typesense') await applyTypesense(map);
    else await dryRun(map);
}

if (require.main === module) {
    main(process.argv.slice(2)).then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
}
