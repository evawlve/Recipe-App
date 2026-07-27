/**
 * _dump_cache_prompts.ts — emit the exact Tier-L record card for every cached row, so a
 * Claude Code agent fleet can audit the cache on the same evidence the API screen used.
 *
 * Attribution is PINS ONLY. `attribute()`'s Jaccard fallback was measured on 2026-07-27
 * to evict at 44.8% vs 26.8% for pinned rows — a nearest-match seed is a guess that
 * manufactures identity mismatches, so an unpinned row gets an EMPTY phrase and the
 * judge is told the key is token-sorted rather than being handed a scrambled string
 * dressed up as a query.
 *
 * Read-only, offline (rows-final.json carries `row.real`).
 */
import * as fs from 'fs';
import * as path from 'path';
import { llmUserPrompt, LLM_SYSTEM, ScreenRow } from './correctness-screen';

const rowsPath = process.argv[2];
const seedsPath = process.argv[3];
const outDir = process.argv[4];
const perAgent = Number(process.argv[5] ?? 27);
if (!rowsPath || !seedsPath || !outDir) {
    throw new Error('usage: _dump_cache_prompts.ts <rows.json> <pins.tsv> <outDir> [perAgent]');
}

const rows = JSON.parse(fs.readFileSync(rowsPath, 'utf8')) as ScreenRow[];
const pins = new Map<string, string>();
for (const ln of fs.readFileSync(seedsPath, 'utf8').split('\n')) {
    if (!ln.trim()) continue;
    const [k, p] = ln.split('\t');
    if (k && p) pins.set(k.trim(), p.trim());
}

let pinned = 0;
const cards = rows.map((r, i) => {
    const seed = pins.get(r.key) ?? '';
    if (seed) pinned++;
    // llmUserPrompt reads r.seed; set it explicitly rather than relying on attribute().
    const withSeed = { ...r, seed } as ScreenRow;
    return { idx: i, key: r.key, hasPhrase: Boolean(seed), prompt: llmUserPrompt(withSeed) };
});

fs.mkdirSync(outDir, { recursive: true });
let files = 0;
for (let i = 0; i < cards.length; i += perAgent) {
    fs.writeFileSync(
        path.join(outDir, `batch-${String(files).padStart(3, '0')}.json`),
        JSON.stringify({ system: LLM_SYSTEM, rows: cards.slice(i, i + perAgent) }, null, 1),
    );
    files++;
}
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify({
    total: cards.length, perAgent, files, pinned, unpinned: cards.length - pinned,
}, null, 1));
console.log(`${cards.length} cards (${pinned} with a real shopper phrase, ${cards.length - pinned} without)`);
console.log(`-> ${files} batch file(s) of <=${perAgent} rows in ${outDir}`);
