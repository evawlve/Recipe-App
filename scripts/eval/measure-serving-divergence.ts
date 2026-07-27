/**
 * measure-serving-divergence.ts — how far the screen's serving RECONSTRUCTION is
 * from the anchor the request path actually bills.
 *
 * correctness-screen.ts carried this caveat from the day it shipped:
 *
 *   "The serving check is a RECONSTRUCTION. resolveServingGrams reimplements the
 *    billing anchor and never calls hydrateAndSelectServing ... A row D5 calls
 *    'no serving weight' MAY IN FACT BILL CORRECTLY. **This was not measured.**"
 *
 * This measures it, over the same 81 hand-labelled batch-01 rows the pinned
 * confusion matrix is built from. Read-only: it resolves servings and prints; it
 * writes nothing.
 *
 *   npx ts-node --project tsconfig.scripts.json --transpile-only \
 *     -r tsconfig-paths/register scripts/eval/measure-serving-divergence.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { ScreenRow, resolveServingGrams, resolveRealServings, realServing } from './correctness-screen';

const FIXTURE = path.join(__dirname, '__tests__', 'fixtures', 'correctness-screen-batch01.json');

async function main(): Promise<number> {
    const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as {
        rows: Array<{ verdict: string; row: ScreenRow }>;
    };
    const rows = fx.rows.map(e => e.row);
    const verdicts = new Map(fx.rows.map(e => [e.row.key, e.verdict]));

    const before = rows.map(r => resolveServingGrams(r));
    await resolveRealServings(rows);

    let agree = 0, differ = 0, errored = 0, nullBoth = 0;
    const moved: Array<{ key: string; from: number | null; to: number | null; tier: string | null; verdict: string }> = [];

    rows.forEach((r, i) => {
        if (r.real?.error) { errored++; return; }
        const a = before[i].grams;
        // Compare what D5/D6 actually consume, i.e. AFTER flat-100g normalisation —
        // comparing raw grams counts the flat-100g fallback as a disagreement when
        // both sides are saying "there is no anchor here".
        const b = realServing(r).grams;
        if (a == null && b == null) { nullBoth++; agree++; return; }
        if (a != null && b != null && Math.abs(a - b) < 0.01) { agree++; return; }
        differ++;
        moved.push({ key: r.key, from: a, to: b, tier: r.real?.tier ?? null, verdict: verdictOf(verdicts, r.key) });
    });

    console.log(`\nSERVING RECONSTRUCTION vs REAL ANCHOR — ${rows.length} batch-01 rows`);
    console.log(`  agree            ${agree}   (of which both-null: ${nullBoth})`);
    console.log(`  DIFFER           ${differ}`);
    console.log(`  errored          ${errored}`);
    console.log(`  agreement rate   ${((agree / Math.max(1, rows.length - errored)) * 100).toFixed(1)}%\n`);

    if (moved.length) {
        console.log('rows where the screen judged a number the user is NOT billed:');
        for (const m of moved.slice(0, 40)) {
            console.log(`  ${m.verdict.padEnd(8)} ${m.key.slice(0, 46).padEnd(46)} ${fmt(m.from)} -> ${fmt(m.to)}  ${m.tier ?? ''}`);
        }
        if (moved.length > 40) console.log(`  ... and ${moved.length - 40} more`);
    }

    // The number that matters for the pinned matrix: does a D5/D6 verdict flip?
    const flips = rows.filter((r, i) => {
        const a = before[i].grams, b = realServing(r).grams;
        return d56(a) !== d56(b);
    });
    console.log(`\nD5/D6 verdict flips: ${flips.length} of ${rows.length}`);
    for (const r of flips.slice(0, 20)) {
        const i = rows.indexOf(r);
        console.log(`  ${verdictOf(verdicts, r.key).padEnd(8)} ${r.key.slice(0, 46).padEnd(46)} `
            + `${d56(before[i].grams)} -> ${d56(realServing(r).grams)}`);
    }
    return 0;
}

function d56(g: number | null): string {
    if (g == null) return 'D5';
    if (g < 5 || g > 500) return 'D6';
    return '-';
}
function fmt(g: number | null): string { return g == null ? 'none'.padStart(8) : `${g.toFixed(1)}g`.padStart(8); }
function verdictOf(m: Map<string, string>, k: string): string { return m.get(k) ?? '?'; }

main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(2); });
