/**
 * _pin_batch_seeds.ts — build the `key<TAB>phrase` pin file for ONE warm batch.
 *
 * WHY THIS EXISTS: attribution in the correctness screen is PINS ONLY (playbook §10).
 * The Jaccard fallback false-evicts at 44.8% vs 26.8% for pinned rows, so an unpinned
 * row is judged with an EMPTY shopper phrase and the seed-dependent rules abstain.
 * The whole-cache audit could only recover ~48% of phrases from telemetry. A warm batch
 * is in a strictly better position: THE PHRASE IS KNOWN. Every key the batch added was
 * written by warming one of the seed lines sitting in the batch file.
 *
 * The mapping from phrase to key is `canonicalizeCacheKey`, and this script IMPORTS it
 * rather than re-deriving it — the same rule _recover_seeds.ts follows for the same
 * reason. A transcription of that function is the exact bug class this whole exercise
 * is about (playbook §1: a probe that reimplements the caller is a different function).
 *
 * WHAT IT DOES NOT ASSUME: that `canonicalizeCacheKey(seed)` is always the key the row
 * landed under. It is not. The pipeline's AI normalize step rewrites names before the
 * key is computed — `bell pepper` -> `capsicum`, `shrimp` -> `prawns`, `fresh ginger` ->
 * `ginger` (measured 2026-07-20; the same finding that made repoint keys come from
 * MappingEventLog rather than from the seed). So a seed pin can MISS. It cannot be
 * WRONG in the dangerous direction unless two different seeds canonicalize to one key,
 * which is reported as a collision rather than silently resolved.
 *
 * The residue is filled by _recover_seeds.ts from MappingEventLog and merged in via
 * --merge, with SEED PINS WINNING: for a warm batch the seed is what was actually sent,
 * whereas the telemetry line is the most FREQUENT raw line for that key and may belong
 * to a real user's differently-worded query that canonicalizes to the same place.
 *
 * THE SEED LIST IS assembleSeeds(), NOT THE BATCH FILE. `warm-cache.ts --seed <file>`
 * ADDS the batch to the ~264-name standard corpus rather than replacing it, so a batch
 * run writes rows the batch file never names. Pinning from the batch file alone was
 * MEASURED at 83.0% / 84.8% / 90.9% on batches 03 / 02 / 04 (2026-08-01), and every
 * inspected miss was a standard-corpus row: `blackberry`, `cranberry`, `egg`,
 * `cheese gouda`, `and creamer half`. Calling the warmer's own seed assembly closes
 * that gap at the source instead of guessing at a second list.
 *
 * Read-only. No DB, no network.
 *
 * Exit codes:
 *   0 = wrote >= 1 pin
 *   4 = VOID — zero pins. Playbook §11 class B: an empty pin file is not a result, and
 *       downstream _dump_cache_prompts.ts would refuse it (or, before that guard,
 *       silently un-pin every row). A run that produced nothing must not exit like a
 *       run that produced something.
 *   2 = error / refused
 */
import * as fs from 'fs';
import { canonicalizeCacheKey } from '../../src/lib/mapping/normalization-rules';
import { assembleSeeds } from './warm-cache';

// ---------------------------------------------------------------------------
// Pure, unit-testable core (scripts/eval/__tests__/cache-ops-void-exits.test.ts)
// ---------------------------------------------------------------------------

export const PIN_VOID_EXIT = 4;

export interface PinBuild {
    /** key -> phrase, seed pins layered over merged pins. */
    pins: Map<string, string>;
    /** Added keys with no pin from any source — judged with an EMPTY phrase. */
    unpinned: string[];
    /** Two seeds canonicalizing onto one added key: reported, never silently resolved. */
    collisions: { key: string; kept: string; dropped: string }[];
    /** Seeds whose canonical key is not among the added keys (normalizer rewrote it). */
    seedsOffTarget: number;
    /** Pins taken from --merge because no seed reached that key. */
    fromMerge: number;
}

/**
 * Build the pin set for a batch.
 *
 * `addedKeys` bounds the whole thing: pinning a key the batch did not add would put a
 * phrase on a row this screen is not judging, and the screen pulls rows from added.txt.
 */
export function buildPins(
    addedKeys: string[],
    seeds: string[],
    canon: (s: string) => string,
    merged?: Map<string, string>,
): PinBuild {
    const added = new Set(addedKeys);
    const pins = new Map<string, string>();
    const collisions: PinBuild['collisions'] = [];
    let seedsOffTarget = 0;

    for (const seed of seeds) {
        let k: string;
        try { k = canon(seed); } catch { seedsOffTarget++; continue; }
        if (!added.has(k)) { seedsOffTarget++; continue; }
        const prior = pins.get(k);
        if (prior && prior !== seed) {
            // Do not pick a winner on a guess. Keep the first, report the second: a
            // collision means two shopper phrases share one cached row, which is a
            // finding about the key space, not a detail to smooth over.
            collisions.push({ key: k, kept: prior, dropped: seed });
            continue;
        }
        pins.set(k, seed);
    }

    let fromMerge = 0;
    if (merged) {
        for (const [k, phrase] of merged) {
            if (!added.has(k) || pins.has(k)) continue;
            pins.set(k, phrase);
            fromMerge++;
        }
    }

    const unpinned = addedKeys.filter(k => !pins.has(k));
    return { pins, unpinned, collisions, seedsOffTarget, fromMerge };
}

