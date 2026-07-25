/**
 * triage-drops.test.ts — the pure parts of the F3 driver.
 *
 * NO NETWORK, NO DATABASE. The probes are injected (`ProbeSet`), so nothing here
 * loads debug-retrieval-probe / filter-trace-probe — which would construct a
 * Prisma client and warm the ONNX embedder at import time — and nothing calls
 * mapIngredientWithFallback, which writes.
 *
 * What is worth testing here, in order of how badly a bug would hurt:
 *   1. the cap and the dedupe REPORT what they dropped (silent truncation reads as
 *      "covered everything" when it did not);
 *   2. drop-stage filtering (a cache_hit is not a drop, and a row with no stage is
 *      invisible rather than clean — see the F1 caveat that 'error' is dead code);
 *   3. input parsing across all three warm shapes, including warm-names' `query`
 *      key: read it wrong and a whole file parses to ZERO rows;
 *   4. verdicts — that probe evidence can OVERRIDE the row-only class, and that
 *      healthy/residual classes never count as confirmed defects.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    COARSE_BY_CLASS_ID,
    DROP_STAGES,
    buildReport,
    coarseClassOf,
    decideVerdict,
    deriveEvidence,
    isDropStage,
    parseInputText,
    probeQueryFor,
    readInputRows,
    recordToInput,
    renderMarkdown,
    resolveOutBase,
    runProbes,
    selectDrops,
    type DossierProbes,
    type ProbeSet,
    type TriageDossier,
} from '../triage-drops';
import { FAILURE_CLASSES, classById, makeFunnelRow, type FunnelRow, type FunnelRowInput } from '../failure-classes';
import type { RetrievalProbe } from '../../debug-retrieval-probe';
import type { FilterTrace } from '../../filter-trace-probe';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** under_gate + a dropped query token -> identity-query-token-dropped (pipeline). */
const TOKEN_DROPPED: FunnelRowInput = {
    rawLine: "michelangelo's chicken parmesan",
    normalizedForm: "michelangelo's chicken parmesan",
    funnelStage: 'under_gate',
    dropReason: 'under_gate:simple_rerank',
    source: 'fatsecret',
    foodId: 'fs_111',
    foodName: 'Chicken Parmesan',
    grams: 159,
    kcalPer100g: 160,
    proteinPer100g: 14,
    carbsPer100g: 9,
    fatPer100g: 8,
    confidence: 0.73,
};

/** save_rejected:cross_source_margin -> gate-cross-source-margin (HEALTHY). */
const HEALTHY_GATE: FunnelRowInput = {
    rawLine: 'pretzels',
    normalizedForm: 'pretzels',
    funnelStage: 'save_rejected',
    dropReason: 'save_rejected:cross_source_margin',
    source: 'fatsecret',
    foodName: 'Pretzels',
    grams: 3,
    kcalPer100g: 380,
    proteinPer100g: 10,
    carbsPer100g: 80,
    fatPer100g: 3,
    confidence: 0.98,
    hadIncumbent: true,
};

/** no_candidates -> ingest-gap-no-candidates (INGEST). */
const INGEST_GAP: FunnelRowInput = {
    rawLine: 'cooked oats',
    normalizedForm: 'cooked oats',
    funnelStage: 'no_candidates',
    dropReason: 'no_candidates:dataset_gap',
    source: 'ai_estimated',
    foodName: 'Cooked Oats',
    grams: 100,
    kcalPer100g: 71,
    proteinPer100g: 2.5,
    carbsPer100g: 12,
    fatPer100g: 1.4,
    confidence: 0.5,
};

/** all_filtered -> all-filtered-over-rejection (RESIDUAL). */
const RESIDUAL_ALL_FILTERED: FunnelRowInput = {
    rawLine: 'qdoba steak bowl',
    normalizedForm: 'steak bowl',
    funnelStage: 'all_filtered',
    dropReason: 'all_filtered:no_candidate_survived_filters',
    source: 'ai_estimated',
    foodName: 'Qdoba Steak Bowl',
    grams: 100,
    kcalPer100g: 250,
    proteinPer100g: 12,
    carbsPer100g: 25,
    fatPer100g: 10,
    confidence: 0.64,
};

/** cache_hit — NOT a drop stage. */
const NOT_A_DROP: FunnelRowInput = {
    rawLine: 'yellow bell pepper',
    normalizedForm: 'yellow bell pepper',
    funnelStage: 'cache_hit',
    source: 'openfoodfacts',
    foodName: 'Yellow Bell Pepper',
    grams: 164,
    kcalPer100g: 27,
    proteinPer100g: 1,
    carbsPer100g: 6,
    fatPer100g: 0.2,
};

function rows(...inputs: FunnelRowInput[]): FunnelRow[] {
    return inputs.map(makeFunnelRow);
}

