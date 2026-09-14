/**
 * s49row3_predicate.ts — Lane A S49 ROW 3. The RECOVERED PREDICATE, as code.
 *
 * PURE. No DB, no LLM, no writes, no network. Reads the committed 1,553-row
 * anc-rows.tsv block out of the mobile repo's S47 salvage appendix and selects
 * the DOUBLING population: AiNormalizeCache rows whose stored `rawLine` (col2 —
 * the post-repair baseName the mapper handed aiNormalizeIngredient()) is
 * `<brand> <tail>` where the tail ALREADY carries that brand in a spelling the
 * shipped containment check cannot see.
 *
 * TRAP: the block's separator is the LITERAL two characters `\` `t`, not tab
 * bytes. Splitting on a real tab reads every line as ONE field and returns
 * nothing.
 *
 * TWO PREDICATES, because they select DIFFERENT populations and the difference
 * is itself the finding:
 *
 *   P-LEX  — the prepended brand must be one `detectBrandInQuery()` can name.
 *            UNDER-SELECTS by exactly the detector's own reachability defect:
 *            `Noodles & Company` returns {isBranded:false} on this tree, so a
 *            row the segmenter branded is invisible to P-LEX.
 *   P-SELF — lexicon-free. A leading token run whose FOLDED form recurs later
 *            in the same string. Needs no brand list, so it sees segmenter
 *            brands the detector cannot, at the cost of admitting a repeated
 *            food word.
 *
 * Both are scored against four containment tests, so the caller can see which
 * test would stop which row:
 *   (a) TODAY     shipped `baseName.toLowerCase().includes(lowerBrand)`
 *   (b) #407 FOLD `canonicalizeBrandKey()`, still CONTIGUOUS (verbatim 903dd09)
 *   (c) TOKEN-SET folded brand tokens as a SUBSET of folded name tokens
 *   (d) GUARD-2   the SHIPPED `repairDroppedBrand()`, which already folds
 *                 alphanumerically AND carries a plural rule
 * A test "DBL" means that test still doubles the brand, i.e. does NOT fix the row.
 */
import * as fs from 'fs';
import { detectBrandInQuery } from '@/lib/mapping/brand-detector';
import { repairDroppedBrand } from '@/lib/mapping/quantity-word-brand';

const APPENDIX = '/Users/diego/dev/KindaHealthyMobile/sync-docs/reports/2026-09-11_lane-a-s47-appendix-scratchpad-salvage.md';

