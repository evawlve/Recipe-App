/**
 * prod-shape-coverage.test.ts — the fixture must contain every shape production does.
 *
 * THE CLASS OF BUG THIS CLOSES
 * `ROW_SQL` joined `OffFood` and `FatSecretFood` but not `FdcFood`, so every
 * fdc-sourced FoodMapping row arrived with `recname=''` and `per100g=null`. D8 ("no
 * usable per-100g basis") fired on all of them and the screen false-evicted 78 of
 * 78 fdc rows in the live cache. Seventy-three tests were green throughout —
 * including a confusion matrix pinned row-by-row — because BATCH 01 CONTAINS NO FDC
 * ROWS. The suite was not wrong about what it measured; the corpus simply did not
 * have the shape, so a whole source was invisible.
 *
 * A fixture cannot be trusted to notice what it does not contain. fixtures/
 * prod-shapes.json is the EXTERNAL record of what the live cache actually holds,
 * and this file fails when the committed rows stop covering it.
 *
 * OFFLINE BY CONSTRUCTION. CI has no prod DB, so the manifest is a committed
 * snapshot rather than a live query. It goes stale the moment production grows a
 * shape — which is the point of naming the refresh script in every failure message.
 */

import * as fs from 'fs';
import * as path from 'path';
import { realServing, tierD, type ScreenRow } from '../correctness-screen';
import { isReplayNondeterministicTier } from '../../../src/lib/mapping/serving-ai-tiers';

const FIXTURES = path.join(__dirname, 'fixtures');

interface ShapeCount { value: string; count: number }
interface Manifest {
    measuredAt: string;
    refreshWith: string;
    population: { table: string; rows: number };
    shapes: { source: ShapeCount[]; servingTier: ShapeCount[] };
}

const MANIFEST = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'prod-shapes.json'), 'utf8')) as Manifest;

/**
 * The whole committed test corpus, not one file.
 *
 * Batch 01 is a FROZEN hand audit — 81 rows, 23 BAD / 10 SUSPECT / 48 GOOD, with a
 * confusion matrix pinned to exact counts. Rows cannot be added to it without
 * misrepresenting what a human actually labelled, so the shapes it lacks live in
 * screen-shape-exemplars.json and coverage is measured over the UNION.
 */
const BATCH01: ScreenRow[] = (JSON.parse(
    fs.readFileSync(path.join(FIXTURES, 'correctness-screen-batch01.json'), 'utf8'),
) as { rows: Array<{ row: ScreenRow }> }).rows.map(r => r.row);

const EXEMPLARS: ScreenRow[] = (JSON.parse(
    fs.readFileSync(path.join(FIXTURES, 'screen-shape-exemplars.json'), 'utf8'),
) as { rows: Array<{ row: ScreenRow }> }).rows.map(r => r.row);

const CORPUS: ScreenRow[] = [...BATCH01, ...EXEMPLARS];

const HOW_TO_FIX = (dimension: string, missing: string[]) =>
    `The committed fixtures cover no row with ${dimension} in [${missing.join(', ')}], `
    + 'but the live cache does. A rule branch that never runs against a shape cannot be '
    + 'wrong in a way any test can see — that is exactly how ROW_SQL lost its FdcFood '
    + 'join for 78 of 78 fdc rows.\n'
    + '  TO FIX: add a real exemplar row (pulled via ROW_SQL, with row.real filled by the '
    + 'real serving pass) to scripts/eval/__tests__/fixtures/screen-shape-exemplars.json. '
    + 'Do NOT add it to correctness-screen-batch01.json — that fixture is a frozen human audit.\n'
    + `  IF THE MANIFEST IS STALE instead, refresh it from prod with:\n    ${MANIFEST.refreshWith}`;

