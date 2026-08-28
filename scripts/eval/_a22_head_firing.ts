/**
 * A22 — how often does the EMPIRICAL head actually move, and where does admission empty?
 *
 * Read-only. Takes one or more `winner-diff snapshot` files and, for every entry, asks the
 * SHIPPED `deriveMustHaveTokens()` twice — once with the pool and once without — then runs the
 * SHIPPED `filterCandidatesByTokens()` to see what admission keeps. Never a replica predicate
 * (memory `helper-number-must-come-from-the-shipped-function`).
 *
 * Recipe (2026-08-27, the numbers in the owner report):
 *   1. cut the two-slot brand-detected population from the coverage corpus by calling
 *      deriveMustHaveTokens() + detectBrandInQuery() over column 3 of
 *      `coverage-corpus-2026-08-08.tsv` — lines with 2 must-have tokens on a brand-detected
 *      query are the ones a head governs (1,614 of 4,102);
 *   2. `winner-diff.ts snapshot --from-file <those lines> --limit <count> --out <snap>`
 *      (--limit is load-bearing: the default is 200 and it slices);
 *   3. this script over the snapshot(s).
 *
 * Measured over 473 of the 1,614: 8 lines (1.7%) admit ZERO today, the head moves on 2, and
 * both movers land on the right record. Owner: KindaHealthyMobile
 * sync-docs/reports/2026-08-27_a22-the-empirical-head-and-the-faces-that-were-never-admission.md
 */
import * as fs from 'fs';
import { filterCandidatesByTokens, deriveMustHaveTokens } from '../../src/lib/mapping/filter-candidates';

let n = 0, moved = 0, emptied = 0;
const movers: string[] = [];
const empties: string[] = [];

for (const file of process.argv.slice(2)) {
    for (const e of JSON.parse(fs.readFileSync(file, 'utf8')).entries) {
        if (!e.ok) continue;
        n++;
        const positional = deriveMustHaveTokens(e.normalizedName);
        const empirical = deriveMustHaveTokens(e.normalizedName, e.candidates);
        const kept = filterCandidatesByTokens(e.candidates, e.normalizedName,
            { rawLine: e.gatherRawLine ?? e.query }).filtered;
        if (kept.length === 0) {
            emptied++;
            empties.push(`${e.query}  [${positional.join('+')}]  pool=${e.candidates.length}`);
        }
        if (JSON.stringify(positional) === JSON.stringify(empirical)) continue;
        moved++;
        const label = (c: any) => (c.name + (c.brandName ? ` [${c.brandName}]` : '')).slice(0, 46);
        movers.push(`${e.query}\n     [${positional.join('+')}] -> [${empirical.join('+')}]`
            + `   pool=${e.candidates.length} kept=${kept.length}`
            + `\n     kept: ${kept.slice(0, 4).map(label).join(' | ')}`);
    }
}

console.log(`queries: ${n}`);
console.log(`head MOVED (empirical != positional): ${moved}`);
console.log(`admission keeps ZERO (the relax pass decides): ${emptied}`);
console.log('\n--- MOVERS ---');
movers.forEach(m => console.log('  ' + m));
console.log('\n--- EMPTY-POOL LINES ---');
empties.forEach(m => console.log('  ' + m));
