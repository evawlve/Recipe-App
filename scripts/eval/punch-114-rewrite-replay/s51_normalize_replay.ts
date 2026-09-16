/**
 * s51_normalize_replay.ts — Lane A S51 ROW 2 (backend punch #114). PURE: no DB, no LLM, no network.
 * ==========================================================================
 *   --mode run  --args s51_normalize_args.jsonl --corpus scripts/eval/coverage-corpus-2026-08-08.tsv --out <tree>.jsonl
 *       cwd = the tree under test. Emits, one JSON line each: the tree's provenance; every
 *       self-growing rewrite it can see (data file, DEFAULT_RULES source text, the in-code
 *       `gluten` literal); `normalizeIngredientName(arg)` for every captured argument; the
 *       explicit strings; every corpus seed (column 3) direct AND through parseIngredientLine().
 *   --mode diff --a master.jsonl --b branch.jsonl --args s51_normalize_args.jsonl
 *       Diffs by argument / string / seed and prints the report.
 * The COLLAPSED-RUN classifier is written independently of collapseAdjacentRepeatedRuns():
 * it searches for a sequence of single adjacent-repeated-run removals turning A into B.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const arg = (n: string): string | null => {
    const i = process.argv.indexOf(n);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};

const EXPLICIT = [
    'dark corn syrup', 'apple pie spice seasoning', 'vital wheat gluten',
    'light corn syrup', 'corn syrup', 'gluten', 'wheat gluten', 'vital wheat gluten flour',
    'gluten free bread', 'mahi mahi', 'bang bang shrimp', 'half and half',
];

const COMBINING = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const toks = (s: string) => s.split(/\s+/).filter(Boolean);

function hasAdjacentRun(t: string[]): boolean {
    const l = t.map(x => x.toLowerCase());
    for (let k = 1; k <= Math.floor(l.length / 2); k++) {
        for (let i = 0; i + 2 * k <= l.length; i++) {
            let same = true;
            for (let j = 0; j < k; j++) if (l[i + j] !== l[i + k + j]) { same = false; break; }
            if (same) return true;
        }
    }
    return false;
}
const hasAnyRepeat = (t: string[]) => new Set(t.map(x => x.toLowerCase())).size < t.length;
const dupCount = (t: string[]) => t.length - new Set(t.map(x => x.toLowerCase())).size;

/** Can B be reached from A by removing one adjacent repeated run (the second copy) at a time? */
function reachableByRunRemovals(a: string, b: string): boolean {
    const target = toks(b).join(' ');
    let frontier = new Set<string>([toks(a).join(' ')]);
    const seen = new Set(frontier);
    for (let depth = 0; depth < 20 && frontier.size; depth++) {
        const next = new Set<string>();
        for (const s of frontier) {
            const t = s.split(' ');
            const l = t.map(x => x.toLowerCase());
            for (let k = 1; k <= Math.floor(t.length / 2); k++) {
                for (let i = 0; i + 2 * k <= t.length; i++) {
                    let same = true;
                    for (let j = 0; j < k; j++) if (l[i + j] !== l[i + k + j]) { same = false; break; }
                    if (!same) continue;
                    const n = [...t.slice(0, i + k), ...t.slice(i + 2 * k)].join(' ');
                    if (n === target) return true;
                    if (!seen.has(n)) { seen.add(n); next.add(n); }
                }
            }
        }
        frontier = next;
    }
    return false;
}