/** VERBATIM from `git show 903dd09:src/lib/mapping/brand-detector.ts` — the #407 fold. */
function canonicalizeBrandKey(value: string): string {
    return value.toLowerCase().replace(/['’`]/g, '').replace(/&/g, ' and ')
        .replace(/[-.\/]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const folded = (s: string) => canonicalizeBrandKey(s).split(' ').filter(Boolean);

function tokenSetCovers(brand: string, name: string): boolean {
    const bt = folded(brand); const nt = new Set(folded(name));
    return bt.length > 0 && bt.every(t => nt.has(t));
}

/**
 * The brand prefix must be recovered in the SPELLING THAT WAS PREPENDED, not the
 * lexicon spelling. preserveDroppedBrand() built the stored name as
 * `${targetBrand} ${rederived}` and `targetBrand` is `options.brand` (the
 * segmenter's) whenever the composite path supplied one — so testing containment
 * against the lexicon's own rendering silently answers a different question.
 * `Ben & Jerry's ben and jerrys cherry garcia` is the worked case: the lexicon
 * spelling is `ben and jerrys`, which the tail DOES contain contiguously, so a
 * lexicon-spelling test reads "no doubling" on a row that is visibly doubled.
 */
function leadingRuns(s: string): Array<{ brand: string; tail: string }> {
    const toks = s.split(/\s+/).filter(Boolean);
    const out: Array<{ brand: string; tail: string }> = [];
    for (let k = Math.min(5, toks.length - 1); k >= 1; k--) {
        out.push({ brand: toks.slice(0, k).join(' '), tail: toks.slice(k).join(' ') });
    }
    return out;
}

const lines = fs.readFileSync(APPENDIX, 'utf8').split('\n').slice(1030, 2583);
const rows = lines.filter(l => l.trim()).map(l => l.split('\\t'));
if (rows.length !== 1553 || rows.some(r => r.length !== 4)) {
    console.warn(`UNEXPECTED census shape: ${rows.length} rows`); process.exit(2);
}

type Hit = {
    v: string; serves: number; base: string; norm: string; brand: string; tail: string;
    a: boolean; b: boolean; c: boolean; d: boolean; lex: boolean;
};

/**
 * A leading token run is a PREPENDED BRAND only if it actually RECURS downstream.
 * Without that requirement the longest-run search invents splits: `jack in the box
 * jumbo jack` reads as brand `jack in the box jumbo` + tail `jack`, when the truth
 * is brand `jack in the box` + the menu item `jumbo jack` — the trailing `jack` is
 * the FOOD, and nothing is doubled.
 *
 * Recurrence is matched on folded tokens with a trailing-`s` tolerance on tokens
 * longer than 3, which is the SAME plural rule the shipped `repairDroppedBrand()`
 * applies (`Pop-Tarts` -> `pop tart`). Without it `Ben & Jerry's and ben jerry`
 * is missed, because the tail carries the SINGULAR.
 */
const stem = (t: string) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t);
/** SET mode: every brand token recurs somewhere after the leading run, order-free.
 *  Catches the NON-ADJACENT (`optimum weigh nutrition`) and REORDERED
 *  (`and ben jerry`) shapes that contiguous recurrence cannot see. */
function recursLaterSet(bt: string[], st: string[]): boolean {
    const rest = st.slice(bt.length).map(stem);
    return bt.every(t => rest.includes(stem(t)));
}
const MODE = process.argv.includes('--set') ? 'set' : 'contiguous';
function recursLater(bt: string[], st: string[]): boolean {
    if (MODE === 'set') return recursLaterSet(bt, st);
    for (let i = bt.length; i + bt.length <= st.length; i++) {
        let ok = true;
        for (let j = 0; j < bt.length; j++) if (stem(st[i + j]) !== stem(bt[j])) { ok = false; break; }
        if (ok) return true;
    }
    return false;
}

function classify(base: string, norm: string, v: string, serves: number): Hit | null {
    const st = folded(base);
    for (const { brand, tail } of leadingRuns(base)) {
        const bt = folded(brand);
        if (bt.length === 0) continue;
        // the run must LEAD the folded string and RECUR downstream
        if (bt.some((t, i) => st[i] !== t)) continue;
        if (!recursLater(bt, st)) continue;
        // (a) the repair fired: the plain shipped check missed the brand in the tail.
        if (tail.toLowerCase().includes(brand.toLowerCase())) continue;
        const b = !canonicalizeBrandKey(tail).includes(canonicalizeBrandKey(brand));
        const c = !tokenSetCovers(brand, tail);
        const d = repairDroppedBrand(tail, brand) !== null;
        const det = detectBrandInQuery(brand);
        const lex = det.isBranded && folded(det.matchedBrand ?? '').length === bt.length;
        return { v, serves, base, norm, brand, tail, a: true, b, c, d, lex };
    }
    return null;
}

const hits: Hit[] = [];
for (const [v, useCount, base, norm] of rows) {
    const h = classify(base, norm, v, parseInt(useCount, 10) || 0);
    if (h) hits.push(h);
}

const rep = (label: string, set: Hit[]) => {
    const sv = (f: (h: Hit) => boolean) => set.filter(f).reduce((n, h) => n + h.serves, 0);
    console.warn(`${label}: ${set.length} rows, ${set.reduce((n, h) => n + h.serves, 0)} serves`);
    console.warn(`    NOT fixed by (b) #407 fold   : ${set.filter(h => h.b).length} rows, ${sv(h => h.b)} serves`);
    console.warn(`    NOT fixed by (c) token-set   : ${set.filter(h => h.c).length} rows, ${sv(h => h.c)} serves`);
    console.warn(`    NOT fixed by (d) guard-2 rule: ${set.filter(h => h.d).length} rows, ${sv(h => h.d)} serves`);
};

console.warn(`census rows scanned: ${rows.length}   recurrence MODE=${MODE}`);
rep('P-SELF (lexicon-free)', hits);
rep('P-LEX  (detector-nameable)', hits.filter(h => h.lex));
console.warn('');
console.warn('v\tserves\tlex\tb407\tctok\tdg2\tbrand\t|\ttail\t|\tmodel normalizedName');
for (const h of hits.sort((x, y) => y.serves - x.serves)) {
    console.warn(`${h.v}\t${h.serves}\t${h.lex ? 'Y' : 'n'}\t${h.b ? 'DBL' : 'fix'}\t${h.c ? 'DBL' : 'fix'}\t${h.d ? 'DBL' : 'fix'}\t${h.brand}\t|\t${h.tail}\t|\t${h.norm}`);
}