function retrievalProbe(opts: {
    total: number;
    top?: { id: string; name: string; brand?: string | null; source?: string; score?: number }[];
    fsCount?: number;
}): RetrievalProbe {
    return {
        query: 'q',
        fatsecret: opts.fsCount != null ? { count: opts.fsCount, top: [] } : null,
        gather: {
            total: opts.total,
            bySource: { openfoodfacts: opts.total },
            top: (opts.top ?? []).map(c => ({
                id: c.id,
                source: c.source ?? 'openfoodfacts',
                name: c.name,
                brand: c.brand ?? null,
                score: c.score ?? 1,
            })),
        },
    };
}

function filterTrace(opts: {
    gathered: number;
    survivors: number;
    removedByTokenFilter?: number;
    droppedByCoreToken?: number;
    candidates?: { id: string; name: string; brand?: string | null; kept: boolean; score?: number }[];
}): FilterTrace {
    return {
        query: 'q',
        gathered: opts.gathered,
        mustHaveTokens: ['chicken'],
        keptAfterTokenFilter: opts.survivors + (opts.droppedByCoreToken ?? 0),
        removedByTokenFilter: opts.removedByTokenFilter ?? 0,
        tokenFilterReason: null,
        droppedByCoreToken: opts.droppedByCoreToken ?? 0,
        survivors: opts.survivors,
        candidates: (opts.candidates ?? []).map(c => ({
            id: c.id,
            source: 'openfoodfacts',
            name: c.name,
            brand: c.brand ?? null,
            score: c.score ?? 1,
            fate: c.kept ? 'KEPT' as const : 'DROPPED@filterCandidatesByTokens' as const,
        })),
    };
}

function dossierOf(input: FunnelRowInput, cap = 25): TriageDossier {
    const sel = selectDrops(rows(input), { perClassCap: cap });
    expect(sel.selected).toHaveLength(1);
    return sel.selected[0];
}

// ---------------------------------------------------------------------------
// 1. Input parsing
// ---------------------------------------------------------------------------

describe('input parsing', () => {
    it('parses a warm-cache document ({results:[...]}), pretty-printed', () => {
        const text = JSON.stringify({ base: 'x', results: [{ seed: 'a' }, { seed: 'b' }] }, null, 2);
        expect(parseInputText(text).map(r => r.seed)).toEqual(['a', 'b']);
    });

    it('parses a bare JSON array', () => {
        expect(parseInputText('[{"seed":"a"},{"seed":"b"}]')).toHaveLength(2);
    });

    it('parses JSONL', () => {
        const text = '{"seed":"a"}\n{"seed":"b"}\n\n{"seed":"c"}\n';
        expect(parseInputText(text).map(r => r.seed)).toEqual(['a', 'b', 'c']);
    });

    it('parses a single pretty-printed object that is not a {results} wrapper', () => {
        expect(parseInputText('{\n "seed": "a"\n}')).toEqual([{ seed: 'a' }]);
    });

    it('returns [] for empty input rather than throwing', () => {
        expect(parseInputText('   \n ')).toEqual([]);
    });

    it('names the offending line when JSONL is malformed', () => {
        expect(() => parseInputText('{"seed":"a"}\nnot json\n')).toThrow(/line 2/);
    });

    it("accepts warm-names' `query` key as the raw line (reading only `seed` yields ZERO rows)", () => {
        const input = recordToInput({ query: 'ghost vegan protein', funnelStage: 'under_gate' });
        expect(input?.rawLine).toBe('ghost vegan protein');
    });

    it('accepts `seed`, `rawLine` and `query`, in that precedence', () => {
        expect(recordToInput({ seed: 's', rawLine: 'r', query: 'q' })?.rawLine).toBe('s');
        expect(recordToInput({ rawLine: 'r', query: 'q' })?.rawLine).toBe('r');
        expect(recordToInput({ query: 'q' })?.rawLine).toBe('q');
    });

    it('drops records with no raw line at all instead of inventing one', () => {
        expect(recordToInput({ funnelStage: 'under_gate' })).toBeNull();
    });

    it('lifts the per100g panel and prefers matchConfidence over confidence', () => {
        const input = recordToInput({
            seed: 'x', per100g: { kcal: 100, protein: 5, carbs: 10, fat: 2 },
            matchConfidence: 0.9, confidence: 0.1,
        })!;
        expect(input.kcalPer100g).toBe(100);
        expect(input.proteinPer100g).toBe(5);
        expect(input.confidence).toBe(0.9);
    });

    it('reads a file end-to-end and canonicalizes the cache key (never the raw logged form)', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f3-'));
        const file = path.join(dir, 'warm.jsonl');
        // "chicken breast" in the event log is "breast chicken" in the cache — the
        // whole point of finding 2. If readInputRows skipped canonicalization the
        // incumbent join would report every one of these as cold.
        fs.writeFileSync(file, '{"seed":"chicken breast","funnelStage":"under_gate"}\n'
            + '{"seed":"eggs","funnelStage":"under_gate"}\n');
        const parsed = readInputRows(file);
        expect(parsed.map(r => r.cacheKey)).toEqual(['breast chicken', 'egg']);
        fs.rmSync(dir, { recursive: true, force: true });
    });
});