// ---------------------------------------------------------------- run
function doRun() {
    const argsPath = arg('--args'); const corpusPath = arg('--corpus'); const outPath = arg('--out');
    if (!argsPath || !corpusPath || !outPath) { console.error('run needs --args --corpus --out'); process.exit(1); }
    const cwd = process.cwd();
    const nr = require('@/lib/mapping/normalization-rules');
    const { parseIngredientLine } = require('@/lib/parse/ingredient-line');
    const rulesPath = path.join(cwd, 'data/fatsecret/normalization-rules.json');
    const rulesBuf = fs.readFileSync(rulesPath);
    const rules = JSON.parse(rulesBuf.toString('utf8'));
    const srcPath = require.resolve('@/lib/mapping/normalization-rules');
    const srcText = fs.readFileSync(srcPath, 'utf8');
    const out: string[] = [];
    const emit = (o: any) => out.push(JSON.stringify(o));

    emit({ kind: 'tree', cwd, resolved: srcPath, rulesSha256: crypto.createHash('sha256').update(rulesBuf).digest('hex'),
        srcSha256: crypto.createHash('sha256').update(srcText).digest('hex'),
        hasCollapseExport: typeof nr.collapseAdjacentRepeatedRuns === 'function', dataRewrites: rules.synonym_rewrites.length });

    // self-growing: data file
    rules.synonym_rewrites.forEach((r: any, idx: number) => {
        if (r.from.toLowerCase() !== r.to.toLowerCase() && r.to.toLowerCase().includes(r.from.toLowerCase())) {
            emit({ kind: 'selfgrowing', source: 'data', idx, from: r.from, to: r.to, unlessFollowedBy: r.unlessFollowedBy ?? null });
        }
    });
    // self-growing: DEFAULT_RULES source text (not exported)
    const re = /\{\s*from:\s*'((?:[^'\\]|\\.)*)',\s*to:\s*'((?:[^'\\]|\\.)*)'/g;
    let m: RegExpExecArray | null; let n = 0;
    while ((m = re.exec(srcText))) {
        n++;
        const from = m[1]; const to = m[2];
        if (from.toLowerCase() !== to.toLowerCase() && to.toLowerCase().includes(from.toLowerCase())) {
            emit({ kind: 'selfgrowing', source: 'default', idx: n - 1, from, to });
        }
    }
    emit({ kind: 'defaultRewriteCount', n });
    emit({ kind: 'selfgrowing', source: 'in-code', idx: -1, from: 'gluten', to: 'vital wheat gluten', guard: 'not gluten[-\\s]free' });

    const norm = (s: string) => {
        const r = nr.normalizeIngredientName(s);
        return { cleaned: r.cleaned, nounOnly: r.nounOnly, stripped: r.stripped };
    };
    const brandLed = (s: string) => nr.isBrandLedProductName(s.normalize('NFD').replace(COMBINING, ''));

    for (const line of fs.readFileSync(argsPath, 'utf8').split('\n').filter(Boolean)) {
        const a = JSON.parse(line);
        emit({ kind: 'arg', arg: a.arg, brandLed: brandLed(a.arg), ...norm(a.arg) });
    }
    for (const s of EXPLICIT) emit({ kind: 'explicit', arg: s, brandLed: brandLed(s), ...norm(s) });

    const corpus = fs.readFileSync(corpusPath, 'utf8').split('\n').filter(Boolean);
    const header = corpus.shift();
    if (header !== 'domain\tbaseline\tseed') throw new Error(`corpus header ${header}`);
    for (const l of corpus) {
        const [domain, baseline, seed] = l.split('\t');
        const parsedName = parseIngredientLine(seed)?.name?.trim() || seed;
        emit({ kind: 'corpus', seed, domain, baseline, brandLed: brandLed(seed), cleaned: nr.normalizeIngredientName(seed).cleaned,
            parsedName, cleanedParsed: nr.normalizeIngredientName(parsedName).cleaned });
    }
    fs.writeFileSync(outPath, out.join('\n') + '\n');
    console.log(`run ok: cwd=${cwd} resolved=${srcPath} hasCollapseExport=${typeof nr.collapseAdjacentRepeatedRuns === 'function'} -> ${outPath} (${out.length} lines)`);
}

// ---------------------------------------------------------------- diff
function doDiff() {
    const aPath = arg('--a'); const bPath = arg('--b'); const argsPath = arg('--args');
    if (!aPath || !bPath || !argsPath) { console.error('diff needs --a --b --args'); process.exit(1); }
    const load = (p: string) => fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const A = load(aPath); const B = load(bPath);
    const captured = load(argsPath);
    const P = console.log;
    const treeA = A.find((r: any) => r.kind === 'tree'); const treeB = B.find((r: any) => r.kind === 'tree');
    P('== TREES'); P(`A ${JSON.stringify(treeA)}`); P(`B ${JSON.stringify(treeB)}`);
    P(`data file identical across trees: ${treeA.rulesSha256 === treeB.rulesSha256}`);

    const sg = A.filter((r: any) => r.kind === 'selfgrowing');
    P(''); P('== SELF-GROWING REWRITES (tree A; predicate: from !== to and to contains from)');
    P(`data ${sg.filter((s: any) => s.source === 'data').length} (distinct pairs ${new Set(sg.filter((s: any) => s.source === 'data').map((s: any) => `${s.from}>${s.to}`)).size}) · ` +
        `DEFAULT_RULES ${sg.filter((s: any) => s.source === 'default').length} of ${A.find((r: any) => r.kind === 'defaultRewriteCount').n} · in-code 1`);
    for (const s of sg) P(`  [${s.source}${s.idx >= 0 ? ` #${s.idx}` : ''}] ${s.from} -> ${s.to}`);

    // ---- args
    const aArgs = new Map<string, any>(A.filter((r: any) => r.kind === 'arg').map((r: any) => [r.arg, r]));
    const bArgs = new Map<string, any>(B.filter((r: any) => r.kind === 'arg').map((r: any) => [r.arg, r]));
    const capMap = new Map<string, any>(captured.map((c: any) => [c.arg, c]));
    let reproduced = 0; const notReproduced: string[] = [];
    for (const c of captured) {
        const a = aArgs.get(c.arg);
        if (a && a.cleaned === c.masterCleaned && a.nounOnly === c.masterNounOnly) reproduced++; else notReproduced.push(c.arg);
    }
    P(''); P('== CAPTURED ARGUMENTS');
    P(`captured distinct args ${captured.length}; tree A replay reproduces the in-mapper capture (cleaned+nounOnly) on ${reproduced}/${captured.length}` +
        (notReproduced.length ? `  NOT: ${JSON.stringify(notReproduced)}` : ''));

    const fromHits = (s: string, source: string) => sg.filter((g: any) => g.source === source && (source === 'in-code'
        ? /\bgluten\b/i.test(s) && !/\bgluten[-\s]free\b/i.test(s)
        : new RegExp(`\\b${escapeRegex(g.from)}\\b`, 'i').test(s)));
    let cleanedMovers = 0, nounMovers = 0, strippedMovers = 0;
    const moverRows: string[] = [];
    let collapsed = 0, other = 0;
    let containsAny = 0, containsData = 0, containsDefault = 0, containsInCode = 0;
    let containsAndMasterRepeat = 0, containsAndMoved = 0, masterAdjRepeat = 0, movedWithoutContains = 0;
    const containsNoRepeat: string[] = [];
    for (const c of captured) {
        const a = aArgs.get(c.arg); const b = bArgs.get(c.arg);
        const dData = fromHits(c.arg, 'data'), dDef = fromHits(c.arg, 'default'), dCode = fromHits(c.arg, 'in-code');
        const contains = dData.length + dDef.length + dCode.length > 0;
        const mAdj = hasAdjacentRun(toks(a.cleaned));
        if (mAdj) masterAdjRepeat++;
        if (dData.length) containsData++; if (dDef.length) containsDefault++; if (dCode.length) containsInCode++;
        const cm = a.cleaned !== b.cleaned; const nm = a.nounOnly !== b.nounOnly; const sm = JSON.stringify(a.stripped) !== JSON.stringify(b.stripped);
        if (contains) {
            containsAny++;
            if (mAdj) containsAndMasterRepeat++;
            if (cm) containsAndMoved++;
            if (!mAdj) containsNoRepeat.push(`${c.arg} => ${a.cleaned}${a.brandLed ? '  [brand-led]' : ''}  {${[...dData, ...dDef, ...dCode].map((g: any) => `${g.source}:${g.from}`).join(', ')}}`);
        } else if (cm) movedWithoutContains++;
        if (cm) cleanedMovers++; if (nm) nounMovers++; if (sm) strippedMovers++;
        if (cm || nm || sm) {
            const cls = (!cm || reachableByRunRemovals(a.cleaned, b.cleaned)) && (!nm || reachableByRunRemovals(a.nounOnly, b.nounOnly)) && !sm ? 'COLLAPSED-RUN' : 'OTHER';
            if (cls === 'COLLAPSED-RUN') collapsed++; else other++;
            const inputRepeat = hasAdjacentRun(toks(c.arg.replace(/\s+/g, ' ')));
            const cause = contains ? `contains {${[...dData, ...dDef, ...dCode].map((g: any) => `${g.source}:${g.from}`).join(', ')}}` : 'contains no self-growing from';
            moverRows.push(`  ${cls.padEnd(13)} ${JSON.stringify(c.arg)}  cleaned: ${JSON.stringify(a.cleaned)} -> ${JSON.stringify(b.cleaned)}` +
                `${nm ? `  nounOnly: ${JSON.stringify(a.nounOnly)} -> ${JSON.stringify(b.nounOnly)}` : '  nounOnly: same'}${sm ? `  stripped: ${JSON.stringify(a.stripped)} -> ${JSON.stringify(b.stripped)}` : ''}` +
                `  | ${cause}${inputRepeat ? ' | INPUT ALREADY REPEATS' : ''}${hasAdjacentRun(toks(b.cleaned)) ? ' | BRANCH STILL ADJ-REPEATS' : ''}${hasAnyRepeat(toks(b.cleaned)) ? ' | branch any-repeat' : ''}` +
                `  | prov composite=${capMap.get(c.arg).compositeTuples} solo=${capMap.get(c.arg).soloMelLines} (events ${capMap.get(c.arg).soloMelEvents})`);
        }
    }
    P(`args whose cleaned differs: ${cleanedMovers}; nounOnly differs: ${nounMovers}; stripped differs: ${strippedMovers}`);
    P(`movers by class: COLLAPSED-RUN ${collapsed}, OTHER ${other}`);
    for (const r of moverRows) P(r);
    P(`master cleaned has an adjacent repeated run: ${masterAdjRepeat} of ${captured.length}`);
    const adjNonMovers = captured.filter((c: any) => hasAdjacentRun(toks(aArgs.get(c.arg).cleaned)) && aArgs.get(c.arg).cleaned === bArgs.get(c.arg).cleaned);
    P(`  ...of which the branch does NOT move (${adjNonMovers.length}):`);
    for (const c of adjNonMovers) {
        const a = aArgs.get(c.arg);
        P(`    ${JSON.stringify(c.arg)} => ${JSON.stringify(a.cleaned)}${a.brandLed ? ' [brand-led]' : ''}${hasAdjacentRun(toks(c.arg)) ? ' [input already adj-repeats]' : ''}  prov composite=${c.compositeTuples} solo=${c.soloMelLines}`);
    }

    P(''); P('== REFUTER: inert dedupe, or inputs that never carry a self-growing rewrite?');
    P(`args containing a self-growing from (word-boundary, case-insensitive): any ${containsAny} · data ${containsData} · DEFAULT_RULES ${containsDefault} · in-code gluten ${containsInCode}`);
    P(`  ...of which master cleaned carries an adjacent repeated run: ${containsAndMasterRepeat}`);
    P(`  ...of which the branch moves cleaned: ${containsAndMoved}`);
    P(`movers that contain no self-growing from: ${movedWithoutContains}`);
    P(`mover count ${cleanedMovers} ${cleanedMovers === containsAndMasterRepeat ? '==' : '!='} contains-and-repeats-on-master ${containsAndMasterRepeat}`);
    P(`contains a from but master does NOT repeat (${containsNoRepeat.length}):`);
    for (const r of containsNoRepeat) P(`  ${r}`);

    // ---- explicit
    P(''); P('== EXPLICIT STRINGS (both trees)');
    const aEx = new Map<string, any>(A.filter((r: any) => r.kind === 'explicit').map((r: any) => [r.arg, r]));
    const bEx = new Map<string, any>(B.filter((r: any) => r.kind === 'explicit').map((r: any) => [r.arg, r]));
    for (const s of EXPLICIT) {
        const a = aEx.get(s); const b = bEx.get(s);
        P(`  ${JSON.stringify(s).padEnd(28)} in-population=${capMap.has(s)} brandLed=${a.brandLed}  master ${JSON.stringify(a.cleaned)} / nounOnly ${JSON.stringify(a.nounOnly)}` +
            `  ->  branch ${JSON.stringify(b.cleaned)} / nounOnly ${JSON.stringify(b.nounOnly)}  ${a.cleaned === b.cleaned && a.nounOnly === b.nounOnly ? 'SAME' : 'MOVED'}`);
    }

    // ---- corpus
    P(''); P('== S47 CORPUS PREDICATE (scripts/eval/coverage-corpus-2026-08-08.tsv, column 3)');
    const aC = A.filter((r: any) => r.kind === 'corpus'); const bC = B.filter((r: any) => r.kind === 'corpus');
    if (aC.length !== bC.length) throw new Error('corpus length mismatch');
    const report = (label: string, field: 'cleaned' | 'cleanedParsed', base: (r: any) => string) => {
        for (const [tree, rows] of [['master', aC], ['branch', bC]] as const) {
            const adj = rows.filter((r: any) => hasAdjacentRun(toks(r[field])));
            const any = rows.filter((r: any) => hasAnyRepeat(toks(r[field])));
            const gained = rows.filter((r: any) => dupCount(toks(r[field])) > dupCount(toks(base(r))));
            const gainedAdj = rows.filter((r: any) => hasAdjacentRun(toks(r[field])) && !hasAdjacentRun(toks(base(r))));
            P(`  [${label}] ${tree}: adjacent-repeat ${adj.length} · any-repeat ${any.length} · gained-a-repeat (dup count up vs input) ${gained.length} · gained-adjacent ${gainedAdj.length}  of ${rows.length}`);
            P(`      adjacent: ${JSON.stringify(adj.map((r: any) => `${r.seed} => ${r[field]}${r.brandLed ? ' [brand-led]' : ''}${hasAdjacentRun(toks(base(r))) ? ' [input already adj-repeats]' : ''}`))}`);
            P(`      gained  : ${JSON.stringify(gained.map((r: any) => `${r.seed} => ${r[field]}`))}`);
        }
    };
    report('direct seed', 'cleaned', r => r.seed);
    report('parseIngredientLine -> normalize (S47 walk)', 'cleanedParsed', r => r.parsedName);
    const movedSeeds = aC.map((r: any, i: number) => [r, bC[i]]).filter(([a, b]: any) => a.cleaned !== b.cleaned || a.cleanedParsed !== b.cleanedParsed);
    P(`  corpus seeds whose output moves (direct or parsed walk): ${movedSeeds.length}`);
    for (const [a, b] of movedSeeds as any) P(`    ${JSON.stringify(a.seed)}  direct ${JSON.stringify(a.cleaned)} -> ${JSON.stringify(b.cleaned)}  parsed ${JSON.stringify(a.cleanedParsed)} -> ${JSON.stringify(b.cleanedParsed)}  ${reachableByRunRemovals(a.cleaned, b.cleaned) && reachableByRunRemovals(a.cleanedParsed, b.cleanedParsed) ? 'COLLAPSED-RUN' : 'OTHER'}`);
}

const mode = arg('--mode');
if (mode === 'run') doRun();
else if (mode === 'diff') doDiff();
else { console.error('usage: --mode run|diff'); process.exit(1); }
