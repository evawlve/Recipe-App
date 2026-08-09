/** Read-only: dump the uncached seeds of a coverage corpus, with domain. */
import 'dotenv/config';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { canonicalizeCacheKey } from '../../src/lib/mapping/normalization-rules';

async function main() {
    const corpus = process.argv[2];
    const out = process.argv[3];
    const prisma = new PrismaClient();
    const live = new Set((await prisma.foodMapping.findMany({ select: { normalizedForm: true } })).map(r => r.normalizedForm));
    const lines = fs.readFileSync(corpus, 'utf8').trim().split('\n');
    const hdr = lines.shift();
    if (!hdr || !hdr.startsWith('domain')) throw new Error('unexpected header: ' + hdr);
    const rows = lines.map(l => { const [domain, baseline, seed] = l.split('\t'); return { domain, baseline, seed }; });
    const un = rows.filter(r => !live.has(canonicalizeCacheKey(r.seed)));
    fs.writeFileSync(out, ['domain\tbaseline\tseed\tcachekey', ...un.map(r => `${r.domain}\t${r.baseline}\t${r.seed}\t${canonicalizeCacheKey(r.seed)}`)].join('\n'));
    const byDomain = new Map<string, number>();
    for (const r of un) byDomain.set(r.domain, (byDomain.get(r.domain) ?? 0) + 1);
    console.log(`corpus ${rows.length} · live keys ${live.size} · UNCACHED ${un.length} (${(100 * (rows.length - un.length) / rows.length).toFixed(1)}% cached)`);
    console.log([...byDomain.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d}\t${n}`).join('\n'));
    await prisma.$disconnect();
}
main();