// ---------------------------------------------------------------------------
// 2. Drop-stage filtering
// ---------------------------------------------------------------------------

describe('drop-stage filtering', () => {
    it('claims exactly the five drop stages', () => {
        expect([...DROP_STAGES].sort()).toEqual(
            ['all_filtered', 'no_candidates', 'no_match', 'save_rejected', 'under_gate']);
    });

    it('does not treat served stages as drops', () => {
        for (const stage of ['cache_hit', 'saved', 'fast_path', 'error']) {
            expect(isDropStage(stage)).toBe(false);
        }
        expect(isDropStage(null)).toBe(false);
        expect(isDropStage(undefined)).toBe(false);
    });

    it('keeps drop rows and skips the rest, counting both', () => {
        const sel = selectDrops(rows(TOKEN_DROPPED, NOT_A_DROP, HEALTHY_GATE), { perClassCap: 25 });
        expect(sel.rowCount).toBe(3);
        expect(sel.dropRowCount).toBe(2);
        expect(sel.selected.map(d => d.seed).sort()).toEqual(['michelangelo\'s chicken parmesan', 'pretzels']);
        expect(sel.stageCounts).toEqual({ under_gate: 1, cache_hit: 1, save_rejected: 1 });
        expect(sel.dropStageCounts).toEqual({ under_gate: 1, save_rejected: 1 });
    });

    it('logs what the stage filter skipped, with the per-stage breakdown', () => {
        const sel = selectDrops(rows(TOKEN_DROPPED, NOT_A_DROP), { perClassCap: 25 });
        const line = sel.log.find(l => l.startsWith('stage filter'))!;
        expect(line).toContain('kept 1');
        expect(line).toContain('skipped 1');
        expect(line).toContain('cache_hit 1');
    });

    it('calls out stage-less rows explicitly — they are invisible, not clean', () => {
        const sel = selectDrops(rows(TOKEN_DROPPED, { rawLine: 'mystery line' }), { perClassCap: 25 });
        expect(sel.log.some(l => l.includes('NO funnelStage'))).toBe(true);
        expect(sel.selected).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// 3. Dedupe + per-class cap (truncation reporting)
// ---------------------------------------------------------------------------

describe('dedupe and per-class cap', () => {
    it('collapses rows that share a canonical cache key and keeps the count', () => {
        const sel = selectDrops(rows(
            { ...TOKEN_DROPPED, rawLine: 'eggs', normalizedForm: 'eggs' },
            { ...TOKEN_DROPPED, rawLine: 'egg', normalizedForm: 'egg' },
            { ...TOKEN_DROPPED, rawLine: 'EGGS', normalizedForm: 'EGGS' },
        ), { perClassCap: 25 });
        expect(sel.selected).toHaveLength(1);
        expect(sel.selected[0].occurrences).toBe(3);
        expect(sel.selected[0].variants).toEqual(['eggs', 'egg', 'EGGS']);
        expect(sel.duplicateEventsCollapsed).toBe(2);
        expect(sel.log.some(l => l.startsWith('dedupe:') && l.includes('2 duplicate events'))).toBe(true);
    });

    it('does not log a dedupe line when nothing was collapsed', () => {
        const sel = selectDrops(rows(TOKEN_DROPPED, HEALTHY_GATE), { perClassCap: 25 });
        expect(sel.duplicateEventsCollapsed).toBe(0);
        expect(sel.log.some(l => l.startsWith('dedupe:'))).toBe(false);
    });

    it('caps per class and REPORTS every dossier the cap dropped', () => {
        const many = Array.from({ length: 7 }, (_, i) => ({
            ...TOKEN_DROPPED,
            rawLine: `michelangelos chicken parmesan ${i}`,
            normalizedForm: `michelangelos chicken parmesan ${i}`,
        }));
        const sel = selectDrops(rows(...many), { perClassCap: 3 });
        expect(sel.selected).toHaveLength(3);
        expect(sel.droppedByCap).toBe(4);
        expect(sel.truncation).toEqual([
            { classId: 'identity-query-token-dropped', seen: 7, kept: 3, dropped: 4 },
        ]);
        const line = sel.log.find(l => l.includes('PER-CLASS CAP'))!;
        expect(line).toContain('DROPPED 4');
        expect(line).toContain('identity-query-token-dropped kept 3/7');
        expect(line).toContain('does NOT cover');
    });

    it('caps each class independently', () => {
        const inputs = [
            ...Array.from({ length: 4 }, (_, i) => ({ ...TOKEN_DROPPED, rawLine: `parmesan chicken alpha${i}`, normalizedForm: `parmesan chicken alpha${i}` })),
            ...Array.from({ length: 4 }, (_, i) => ({ ...INGEST_GAP, rawLine: `cooked beta${i}`, normalizedForm: `cooked beta${i}` })),
        ];
        const sel = selectDrops(rows(...inputs), { perClassCap: 2 });
        expect(sel.selected).toHaveLength(4);
        expect(sel.truncation.map(t => t.classId).sort())
            .toEqual(['identity-query-token-dropped', 'ingest-gap-no-candidates']);
        expect(sel.droppedByCap).toBe(4);
    });

    it('treats a cap of 0 as unlimited and says so', () => {
        const many = Array.from({ length: 5 }, (_, i) => ({
            ...TOKEN_DROPPED, rawLine: `chicken parmesan gamma${i}`, normalizedForm: `chicken parmesan gamma${i}`,
        }));
        const sel = selectDrops(rows(...many), { perClassCap: 0 });
        expect(sel.selected).toHaveLength(5);
        expect(sel.droppedByCap).toBe(0);
        expect(sel.log.some(l => l.includes('nothing dropped'))).toBe(true);
    });

    it('states positively that nothing was dropped when the cap was not reached', () => {
        const sel = selectDrops(rows(TOKEN_DROPPED), { perClassCap: 25 });
        expect(sel.log.some(l => l.includes('nothing dropped'))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 4. Probe orchestration + dossier merging
// ---------------------------------------------------------------------------

describe('probe orchestration', () => {
    function probeSet(calls: { retrieval: string[]; filter: string[] }): ProbeSet {
        return {
            retrieval: async q => {
                calls.retrieval.push(q);
                return retrievalProbe({ total: 2, top: [{ id: 'off_1', name: 'Chicken Parmesan Michelangelos' }] });
            },
            filterTrace: async q => {
                calls.filter.push(q);
                return filterTrace({ gathered: 2, survivors: 1, candidates: [{ id: 'off_1', name: 'Chicken Parmesan Michelangelos', kept: true }] });
            },
        };
    }

    it('probes every dossier exactly once, even at concurrency > 1', async () => {
        const inputs = Array.from({ length: 10 }, (_, i) => ({
            ...TOKEN_DROPPED, rawLine: `chicken parmesan delta${i}`, normalizedForm: `chicken parmesan delta${i}`,
        }));
        const sel = selectDrops(rows(...inputs), { perClassCap: 25 });
        const calls = { retrieval: [] as string[], filter: [] as string[] };
        const seen: number[] = [];
        await runProbes(sel.selected, probeSet(calls), { concurrency: 4, onProgress: d => seen.push(d) });
        expect(calls.retrieval).toHaveLength(10);
        expect(new Set(calls.retrieval).size).toBe(10);
        expect(calls.filter).toHaveLength(10);
        expect(seen).toHaveLength(10);
        expect(sel.selected.every(d => d.probes !== null && d.evidence.probed)).toBe(true);
    });

    it('probes the mapper\'s query (normalizedForm), not the raw quantity line', async () => {
        const sel = selectDrops(rows({
            ...TOKEN_DROPPED, rawLine: '2 cups michelangelos chicken parmesan', normalizedForm: 'michelangelos chicken parmesan',
        }), { perClassCap: 25 });
        const calls = { retrieval: [] as string[], filter: [] as string[] };
        await runProbes(sel.selected, probeSet(calls), { concurrency: 1 });
        expect(calls.retrieval).toEqual(['michelangelos chicken parmesan']);
    });

    it('falls back to the raw line when no normalizedForm was logged', () => {
        expect(probeQueryFor({ rawLine: 'raw line', normalizedForm: null } as FunnelRow)).toBe('raw line');
        expect(probeQueryFor({ rawLine: 'raw line', normalizedForm: '  ' } as FunnelRow)).toBe('raw line');
        expect(probeQueryFor({ rawLine: 'raw line', normalizedForm: 'norm' } as FunnelRow)).toBe('norm');
    });

    it('records a thrown probe as an error instead of losing the dossier', async () => {
        const sel = selectDrops(rows(TOKEN_DROPPED), { perClassCap: 25 });
        await runProbes(sel.selected, {
            retrieval: async () => { throw new Error('typesense down'); },
            filterTrace: async () => filterTrace({ gathered: 0, survivors: 0 }),
        }, { concurrency: 2 });
        expect(sel.selected[0].evidence.probeErrors).toEqual(['retrieval: typesense down']);
        expect(sel.selected[0].evidence.probed).toBe(true);
    });

    it('merges both probes into ONE dossier record', async () => {
        const sel = selectDrops(rows(TOKEN_DROPPED), { perClassCap: 25 });
        const calls = { retrieval: [] as string[], filter: [] as string[] };
        await runProbes(sel.selected, probeSet(calls), { concurrency: 1 });
        const d = sel.selected[0];
        expect(d.probes?.retrieval).not.toBeNull();
        expect(d.probes?.filterTrace).not.toBeNull();
        expect(d.evidence.candidateCount).toBe(2);
        expect(d.evidence.survivors).toBe(1);
        expect(d.evidence.mustHaveTokens).toEqual(['chicken']);
        // and the row facts survived the merge
        expect(d.classId).toBe('identity-query-token-dropped');
        expect(d.served.foodName).toBe('Chicken Parmesan');
        expect(d.quality.uncoveredQueryTokens.length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// 5. Evidence derivation
// ---------------------------------------------------------------------------

describe('deriveEvidence', () => {
    const base = { seed: "michelangelo's chicken parmesan", quality: makeFunnelRow(TOKEN_DROPPED).quality, served: dossierOf(TOKEN_DROPPED).served };

    it('marks nothing probed and proposes nothing when probes are disabled', () => {
        const ev = deriveEvidence(base, null, 'q');
        expect(ev.probed).toBe(false);
        expect(ev.betterCandidate).toBeNull();
        expect(ev.candidateCount).toBeNull();
        expect(ev.notes.join(' ')).toContain('--no-probes');
    });

    it('flags a corpus gap only when every lane came back empty', () => {
        const empty: DossierProbes = { retrieval: retrievalProbe({ total: 0, fsCount: 0 }), filterTrace: filterTrace({ gathered: 0, survivors: 0 }) };
        expect(deriveEvidence(base, empty, 'q').corpusGap).toBe(true);

        const fsOnly: DossierProbes = { retrieval: retrievalProbe({ total: 0, fsCount: 3 }), filterTrace: null };
        expect(deriveEvidence(base, fsOnly, 'q').corpusGap).toBe(false);
    });

    it('flags a filter wipeout when candidates existed and none survived', () => {
        const probes: DossierProbes = {
            retrieval: retrievalProbe({ total: 6 }),
            filterTrace: filterTrace({ gathered: 6, survivors: 0, removedByTokenFilter: 5, droppedByCoreToken: 1 }),
        };
        const ev = deriveEvidence(base, probes, 'q');
        expect(ev.filterWipeout).toBe(true);
        expect(ev.corpusGap).toBe(false);
        expect(ev.removedByTokenFilter).toBe(5);
        expect(ev.droppedByCoreToken).toBe(1);
    });

    it('proposes a better candidate only when it covers the DROPPED tokens', () => {
        const probes: DossierProbes = {
            retrieval: retrievalProbe({ total: 2 }),
            filterTrace: filterTrace({
                gathered: 2, survivors: 2, candidates: [
                    { id: 'off_generic', name: 'Chicken Parmesan', kept: true, score: 9 },
                    { id: 'off_right', name: "Michelangelo's Chicken Parmesan", kept: true, score: 1 },
                ],
            }),
        };
        const ev = deriveEvidence(base, probes, 'q');
        // off_generic scores higher but still drops "michelangelo"; only off_right covers it.
        expect(ev.betterCandidate?.id).toBe('off_right');
        expect(ev.betterCandidate?.coversUncovered).toEqual(base.quality.uncoveredQueryTokens);
    });

    it('prefers a candidate the pipeline filters KEPT over a higher-scoring one they dropped', () => {
        const probes: DossierProbes = {
            retrieval: retrievalProbe({ total: 2 }),
            filterTrace: filterTrace({
                gathered: 2, survivors: 1, candidates: [
                    { id: 'off_dropped', name: "Michelangelo's Chicken Parmesan Family Size", kept: false, score: 9 },
                    { id: 'off_kept', name: "Michelangelo's Chicken Parmesan", kept: true, score: 2 },
                ],
            }),
        };
        expect(deriveEvidence(base, probes, 'q').betterCandidate?.id).toBe('off_kept');
    });

    it('never proposes the record that was already served', () => {
        const probes: DossierProbes = {
            retrieval: retrievalProbe({ total: 1, top: [{ id: 'fs_111', name: "Michelangelo's Chicken Parmesan" }] }),
            filterTrace: null,
        };
        // fs_111 IS dossier.served.foodId.
        const ev = deriveEvidence(base, probes, 'q');
        expect(ev.betterCandidate).toBeNull();
        expect(ev.notes.join(' ')).toContain('no candidate in the probed pool covers');
    });

    it('says so, rather than staying silent, when nothing covers the dropped tokens', () => {
        const probes: DossierProbes = {
            retrieval: retrievalProbe({ total: 3, top: [{ id: 'off_x', name: 'Chicken Parmesan' }] }),
            filterTrace: null,
        };
        const ev = deriveEvidence(base, probes, 'q');
        expect(ev.betterCandidate).toBeNull();
        expect(ev.notes.some(n => n.includes('michelangelo'))).toBe(true);
    });

    it('falls back to the filter trace for the candidate count when gather errored', () => {
        const probes: DossierProbes = {
            retrieval: { query: 'q', fatsecret: null, gather: { error: 'boom' } },
            filterTrace: filterTrace({ gathered: 4, survivors: 2 }),
        };
        const ev = deriveEvidence(base, probes, 'q');
        expect(ev.candidateCount).toBe(4);
        expect(ev.probeErrors).toEqual(['gather: boom']);
    });
});

// ---------------------------------------------------------------------------
// 6. Verdicts
// ---------------------------------------------------------------------------

describe('decideVerdict', () => {
    function verdictFor(input: FunnelRowInput, probes: DossierProbes | null) {
        const d = dossierOf(input);
        const ev = deriveEvidence(d, probes, 'q');
        return decideVerdict({ dossier: d, cls: classById(d.classId) ?? null, evidence: ev });
    }

    it('never confirms a healthy class, and records the incumbent split in the note', () => {
        const v = verdictFor(HEALTHY_GATE, null);
        expect(v.confirmed).toBe(false);
        expect(v.cls).toBe('healthy');
        expect(v.action).toBe('none');
        expect(v.note).toContain('incumbent=true');
    });

    it('never confirms a residual bucket — a catch-all is not a diagnosis', () => {
        const v = verdictFor(RESIDUAL_ALL_FILTERED, null);
        expect(v.confirmed).toBe(false);
        expect(v.action).toBe('triage');
        expect(v.note).toContain('residual bucket');
    });

    it('routes an ingest class to the ingest queue with no target', () => {
        const v = verdictFor(INGEST_GAP, null);
        expect(v).toMatchObject({ confirmed: true, cls: 'ingest-gap', action: 'ingest', targetId: null });
    });

    it('routes a pipeline class to a code fix when no target was found', () => {
        const v = verdictFor(TOKEN_DROPPED, null);
        expect(v).toMatchObject({ confirmed: true, cls: 'identity', action: 'pipeline-fix', targetId: null });
        expect(v.note).toContain('--no-probes');
    });

    it('upgrades to a repoint with the candidate id when the probe found a covering record', () => {
        const probes: DossierProbes = {
            retrieval: retrievalProbe({ total: 2 }),
            filterTrace: filterTrace({
                gathered: 2, survivors: 1,
                candidates: [{ id: 'off_right', name: "Michelangelo's Chicken Parmesan", kept: true }],
            }),
        };
        const v = verdictFor(TOKEN_DROPPED, probes);
        expect(v.action).toBe('repoint');
        expect(v.targetId).toBe('off_right');
        expect(v.extraActions).toContain('pipeline-fix');
        expect(v.note).toContain("today's cache row");
    });

    it('RECLASSIFIES a pipeline class as an ingest gap when retrieval returned nothing', () => {
        const empty: DossierProbes = {
            retrieval: retrievalProbe({ total: 0, fsCount: 0 }),
            filterTrace: filterTrace({ gathered: 0, survivors: 0 }),
        };
        const v = verdictFor(TOKEN_DROPPED, empty);
        expect(v).toMatchObject({ confirmed: true, cls: 'ingest-gap', action: 'ingest', reclassifiedByProbe: true });
        expect(v.note).toContain('NEVER a fix-agent');
    });

    it('calls a filter wipeout a filter defect, not a bad row', () => {
        const probes: DossierProbes = {
            retrieval: retrievalProbe({ total: 8 }),
            filterTrace: filterTrace({ gathered: 8, survivors: 0, removedByTokenFilter: 7, droppedByCoreToken: 1 }),
        };
        const v = verdictFor(TOKEN_DROPPED, probes);
        expect(v).toMatchObject({ confirmed: true, cls: 'ranking-gap', action: 'pipeline-fix' });
        expect(v.note).toContain('NONE survived the filters');
    });

    it('warns when the probe CONTRADICTS an ingest class (the lane was not empty)', () => {
        const probes: DossierProbes = {
            retrieval: retrievalProbe({ total: 16 }),
            filterTrace: filterTrace({ gathered: 16, survivors: 5 }),
        };
        const v = verdictFor(INGEST_GAP, probes);
        expect(v.action).toBe('ingest');
        expect(v.note).toContain('CAUTION');
        expect(v.note).toContain('specific form/variant');
    });

    it('sends an unclassified row to the frontier, never to an action', () => {
        const d = dossierOf(TOKEN_DROPPED);
        const v = decideVerdict({ dossier: { ...d, classId: 'unclassified' }, cls: null, evidence: deriveEvidence(d, null, 'q') });
        expect(v).toMatchObject({ confirmed: false, cls: 'frontier', action: 'triage' });
        expect(v.note).toContain('true');
    });
});

// ---------------------------------------------------------------------------
// 7. Report shaping
// ---------------------------------------------------------------------------

describe('buildReport', () => {
    function report(inputs: FunnelRowInput[], perClassCap = 25) {
        const sel = selectDrops(rows(...inputs), { perClassCap });
        for (const d of sel.selected) d.evidence = deriveEvidence(d, null, 'q');
        return buildReport(sel, { inputLabel: 'fixture', mode: 'no-probes', concurrency: 1, perClassCap });
    }

    it('keeps the 2026-07-21 keys so existing readers still work', () => {
        const r = report([TOKEN_DROPPED, HEALTHY_GATE, INGEST_GAP]);
        for (const key of ['screened', 'suspectCount', 'confirmedCount', 'byClass', 'confirmed', 'dismissed']) {
            expect(Object.keys(r)).toContain(key);
        }
        expect(typeof r.screened).toBe('string');
        expect(Array.isArray(r.confirmed)).toBe(true);
        expect(Array.isArray(r.dismissed)).toBe(true);
    });

    it('emits every legacy field on every confirmed row', () => {
        const r = report([TOKEN_DROPPED]);
        const row = r.confirmed[0];
        expect(Object.keys(row)).toEqual(
            expect.arrayContaining(['seed', 'confirmed', 'cls', 'action', 'targetId', 'note']));
        expect(row.seed).toBe("michelangelo's chicken parmesan");
        expect(row.confirmed).toBe(true);
        // extensions, additive
        expect(row.classId).toBe('identity-query-token-dropped');
        expect(row.fixKind).toBe('pipeline');
        expect(row.dossier.cacheKey).toBeTruthy();
    });

    it('counts a healthy drop as neither a suspect nor a confirmation', () => {
        const r = report([TOKEN_DROPPED, HEALTHY_GATE]);
        expect(r.suspectCount).toBe(1);
        expect(r.confirmedCount).toBe(1);
        expect(r.dismissed.map(d => d.seed)).toEqual(['pretzels']);
        expect(r.byClass.healthy).toBeUndefined();
    });

    it('keys byClass on the COARSE vocabulary and counts confirmed rows only', () => {
        const r = report([TOKEN_DROPPED, INGEST_GAP, RESIDUAL_ALL_FILTERED]);
        expect(r.byClass).toEqual({ identity: 1, 'ingest-gap': 1 });
        expect(r.byFailureClass['all-filtered-over-rejection']).toBe(1);
    });

    it('reports the F2 class and fixKind histograms alongside the coarse one', () => {
        const r = report([TOKEN_DROPPED, INGEST_GAP]);
        expect(r.byFailureClass).toEqual({
            'identity-query-token-dropped': 1,
            'ingest-gap-no-candidates': 1,
        });
        expect(r.byFixKind).toEqual({ pipeline: 1, ingest: 1 });
        expect(r.byAction).toEqual({ 'pipeline-fix': 1, ingest: 1 });
    });

    it('states the truncation in the log and carries it structurally', () => {
        const many = Array.from({ length: 5 }, (_, i) => ({
            ...TOKEN_DROPPED, rawLine: `chicken parmesan eps${i}`, normalizedForm: `chicken parmesan eps${i}`,
        }));
        const r = report(many, 2);
        expect(r.droppedByCap).toBe(3);
        expect(r.truncation[0]).toMatchObject({ classId: 'identity-query-token-dropped', dropped: 3 });
        expect(r.log.some(l => l.includes('PER-CLASS CAP'))).toBe(true);
    });

    it('summarises the screen in `screened`, including how many were actually triaged', () => {
        const r = report([TOKEN_DROPPED, NOT_A_DROP, INGEST_GAP]);
        expect(r.screened).toContain('3 rows');
        expect(r.screened).toContain('2 drop-stage');
        expect(r.screened).toContain('fixture');
    });

    it('orders confirmed rows by how often the key was seen', () => {
        const r = report([
            { ...TOKEN_DROPPED, rawLine: 'chicken parmesan zeta', normalizedForm: 'chicken parmesan zeta' },
            INGEST_GAP,
            { ...INGEST_GAP, rawLine: 'cooked oats', normalizedForm: 'cooked oats' },
        ]);
        expect(r.confirmed[0].seed).toBe('cooked oats');
        expect(r.confirmed[0].dossier.occurrences).toBe(2);
    });

    it('carries the funnel caveats so a reader cannot draw a conclusion without them', () => {
        const r = report([TOKEN_DROPPED]);
        expect(r.caveats.some(c => c.startsWith('error-stage-is-dead-code'))).toBe(true);
        expect(r.caveats.some(c => c.includes('fdc'))).toBe(true);
    });

    it('counts probe errors so partial evidence is never read as "nothing found"', async () => {
        const sel = selectDrops(rows(TOKEN_DROPPED), { perClassCap: 25 });
        await runProbes(sel.selected, {
            retrieval: async () => { throw new Error('down'); },
        }, { concurrency: 1 });
        const r = buildReport(sel, { inputLabel: 'fixture', mode: 'probes', concurrency: 1, perClassCap: 25 });
        expect(r.probeErrorCount).toBe(1);
        expect(r.log.some(l => l.includes('probe errors'))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 8. Markdown
// ---------------------------------------------------------------------------

describe('renderMarkdown', () => {
    function md(inputs: FunnelRowInput[], perClassCap = 25) {
        const sel = selectDrops(rows(...inputs), { perClassCap });
        for (const d of sel.selected) d.evidence = deriveEvidence(d, null, 'q');
        return renderMarkdown(buildReport(sel, { inputLabel: 'fixture', mode: 'no-probes', concurrency: 1, perClassCap }));
    }

    it('renders a truncation section when the cap dropped anything', () => {
        const many = Array.from({ length: 4 }, (_, i) => ({
            ...TOKEN_DROPPED, rawLine: `chicken parmesan eta${i}`, normalizedForm: `chicken parmesan eta${i}`,
        }));
        const text = md(many, 1);
        expect(text).toContain('Truncated classes — NOT covered by this run');
        expect(text).toContain('dropped by cap: **3**');
    });

    it('omits the truncation section when nothing was dropped', () => {
        expect(md([TOKEN_DROPPED])).not.toContain('Truncated classes');
    });

    it('groups confirmed verdicts by action and lists dismissed separately', () => {
        const text = md([TOKEN_DROPPED, INGEST_GAP, HEALTHY_GATE]);
        expect(text).toContain('action: `pipeline-fix`');
        expect(text).toContain('action: `ingest`');
        expect(text).toContain('## Dismissed');
        expect(text).toContain('pretzels');
    });

    it('escapes table-breaking pipes in seeds and notes', () => {
        const text = md([{ ...TOKEN_DROPPED, rawLine: 'chicken | parmesan pipe', normalizedForm: 'chicken | parmesan pipe' }]);
        expect(text).toContain('chicken \\| parmesan pipe');
    });

    it('says out loud that no-probes mode cannot propose targets', () => {
        expect(md([TOKEN_DROPPED])).toContain('no retrieval calls, so no repoint targets');
    });
});

// ---------------------------------------------------------------------------
// 9. Registry wiring
// ---------------------------------------------------------------------------

describe('coarse-class routing', () => {
    it('routes EVERY F2 class explicitly (a new class must be routed, not defaulted)', () => {
        const unrouted = FAILURE_CLASSES.map(c => c.id).filter(id => !(id in COARSE_BY_CLASS_ID));
        expect(unrouted).toEqual([]);
    });

    it('does not carry stale ids for classes that no longer exist', () => {
        const known = new Set(FAILURE_CLASSES.map(c => c.id));
        expect(Object.keys(COARSE_BY_CLASS_ID).filter(id => !known.has(id))).toEqual([]);
    });

    it("routes every 'healthy' fixKind class to the healthy coarse bucket", () => {
        for (const c of FAILURE_CLASSES.filter(c => c.fixKind === 'healthy')) {
            expect(coarseClassOf(c.id)).toBe('healthy');
        }
    });

    it('routes every residual bucket somewhere that cannot be confirmed', () => {
        for (const c of FAILURE_CLASSES.filter(c => c.residual)) {
            const v = decideVerdict({
                dossier: { ...dossierOf(TOKEN_DROPPED), classId: c.id },
                cls: c,
                evidence: deriveEvidence(dossierOf(TOKEN_DROPPED), null, 'q'),
            });
            expect(v.confirmed).toBe(false);
        }
    });

    it('falls back to the frontier for an id it has never seen', () => {
        expect(coarseClassOf('a-class-invented-tomorrow')).toBe('frontier');
    });
});

// ---------------------------------------------------------------------------
// 10. Output paths
// ---------------------------------------------------------------------------

describe('resolveOutBase', () => {
    it('defaults to scripts/eval/results/triage-verdicts-<ts>', () => {
        const base = resolveOutBase(undefined, new Date('2026-07-25T12:34:56.789Z'));
        expect(base.endsWith(path.join('results', 'triage-verdicts-2026-07-25T12-34-56-789Z'))).toBe(true);
    });

    it('strips a .json or .md suffix so both siblings share one base', () => {
        expect(resolveOutBase('/tmp/out.json', new Date())).toBe('/tmp/out');
        expect(resolveOutBase('/tmp/out.md', new Date())).toBe('/tmp/out');
        expect(resolveOutBase('/tmp/out', new Date())).toBe('/tmp/out');
    });
});