/** Zero pins is a distinct, loud, nonzero outcome — never a quiet green. */
export function pinOutcome(pinned: number, wanted: number): { code: number; lines: string[] } {
    if (pinned === 0) {
        return {
            code: PIN_VOID_EXIT,
            lines: [
                `VOID: pinned 0 / ${wanted} added key(s) — this run produced NOTHING.`,
                'Attribution is pins-only, so an empty pin file means every row would be judged with an',
                'EMPTY shopper phrase and the seed-dependent rules would abstain (playbook §11 class B:',
                'absence encoded as a pass). Wrong added.txt, wrong seed file, or canonicalizeCacheKey',
                'landing nowhere near the warmed keys — find out which before using the output.',
            ],
        };
    }
    return { code: 0, lines: [] };
}

/** added.txt is `key<TAB>details` (gate.py). Take field 0 and nothing else. */
export function parseAddedKeys(text: string): string[] {
    return text.split('\n')
        .map(l => l.split('\t')[0].trim())
        .filter(Boolean);
}

/** A batch seed file is bare phrases, `#` comments, blank lines. */
export function parseSeedLines(text: string): string[] {
    return text.split('\n')
        .map(l => l.replace(/\r$/, '').trim())
        .filter(l => l && !l.startsWith('#'));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): number {
    const args = process.argv.slice(2);
    const val = (flag: string): string | undefined => {
        const i = args.indexOf(flag);
        return i >= 0 ? args[i + 1] : undefined;
    };
    const addedPath = val('--added');
    const seedsPath = val('--seeds');
    const outPath = val('--out');
    const mergePath = val('--merge');
    const batchOnly = args.includes('--batch-seeds-only');
    if (!addedPath || !seedsPath || !outPath) {
        console.error('usage: _pin_batch_seeds.ts --added <added.txt> --seeds <batch.txt> --out <pins.tsv> '
            + '[--merge <telemetry-pins.tsv>] [--batch-seeds-only]');
        return 2;
    }

    const addedKeys = parseAddedKeys(fs.readFileSync(addedPath, 'utf8'));
    // The warmer's own seed assembly, so the pin source is the list that actually ran.
    // --batch-seeds-only exists to REPRODUCE the 83-91% measurement above, not for
    // production use: it is the narrower list, and its coverage gap is the finding.
    const seeds = batchOnly
        ? parseSeedLines(fs.readFileSync(seedsPath, 'utf8'))
        : assembleSeeds({ seedFile: seedsPath });
    console.log(batchOnly
        ? `seed source: BATCH FILE ONLY — ${seeds.length} phrase(s)`
        : `seed source: assembleSeeds({seedFile}) — ${seeds.length} phrase(s) (standard corpus + batch)`);
    if (!addedKeys.length) {
        console.error(`REFUSING: ${addedPath} lists 0 keys. There is nothing to pin, and a screen over 0 rows `
            + 'is not a clean batch.');
        return 2;
    }

    let merged: Map<string, string> | undefined;
    if (mergePath) {
        // A missing merge file is fine (the telemetry pass may legitimately have found
        // nothing); an unreadable-but-present one is not, and is not guessed at.
        if (fs.existsSync(mergePath)) {
            merged = new Map();
            for (const line of fs.readFileSync(mergePath, 'utf8').split('\n')) {
                if (!line.trim()) continue;
                const tab = line.indexOf('\t');
                if (tab < 0) continue;
                const k = line.slice(0, tab).trim();
                const p = line.slice(tab + 1).trim();
                if (k && p) merged.set(k, p);
            }
            console.log(`merge source: ${merged.size} telemetry pin(s) from ${mergePath}`);
        } else {
            console.log(`merge source: ${mergePath} absent — seed pins only`);
        }
    }

    const b = buildPins(addedKeys, seeds, canonicalizeCacheKey, merged);

    const lines: string[] = [];
    for (const k of addedKeys) {
        const p = b.pins.get(k);
        if (p) lines.push(`${k}\t${p}`);
    }
    fs.writeFileSync(outPath, lines.join('\n') + (lines.length ? '\n' : ''));

    const pct = (100 * b.pins.size) / addedKeys.length;
    console.log(`pinned ${b.pins.size} / ${addedKeys.length} added key(s) (${pct.toFixed(1)}%)`
        + `  [seed ${b.pins.size - b.fromMerge}, telemetry ${b.fromMerge}] -> ${outPath}`);
    if (b.seedsOffTarget) {
        console.log(`NOTE ${b.seedsOffTarget} of ${seeds.length} seed(s) canonicalized to a key this batch did not add `
            + '— expected: the pipeline normalizes names before keying (bell pepper -> capsicum), and warming '
            + 'also HITS existing rows rather than adding them.');
    }
    for (const c of b.collisions) {
        console.log(`COLLISION key "${c.key}": kept "${c.kept}", dropped "${c.dropped}" — two phrases, one cached row.`);
    }
    if (b.unpinned.length) {
        console.log(`WARN ${b.unpinned.length} added key(s) have NO phrase and will be judged with an empty seed: `
            + b.unpinned.slice(0, 8).join(', ') + (b.unpinned.length > 8 ? ', ...' : ''));
    }

    const outcome = pinOutcome(b.pins.size, addedKeys.length);
    for (const l of outcome.lines) console.error(l);
    return outcome.code;
}

if (require.main === module) {
    try {
        process.exit(main());
    } catch (e) {
        console.error(e);
        process.exit(2);
    }
}
