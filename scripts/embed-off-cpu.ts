/**
 * embed-off-cpu.ts — backfill OffFood.embedding on CPU, in Node.
 *
 * WHY THIS EXISTS ALONGSIDE embed_foods.py: that script is the GPU listener and
 * needs torch + sentence_transformers + psycopg, none of which are installed on
 * the box (checked 2026-07-30: all three ModuleNotFoundError). So after a
 * `--fresh` OFF re-ingest there was NO way to re-embed the corpus without the
 * Windows machine. This uses the @huggingface/transformers/onnxruntime stack the
 * API already depends on for query embedding, so it runs anywhere the repo does.
 *
 * bge-small-en-v1.5 is a 33M-param model; measured 2026-07-30 it does ~327
 * rows/sec on the box's i7-8700T and ~1,062 rows/sec on an M-series Mac, i.e.
 * ~55 minutes for the full 1.07M corpus. A GPU is not required.
 *
 * POOLING IS CLS, NOT MEAN, AND THAT IS LOAD-BEARING. The corpus written by
 * embed_foods.py is CLS-pooled: measured 2026-07-30, re-embedding five known
 * rows reproduced their stored vectors at cosine 1.00000 with `pooling:'cls'`
 * and only ~0.93 with `pooling:'mean'`. Writing mean-pooled vectors here would
 * put new rows in a different space from old ones with nothing to detect it.
 * (Separately: src/lib/search/query-embedding.ts embeds QUERIES with
 * pooling:'mean', so queries and documents currently disagree. That is a real
 * defect, but it is the query side that is wrong per BGE's own usage, and
 * changing it moves live ranking — so it is not fixed here.)
 *
 * Idempotent and resumable: only rows WHERE embedding IS NULL are touched, so
 * interrupting and re-running costs nothing. Keyset pagination on `barcode`
 * (OffFood's PK) rather than OFFSET, so progress does not degrade.
 *
 *   npx ts-node --project tsconfig.scripts.json --transpile-only \
 *     -r tsconfig-paths/register scripts/embed-off-cpu.ts [--limit N] [--dry-run]
 *
 * AFTERWARDS, RE-SYNC TYPESENSE. searchOffSemantic() reads vectors from
 * Typesense (`vectorSearchTypesense`), not from pgvector — embedding Postgres
 * alone leaves semantic search exactly as dead as before. Run
 * `scripts/sync-typesense.ts` once this finishes.
 *
 *   exit 0 = every NULL-embedding row now has a vector (or dry run)
 *   exit 2 = error
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const MODEL_ID = 'Xenova/bge-small-en-v1.5';
const DIM = 384;

interface Row { barcode: string; name: string | null; brandName: string | null }

/**
 * Document text, byte-identical to embed_foods.py's doc_text(): "name — brand",
 * whitespace-collapsed, lowercased. The em dash and its surrounding spaces are
 * part of the string the existing corpus was embedded from — do not "tidy" this.
 * bge's query prefix is deliberately absent: it belongs on queries only.
 */
export function docText(name: string | null, brand: string | null): string {
    const base = !brand ? (name ?? '') : `${name ?? ''} — ${brand}`;
    return base.trim().toLowerCase().replace(/\s+/g, ' ');
}

function chunk<T>(xs: T[], n: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
    return out;
}

async function main(): Promise<number> {
    const args = process.argv.slice(2);
    const num = (flag: string, dflt: number) => {
        const i = args.indexOf(flag);
        return i >= 0 && args[i + 1] ? Number(args[i + 1]) : dflt;
    };
    const limit = num('--limit', Infinity);
    const dbBatch = num('--batch', 2000);
    const encodeBs = num('--encode-bs', 64);
    const dryRun = args.includes('--dry-run');

    const prisma = new PrismaClient();
    try {
        const [{ pending }] = await prisma.$queryRawUnsafe<{ pending: bigint }[]>(
            'SELECT count(*) AS pending FROM "OffFood" WHERE embedding IS NULL',
        );
        console.log(`[init] ${Number(pending).toLocaleString()} rows with NULL embedding`);
        if (dryRun) { console.log('[dry-run] loading model only, writing nothing'); }

        const { pipeline } = await import('@huggingface/transformers');
        const t0 = Date.now();
        const extractor = await pipeline('feature-extraction', MODEL_ID, { dtype: 'fp32' });
        console.log(`[init] ${MODEL_ID} loaded in ${Date.now() - t0}ms (pooling=cls, normalize=true)`);
        if (dryRun) { return 0; }

        let cursor = '';
        let done = 0;
        let skipped = 0;
        const started = Date.now();

        for (;;) {
            if (done >= limit) break;
            const take = Math.min(dbBatch, limit - done);
            const rows = await prisma.$queryRawUnsafe<Row[]>(
                `SELECT barcode, name, "brandName" FROM "OffFood"
                  WHERE embedding IS NULL AND barcode > $1
                  ORDER BY barcode LIMIT $2`,
                cursor, take,
            );
            if (rows.length === 0) break;
            cursor = rows[rows.length - 1].barcode;

            // A row with no usable text cannot be embedded. It is COUNTED, not
            // silently passed over, and its embedding stays NULL so a later run
            // with better data still finds it.
            const usable = rows.filter(r => docText(r.name, r.brandName) !== '');
            skipped += rows.length - usable.length;

            const updates: { barcode: string; emb: string }[] = [];
            for (const part of chunk(usable, encodeBs)) {
                const out = await extractor(part.map(r => docText(r.name, r.brandName)), {
                    pooling: 'cls', normalize: true,
                });
                const data = out.data as Float32Array;
                for (let i = 0; i < part.length; i++) {
                    const v = Array.from(data.slice(i * DIM, (i + 1) * DIM));
                    if (v.length !== DIM) throw new Error(`expected ${DIM} dims, got ${v.length}`);
                    updates.push({ barcode: part[i].barcode, emb: `[${v.map(x => x.toFixed(6)).join(',')}]` });
                }
            }

            for (const part of chunk(updates, 500)) {
                const values = part.map((_, i) => `($${i * 2 + 1}::text, $${i * 2 + 2}::text)`).join(',');
                const params = part.flatMap(u => [u.barcode, u.emb]);
                await prisma.$executeRawUnsafe(
                    `UPDATE "OffFood" AS o SET embedding = v.emb::vector
                       FROM (VALUES ${values}) AS v(barcode, emb)
                      WHERE o.barcode = v.barcode`,
                    ...params,
                );
            }

            done += rows.length;
            const rps = done / ((Date.now() - started) / 1000);
            console.log(`[embed] ${done.toLocaleString()} rows · ${rps.toFixed(0)}/sec · cursor=${cursor}`);
        }

        console.log(`\n[done] embedded ${(done - skipped).toLocaleString()} rows in ${((Date.now() - started) / 60000).toFixed(1)} min`);
        if (skipped) console.log(`[done] ${skipped.toLocaleString()} row(s) had no usable name/brand text — left NULL`);
        console.log('[next] re-run scripts/sync-typesense.ts — semantic search reads vectors from Typesense, not pgvector');
        return 0;
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    main()
        .then(c => process.exit(c))
        .catch(e => { console.error(e); process.exit(2); });
}
