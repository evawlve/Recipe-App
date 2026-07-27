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
 *
 * Exit codes:
 *   0 = recovered >= 1 phrase
 *   4 = VOID — recovered ZERO phrases. Playbook §11 class B: an empty pin file
 *       is not a result, it is the absence of one, and downstream
 *       (_dump_cache_prompts.ts) it silently un-pins EVERY row. A run that
 *       produced nothing must not exit like a run that produced something.
 *   2 = error
 */
import 'dotenv/config';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { canonicalizeCacheKey } from '../../src/lib/mapping/normalization-rules';

// ---------------------------------------------------------------------------
// Pure, unit-testable outcome (scripts/eval/__tests__/cache-ops-void-exits.test.ts)
// ---------------------------------------------------------------------------

export const RECOVER_VOID_EXIT = 4;

export interface RecoveryOutcome { code: number; lines: string[] }

/** Zero recovered is a distinct, loud, nonzero outcome — never a quiet green. */
export function recoveryOutcome(recovered: number, wanted: number): RecoveryOutcome {
    if (recovered === 0) {
        return {
            code: RECOVER_VOID_EXIT,
            lines: [
                `VOID: recovered 0 / ${wanted} phrases — this run produced NOTHING.`,
                'An empty pin file pins no rows; feeding it forward silently un-pins every row',
                'downstream (playbook §11 class B: absence encoded as a pass). Wrong keys file,',
                'wrong key space, or an empty/filtered MappingEventLog — find out which before using the output.',
            ],
        };
    }
    return { code: 0, lines: [] };
}

async function main(): Promise<number> {
    const keysPath = process.argv[2];
    const out = process.argv[3];
    if (!keysPath || !out) throw new Error('usage: _recover_seeds.ts <keys.json|rows.json> <out.tsv>');

    const prisma = new PrismaClient();

    try {
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

        const outcome = recoveryOutcome(lines.length, keys.length);
        for (const l of outcome.lines) console.error(l);
        return outcome.code;
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    main()
        .then(c => process.exit(c))
        .catch(e => { console.error(e); process.exit(2); });
}