describe('the manifest itself', () => {
    it('describes a real, non-empty population', () => {
        // A manifest of nothing would make every coverage assertion below pass
        // vacuously — the same "absence read as agreement" shape the whole PR is about.
        expect(MANIFEST.population.rows).toBeGreaterThan(0);
        expect(MANIFEST.shapes.source.length).toBeGreaterThan(0);
        expect(MANIFEST.shapes.servingTier.length).toBeGreaterThan(0);
        expect(MANIFEST.refreshWith).toContain('refresh-prod-shapes.ts');
    });

    it('reads the DB nowhere — CI has no prod database', () => {
        const spy = jest.spyOn(globalThis, 'fetch');
        expect(CORPUS.length).toBeGreaterThan(80);
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});

describe('fixture coverage of production shapes', () => {
    it('covers every FoodMapping.source the cache contains', () => {
        const have = new Set(CORPUS.map(r => r.src));
        const missing = MANIFEST.shapes.source.filter(s => s.count > 0 && !have.has(s.value)).map(s => s.value);
        if (missing.length) throw new Error(HOW_TO_FIX('src', missing));
        expect(missing).toEqual([]);
    });

    it('covers every serving tier the real anchor produces', () => {
        const have = new Set(CORPUS.map(r => r.real?.tier).filter((t): t is string => !!t));
        const missing = MANIFEST.shapes.servingTier.filter(s => s.count > 0 && !have.has(s.value)).map(s => s.value);
        if (missing.length) throw new Error(HOW_TO_FIX('row.real.tier', missing));
        expect(missing).toEqual([]);
    });

    it('DEMONSTRATES it can fail — a shape absent from the corpus is reported', () => {
        // A coverage test that cannot fail is decoration. This runs the same check
        // against a manifest entry that deliberately does not exist.
        const have = new Set(CORPUS.map(r => r.src));
        const missing = [...MANIFEST.shapes.source, { value: 'usda_branded_v2', count: 12 }]
            .filter(s => s.count > 0 && !have.has(s.value)).map(s => s.value);
        expect(missing).toEqual(['usda_branded_v2']);
        expect(HOW_TO_FIX('src', missing)).toContain('refresh-prod-shapes.ts');
    });
});

describe('the shapes batch 01 was missing are actually SCREENED, not merely present', () => {
    const fdcRows = CORPUS.filter(r => r.src === 'fdc');

    it('the corpus carries real fdc rows with a joined FdcFood record', () => {
        expect(fdcRows.length).toBeGreaterThan(0);
        for (const r of fdcRows) {
            // These two fields are precisely what the missing join blanked out.
            expect(r.recname).not.toBe('');
            expect(r.per100g).toBeTruthy();
        }
    });

    it('an fdc row with a real panel does NOT trip D8 — the rule that false-evicted 78/78', () => {
        for (const r of fdcRows) {
            expect(tierD(r, 'balanced').map(h => h.rule)).not.toContain('D8');
        }
    });

    it('every fdc row resolves on an AI-ESTIMATED tier, so D5/D6 may never gate on it', () => {
        // Measured over the whole cache: all 78 fdc rows come back on
        // `fdc_size_estimate`, an explicit member of
        // REPLAY_NONDETERMINISTIC_SERVING_TIERS. The one source the fixture had no
        // coverage of is also the one whose serving anchor is a fresh model guess —
        // a number that can differ on the next request and therefore cannot ground a
        // decision to throw a cache row away.
        for (const r of fdcRows) {
            expect(isReplayNondeterministicTier(r.real?.tier)).toBe(true);
            expect(realServing(r).judged).toBe(false);
            const serving = tierD(r, 'strict').filter(h => h.rule === 'D5' || h.rule === 'D6');
            expect(serving.map(h => h.severity)).not.toContain('EVICT');
        }
    });

    it('the exemplars do not disturb the pinned batch-01 matrix', () => {
        // They live in a separate file for exactly this reason. If this ever fails,
        // someone has merged the two corpora and the audited recall figures are no
        // longer about the rows a human labelled.
        expect(BATCH01).toHaveLength(81);
        expect(BATCH01.filter(r => r.src === 'fdc')).toHaveLength(0);
        expect(EXEMPLARS.length).toBeGreaterThan(0);
    });
});
