/**
 * _replay_matchesalt.ts — OFFLINE replay of the matchesAlt() normalization change
 * (hyphen/space variants, 2026-08-07) over recorded eval results files. Makes NO
 * network calls and NO writes: it re-scores the NAME assertions of every recorded
 * case under the OLD (raw substring) and NEW (normalized) matcher and enumerates
 * every case whose verdict would change.
 *
 * Usage:
 *   ts-node --project tsconfig.scripts.json --transpile-only scripts/eval/_replay_matchesalt.ts \
 *     --results-dir scripts/eval/results \
 *     eval-2026-08-07T05-01-01-159Z.json eval-2026-08-07T05-04-14-960Z.json ...
 *
 * WHAT IT CAN AND CANNOT SEE (honest limitations, from the results-file shape):
 *  - A results file records `observed` for items[0] ONLY (foodName, no brand), plus
 *    the `detail` string. For an nlp case that FAILED its name check, detail carries
 *    EVERY item's foodName (`name mismatch: ["a", "b", NO PICK (abstained)]`), which
 *    is exactly the population a red→green flip needs. For a search case that failed,
 *    detail carries the topN names — again the flip population.
 *  - A PASSING case cannot flip to red here: the new matcher is a strict superset of
 *    the old for every non-degenerate sub (same char-class normalization applied to
 *    both sides preserves containment), and the golden set has ZERO forbidName cases
 *    (asserted below, fail-closed) — forbidName is the only relaxation-can-hurt path.
 *  - Brand text is not recorded, so a flip that would occur only via the brand half
 *    of textOf() is invisible; that can UNDERCOUNT flips, never invent one.
 *
 * Also replays the n-mq-34 total.calories band (added in the same PR) against each
 * file's recorded observed.kcal, since that band decision rides on the same runs.
 */

import * as fs from 'fs';
import * as path from 'path';
import { matchesAlt as matchesAltNew } from './assertions';

/** The pre-2026-08-07 matcher, verbatim: raw substring containment. */
function matchesAltOld(text: string, alternatives: string[][]): boolean {
    return alternatives.some(alt => alt.every(sub => text.includes(sub.toLowerCase())));
}

function parseArgs() {
    const argv = process.argv.slice(2);
    let resultsDir = path.join(__dirname, 'results');
    const files: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--results-dir') { resultsDir = argv[++i]; continue; }
        files.push(argv[i]);
    }
    return { resultsDir, files };
}

/** Extract every recorded item name from an nlp failure detail, tagging abstentions. */
function namesFromNlpMismatch(detail: string): string[] | null {
    const m = detail.match(/name mismatch: \[(.*?)\](?:;|$)/);
    if (!m) return null;
    const names: string[] = [];
    // entries are `"name"` or bare `NO PICK (abstained)`; abstentions can never
    // satisfy a name assertion (guarded outside the matcher), so skip them.
    const re = /"((?:[^"\\]|\\.)*)"/g;
    let q: RegExpExecArray | null;
    while ((q = re.exec(m[1])) !== null) names.push(q[1]);
    return names;
}

/** Extract the topN names from a search failure detail (last segment after any `|`). */
function namesFromSearchDetail(detail: string): string[] | null {
    const seg = detail.split('|').pop() ?? '';
    const m = seg.match(/top\d+: \[(.*)\]/);
    if (!m) return null;
    if (m[1].trim() === 'EMPTY') return [];
    const names: string[] = [];
    const re = /"((?:[^"\\]|\\.)*)"/g;
    let q: RegExpExecArray | null;
    while ((q = re.exec(m[1])) !== null) names.push(q[1]);
    return names;
}

