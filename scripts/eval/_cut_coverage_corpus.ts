/**
 * Cut a NEW coverage corpus from an existing one plus a set of additions.
 *
 * Why this exists as a script rather than an edit: `cache-coverage.ts` says the
 * committed corpus is the fixed denominator and that "changing it breaks
 * comparability with every earlier reading — cut a new file under a new name
 * instead, and restate the baseline." Appending to the live corpus silently
 * invalidates every prior coverage/growth number in the logs. This produces the
 * new file, leaves the old one untouched, and prints the restated baseline.
 *
 * `baseline` is recomputed for EVERY seed against the live cache at cut time, so
 * `growth` on the new corpus restarts at 0% by construction and measures work
 * done from this cut forward. The old file keeps its own baseline and its own
 * history stays readable.
 *
 * Additions are deduped by COVERAGE KEY against the base corpus, not by raw
 * string — `deriveStaticCoverageKey()`, the same predicate the sweep grades
 * with (since 2026-08-24: normalizer → canonicalize → duplicate-collapse; before
 * that, `canonicalizeCacheKey` on the raw seed). "fage total 0 plain" and
 * "Fage Total 0% plain" are one seed to the coverage reader, and admitting both
 * would inflate the denominator with a row that can never be independently
 * cached. `baseline` is graded by the same key, so a corpus cut from here on
 * starts growth at 0% under the predicate the sweep actually reads with — the
 * 08-08 cut was graded by the raw key, which is why its growth did not. Rows already in the base are dropped, and the
 * base itself is copied through untouched (deduping it would change the
 * denominator this script exists to preserve).
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register \
 *     scripts/eval/_cut_coverage_corpus.ts \
 *       --base scripts/eval/coverage-corpus.tsv \
 *       --add  /tmp/additions.tsv        # domain \t seed, no header
 *       --out  scripts/eval/coverage-corpus-2026-08-02.tsv
 */
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { deriveStaticCoverageKey } from '../../src/lib/ops/cache-coverage';

const args = process.argv.slice(2);
const argValue = (f: string) => {
    const i = args.indexOf(f);
    return i >= 0 ? args[i + 1] : undefined;
};

const BASE = argValue('--base');
const ADD = argValue('--add');
const OUT = argValue('--out');

if (!BASE || !OUT) {
    console.error('usage: --base <corpus.tsv> [--add <domain\\tseed.tsv>] --out <new.tsv>');
    process.exit(2);
}
if (fs.existsSync(OUT)) {
    // Fail closed. Overwriting a cut corpus is the same comparability break the
    // whole script exists to avoid, just one level up.
    console.error(`!! ${OUT} already exists. Cutting over it would break comparability. Refusing.`);
    process.exit(2);
}

interface Row { domain: string; seed: string }

function readBase(p: string): Row[] {
    const out: Row[] = [];
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        const t = line.trim();
        if (!t) continue;
        const [domain, , ...rest] = t.split('\t');
        const seed = rest.join('\t').trim();
        if (!seed || domain === 'domain') continue;   // header
        out.push({ domain, seed });
    }
    return out;
}

function readAdditions(p: string): Row[] {
    const out: Row[] = [];
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const [domain, ...rest] = t.split('\t');
        const seed = rest.join('\t').trim();
        if (!seed) continue;
        out.push({ domain: domain.trim(), seed });
    }
    return out;
}

async function main() {
    const base = readBase(BASE!);
    const additions = ADD ? readAdditions(ADD) : [];

    const baseKeys = new Set(base.map(r => deriveStaticCoverageKey(r.seed)));
    const seenAdd = new Set<string>();
    const kept: Row[] = [];
    let dupBase = 0, dupAdd = 0;
    for (const r of additions) {
        const k = deriveStaticCoverageKey(r.seed);
        if (baseKeys.has(k)) { dupBase++; continue; }
        if (seenAdd.has(k)) { dupAdd++; continue; }
        seenAdd.add(k);
        kept.push(r);
    }

    const all = [...base, ...kept];

    const prisma = new PrismaClient();
    let cachedKeys: Set<string>;
    try {
        const rows = await prisma.foodMapping.findMany({ select: { normalizedForm: true } });
        cachedKeys = new Set(rows.map(r => r.normalizedForm));
    } finally {
        await prisma.$disconnect().catch(() => {});
    }

    let cached = 0;
    const lines = ['domain\tbaseline\tseed'];
    for (const r of all) {
        const isCached = cachedKeys.has(deriveStaticCoverageKey(r.seed));
        if (isCached) cached++;
        lines.push(`${r.domain}\t${isCached ? 'cached' : 'new'}\t${r.seed}`);
    }
    fs.writeFileSync(OUT!, lines.join('\n') + '\n');

    const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
    console.log(`base            ${base.length}`);
    console.log(`additions       ${additions.length} offered, ${kept.length} kept ` +
        `(${dupBase} already in base by cache key, ${dupAdd} duplicate within additions)`);
    console.log(`NEW CORPUS      ${all.length} seeds -> ${OUT}`);
    console.log(`RESTATED BASELINE  cached ${cached}/${all.length} = ${pct(cached, all.length)}%`);
    console.log(`growth restarts at 0% by construction (every seed's baseline is its state right now)`);
}

main().catch(e => { console.error(e); process.exit(1); });
