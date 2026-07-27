/**
 * _recover_seeds.ts — recover real shopper phrases for cache keys that have no seed.
 *
 * WHY: correctness-screen's Tier L judges identity by comparing the shopper phrase to
 * the matched record. For 1,380 of 3,248 keys we had no phrase, so it was handed the
 * KEY — which is token-SORTED, i.e. word order is destroyed ("butter honey jif peanut").
 * A scrambled string reads to the model as a different product name, which shows up as
 * spurious identity REJECTs.
 *
 * MappingEventLog.rawLine is what the user typed and .normalizedForm PRESERVES word
 * order, so it is not in cache-key space. Map it INTO key space with the pipeline's own
 * canonicalizeCacheKey rather than re-deriving the transform here — a transcription of
 * that function is exactly the class of bug this whole exercise is about.
 *
 * Read-only. Emits a `key<TAB>phrase` pin file the screen accepts via --seeds.
 */
import 'dotenv/config';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { canonicalizeCacheKey } from '../../src/lib/mapping/normalization-rules';

const prisma = new PrismaClient();

async function main(): Promise<void> {
    const keysPath = process.argv[2];
    const out = process.argv[3];
    if (!keysPath || !out) throw new Error('usage: _recover_seeds.ts <keys.json|rows.json> <out.tsv>');

    const raw = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
    const keys: string[] = Array.isArray(raw)
        ? raw.map((r: unknown) => (typeof r === 'string' ? r : (r as { key: string }).key))
        : (raw.rows as { key: string }[]).map(r => r.key);
    const want = new Set(keys);
    console.log(`want phrases for ${keys.length} key(s)`);

    const rows = await prisma.$queryRawUnsafe<{ normalizedForm: string; rawLine: string; n: bigint }[]>(
        `SELECT "normalizedForm", "rawLine", count(*) AS n
           FROM "MappingEventLog"
          WHERE "normalizedForm" IS NOT NULL AND "rawLine" <> ''
          GROUP BY 1, 2`,
    );
    console.log(`event log: ${rows.length} distinct (form, line) pair(s)`);

    let canonFail = 0;
    const best = new Map<string, { line: string; n: number }>();
    for (const r of rows) {
        // A multi-item line is not this key's phrase; skip rather than mislabel it.
        const words = r.rawLine.trim().split(/\s+/).length;
        if (words > 8 || /[,;]/.test(r.rawLine)) continue;

        let k: string;
        try { k = canonicalizeCacheKey(r.normalizedForm); } catch { canonFail++; continue; }
        if (!want.has(k)) continue;

        const cur = best.get(k);
        const n = Number(r.n);
        if (!cur || n > cur.n) best.set(k, { line: r.rawLine.trim(), n });
    }
    if (canonFail) console.log(`WARN canonicalizeCacheKey threw on ${canonFail} form(s)`);

    const lines: string[] = [];
    for (const k of keys) {
        const b = best.get(k);
        if (b) lines.push(`${k}\t${b.line}`);
    }
    fs.writeFileSync(out, lines.join('\n') + (lines.length ? '\n' : ''));
    console.log(`recovered ${lines.length} / ${keys.length} phrases (${((lines.length / keys.length) * 100).toFixed(1)}%) -> ${out}`);
    for (const l of lines.slice(0, 10)) console.log(`  ${l.replace('\t', '   <-   ')}`);
}

main()
    .catch(e => { console.error(e); process.exit(2); })
    .finally(() => prisma.$disconnect());