function main() {
    const { resultsDir, files } = parseArgs();
    if (files.length === 0) {
        console.error('no results files given');
        process.exit(2);
    }

    const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden-set.json'), 'utf8'));
    const specById = new Map<string, any>();
    for (const c of golden.search) specById.set(c.id, { kind: 'search', ...c });
    for (const c of golden.nlp) specById.set(c.id, { kind: 'nlp', ...c });

    // Fail-closed guard on the one relaxation-can-hurt path: forbidName. If a case
    // ever grows one, this replay's "passing cases cannot regress" argument dies
    // with it, so refuse to run rather than under-report.
    const forbids = golden.nlp.filter((c: any) => c.forbidName);
    if (forbids.length > 0) {
        console.error(`REFUSING: golden set now has forbidName cases (${forbids.map((c: any) => c.id).join(', ')}) — a matcher relaxation CAN flip these green→red and this replay's recorded data cannot fully re-score them.`);
        process.exit(2);
    }

    let flips = 0;
    let partials = 0;
    let unevaluable = 0;

    for (const f of files) {
        const full = path.isAbsolute(f) ? f : path.join(resultsDir, f);
        const run = JSON.parse(fs.readFileSync(full, 'utf8'));
        console.log(`\n=== ${path.basename(full)}  (noCache=${run.summary?.noCache} base=${run.summary?.base} buildId=${run.summary?.buildId ?? 'n/a'}) ===`);

        for (const r of run.results) {
            const spec = specById.get(r.id);
            if (!spec) { console.log(`  [${r.id}] NOT IN CURRENT GOLDEN SET — skipped`); continue; }

            if (r.pass) {
                // Superset argument + zero forbidName ⇒ cannot regress. Spot-verify on
                // the one recorded name anyway: OLD-matched implies NEW-matched.
                const alts = spec.kind === 'nlp' ? spec.expectName : spec.match;
                const name = r.observed?.foodName;
                if (alts && typeof name === 'string') {
                    const t = `${name} `.toLowerCase();
                    if (matchesAltOld(t, alts) && !matchesAltNew(t, alts)) {
                        console.log(`  [${r.id}] !! REGRESSION on recorded name "${name}" — old matched, new does not`);
                        flips++;
                    }
                }
                continue;
            }

            // Failing case: can the name component flip under the new matcher?
            if (spec.kind === 'nlp') {
                if (!spec.expectName) continue;
                const names = namesFromNlpMismatch(r.detail);
                if (names === null) {
                    // failed, but not on the name check (band/grams/items/transport) —
                    // the matcher change cannot touch it.
                    continue;
                }
                const oldAny = names.some(n => matchesAltOld(`${n} `.toLowerCase(), spec.expectName));
                const newAny = names.some(n => matchesAltNew(`${n} `.toLowerCase(), spec.expectName));
                if (oldAny !== newAny) {
                    // Did the name mismatch stand alone, or were there other failures?
                    const otherFailures = r.detail.split('; ').filter((s: string) => !s.startsWith('name mismatch:'));
                    if (otherFailures.length === 0) {
                        console.log(`  [${r.id}] FLIP red→green: "${names.join('", "')}" now satisfies expectName ${JSON.stringify(spec.expectName)}`);
                        flips++;
                    } else {
                        console.log(`  [${r.id}] name component resolves but case stays RED (other failures: ${otherFailures.join('; ')})`);
                        partials++;
                    }
                }
            } else {
                const names = namesFromSearchDetail(r.detail);
                if (names === null) { unevaluable++; continue; }
                const oldAny = names.some(n => matchesAltOld(`${n} `.toLowerCase(), spec.match));
                const newAny = names.some(n => matchesAltNew(`${n} `.toLowerCase(), spec.match));
                if (oldAny !== newAny) {
                    const gutted = /LIST TOO SHORT|NULL-NUTRITION/.test(r.detail);
                    if (!gutted) {
                        console.log(`  [${r.id}] FLIP red→green (search): topN now matches ${JSON.stringify(spec.match)}`);
                        flips++;
                    } else {
                        console.log(`  [${r.id}] search match resolves but case stays RED (${r.detail.split('|')[0].trim()})`);
                        partials++;
                    }
                }
            }
        }

        // n-mq-34 band replay: total.calories [130,160] against recorded observed.kcal.
        const mq34 = run.results.find((r: any) => r.id === 'n-mq-34');
        if (mq34?.observed) {
            const kcal = mq34.observed.kcal;
            const inBand = typeof kcal === 'number' && kcal >= 130 && kcal <= 160;
            console.log(`  [n-mq-34 band] observed kcal=${kcal} (${mq34.observed.foodId}) → total.calories [130,160] would ${inBand ? 'PASS' : 'FAIL'}; recorded pass=${mq34.pass}`);
        }
    }

    console.log(`\nTOTAL verdict flips: ${flips}, name-component-only changes (case stays red): ${partials}, unevaluable search fails: ${unevaluable}`);
}

main();
