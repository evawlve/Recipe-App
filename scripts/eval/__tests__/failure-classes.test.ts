/**
 * failure-classes.test.ts — every detector tested against its own exemplars.
 *
 * THIS IS A HARD REQUIREMENT, not a nicety. The recorded lesson from the
 * nutrition-corruption detector (PR #119) is that guard regexes silently stopped
 * matching their own documented examples: the file said "jerky at 1285 g = mg-as-g"
 * while the guard that was supposed to catch it had drifted. A taxonomy whose
 * detectors no longer fire on the rows that motivated them is worse than no
 * taxonomy, because the report then reads as "class closed".
 *
 * So: for every class, every exemplar row must classify to THAT class through the
 * full precedence chain (not merely satisfy its own detector), and every counter
 * row must fail its detector. Plus a coverage test that all 19 measured live
 * dropReasons resolve to some class.
 */

import {
    FAILURE_CLASSES,
    FUNNEL_CAVEATS,
    LIVE_DROP_REASONS,
    UNCLASSIFIED,
    classById,
    classStages,
    classifyRow,
    contentTokens,
    deriveFunnelCacheKey,
    dropClassOf,
    effectiveKcalPer100g,
    fromDbBlindSpots,
    hasDropClass,
    isCompositeQuery,
    keyFidelityOf,
    makeFunnelRow,
    probeLineFor,
    uncoveredTokens,
    type FixKind,
    type FunnelRowInput,
} from '../failure-classes';
import { aggregate, attachIncumbents, measureInputFidelity, renderDoc, type PrismaLike } from '../classify-drops';

const FIX_KINDS: FixKind[] = ['pipeline', 'data', 'ingest', 'healthy'];

// ---------------------------------------------------------------------------
// Registry hygiene
// ---------------------------------------------------------------------------

describe('registry hygiene', () => {
    it('has unique class ids', () => {
        const ids = FAILURE_CLASSES.map(c => c.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('declares a valid fixKind and status on every class', () => {
        for (const c of FAILURE_CLASSES) {
            expect(FIX_KINDS).toContain(c.fixKind);
            expect(['open', 'fixing', 'closed', 'by-design']).toContain(c.status);
        }
    });

    it("marks every 'healthy' class as by-design (a healthy drop is not open work)", () => {
        for (const c of FAILURE_CLASSES.filter(c => c.fixKind === 'healthy')) {
            expect(c.status).toBe('by-design');
        }
    });

    it('carries an absolute ISO discovery date, never a relative one', () => {
        for (const c of FAILURE_CLASSES) {
            expect(c.discoveredAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
            expect(Number.isNaN(new Date(c.discoveredAt).getTime())).toBe(false);
        }
    });

    it('keeps residual buckets last within their stage so specific classes win', () => {
        // A residual must never precede a non-residual class that shares its stage.
        FAILURE_CLASSES.forEach((cls, i) => {
            if (!cls.residual) return;
            const later = FAILURE_CLASSES.slice(i + 1)
                .filter(o => !o.residual && classStages(o).some(s => classStages(cls).includes(s)));
            expect(later.map(o => o.id)).toEqual([]);
        });
    });

    it('has a description long enough to route a fix (not a one-liner label)', () => {
        for (const c of FAILURE_CLASSES) {
            expect(c.description.length).toBeGreaterThan(120);
        }
    });

    it('documents the funnel caveats that cannot be detected from a row', () => {
        const ids = FUNNEL_CAVEATS.map(c => c.id);
        expect(ids).toContain('error-stage-is-dead-code');
        expect(ids).toContain('fdc-bypasses-two-save-guards');
        expect(ids).toContain('zero-macros-gate-skipped-at-zero-grams');
        expect(ids).toContain('event-log-key-is-not-the-cache-key');
    });
});

// ---------------------------------------------------------------------------
// META-TEST: every class matches its own exemplars, and rejects a counter row
// ---------------------------------------------------------------------------

describe('every class detector matches its own exemplars', () => {
    it('every class declares at least one exemplar, exemplar row and counter row', () => {
        for (const c of FAILURE_CLASSES) {
            expect(c.exemplars.length).toBeGreaterThanOrEqual(1);
            expect(c.exemplarRows.length).toBeGreaterThanOrEqual(1);
            expect(c.counterRows.length).toBeGreaterThanOrEqual(1);
        }
    });

    it('every exemplar row is anchored to a listed exemplar query', () => {
        for (const c of FAILURE_CLASSES) {
            for (const r of c.exemplarRows) {
                expect(c.exemplars).toContain(r.rawLine);
            }
        }
    });

    it('every exemplar row lands on a stage the class declares', () => {
        for (const c of FAILURE_CLASSES) {
            const stages = classStages(c);
            for (const r of c.exemplarRows) {
                expect(stages).toContain(r.funnelStage);
            }
        }
    });

    // The load-bearing one: full precedence chain, not just the class's own detector.
    for (const cls of FAILURE_CLASSES) {
        describe(cls.id, () => {
            for (const input of cls.exemplarRows) {
                it(`classifies "${input.rawLine}" as ${cls.id}`, () => {
                    const row = makeFunnelRow(input);
                    expect(cls.detector(row)).toBe(true);
                    expect(classifyRow(row).classId).toBe(cls.id);
                });
            }
            for (const input of cls.counterRows) {
                it(`does NOT match "${input.rawLine}"`, () => {
                    expect(cls.detector(makeFunnelRow(input))).toBe(false);
                });
            }
        });
    }
});

// ---------------------------------------------------------------------------
// Finding 1: the raw histogram is misleading
// ---------------------------------------------------------------------------

describe('finding 1 — the biggest dropReason is healthy, not a defect', () => {
    it('routes cross_source_margin to a healthy, by-design class', () => {
        const row = makeFunnelRow({
            rawLine: 'brussels sprouts',
            funnelStage: 'save_rejected',
            dropReason: 'save_rejected:cross_source_margin',
            hadIncumbent: true,
        });
        const { cls } = classifyRow(row);
        expect(cls?.id).toBe('gate-cross-source-margin');
        expect(cls?.fixKind).toBe('healthy');
        expect(cls?.status).toBe('by-design');
    });

    it('keeps healthy classes out of the defect table even when they dominate by count', () => {
        const rows = [
            // 400 events of healthy incumbent protection on 2 keys...
            ...Array.from({ length: 400 }, (_, i) => makeFunnelRow({
                rawLine: i % 2 === 0 ? 'brussels sprouts' : 'pretzels',
                funnelStage: 'save_rejected',
                dropReason: 'save_rejected:cross_source_margin',
                hadIncumbent: true,
            })),
            // ...versus 3 real defects on 3 keys.
            makeFunnelRow({ rawLine: 'cream of wheat', funnelStage: 'save_rejected', dropReason: 'save_rejected:brand_mismatch', foodName: 'Wheat', brandName: 'First Street', hadIncumbent: false }),
            makeFunnelRow({ rawLine: 'grape nuts', funnelStage: 'save_rejected', dropReason: 'save_rejected:implausible_macros:category:fresh_produce_kcal_over', foodName: 'Grape nuts', brandName: 'Post', hadIncumbent: false }),
            makeFunnelRow({ rawLine: 'shrimp scampi', funnelStage: 'save_rejected', dropReason: 'save_rejected:implausible_macros:category:lean_cut_protein_below_floor', foodName: 'Shrimp scampi', hadIncumbent: false }),
        ];
        const report = aggregate(rows, { inputLabel: 'test' });

        expect(report.defects.map(d => d.classId)).not.toContain('gate-cross-source-margin');
        expect(report.healthy.map(d => d.classId)).toContain('gate-cross-source-margin');
        expect(report.healthyEvents).toBe(400);
        expect(report.defectEvents).toBe(3);
        // Ranked by distinct keys, so the 400-event healthy class cannot head the list.
        expect(report.defects[0].distinctKeys).toBe(1);
    });

    it('reports the hadIncumbent split, so a cold hit on an incumbent-only gate is visible', () => {
        const rows = [
            makeFunnelRow({ rawLine: 'pretzels', funnelStage: 'save_rejected', dropReason: 'save_rejected:cross_source_margin', hadIncumbent: true }),
            makeFunnelRow({ rawLine: 'brussels sprouts', funnelStage: 'save_rejected', dropReason: 'save_rejected:cross_source_margin', hadIncumbent: false }),
            makeFunnelRow({ rawLine: 'red bell pepper', funnelStage: 'save_rejected', dropReason: 'save_rejected:cross_source_margin' }),
        ];
        const report = aggregate(rows, { inputLabel: 'test' });
        const cls = report.healthy.find(c => c.classId === 'gate-cross-source-margin')!;
        expect(cls.withIncumbent).toBe(1);
        expect(cls.withoutIncumbent).toBe(1);
        expect(cls.incumbentUnknown).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Finding 2: the cache key is not the logged form
// ---------------------------------------------------------------------------

describe('finding 2 — cacheKey is canonicalized, normalizedForm is not', () => {
    it('canonicalizes the logged form into the key FoodMapping actually stores', () => {
        expect(makeFunnelRow({ rawLine: 'x', normalizedForm: 'chicken breast' }).cacheKey).toBe('breast chicken');
        expect(makeFunnelRow({ rawLine: 'x', normalizedForm: 'eggs' }).cacheKey).toBe('egg');
        expect(makeFunnelRow({ rawLine: 'x', normalizedForm: 'pretzels' }).cacheKey).toBe('pretzel');
    });

    it('keeps the pre-canonical form intact alongside it', () => {
        const row = makeFunnelRow({ rawLine: '6 oz chicken breast', normalizedForm: 'chicken breast' });
        expect(row.normalizedForm).toBe('chicken breast');
        expect(row.cacheKey).toBe('breast chicken');
        expect(row.cacheKey).not.toBe(row.normalizedForm);
    });

    it('falls back to rawLine when the event carried no normalizedForm (fast_path rows)', () => {
        expect(makeFunnelRow({ rawLine: '2 cups water', funnelStage: 'fast_path' }).cacheKey).toBe('2 cup water');
    });

    it('collapses possessive spellings onto one key, as the cache does', () => {
        const a = makeFunnelRow({ rawLine: "mcdonald's fries" }).cacheKey;
        const b = makeFunnelRow({ rawLine: 'mcdonalds fries' }).cacheKey;
        expect(a).toBe(b);
    });

    describe('attachIncumbents', () => {
        /** Fake prisma: records what it was asked for, answers from a canonical-key set. */
        function fakePrisma(cached: string[]): { prisma: PrismaLike; queries: string[][] } {
            const queries: string[][] = [];
            const prisma: PrismaLike = {
                mappingEventLog: { findMany: async () => [] },
                foodMapping: {
                    findMany: async (args: unknown) => {
                        const where = (args as { where: { normalizedForm: { in: string[] } } }).where;
                        queries.push(where.normalizedForm.in);
                        return where.normalizedForm.in
                            .filter(k => cached.includes(k))
                            .map(normalizedForm => ({ normalizedForm }));
                    },
                },
                $disconnect: async () => { },
            };
            return { prisma, queries };
        }

        it('joins on the CANONICAL key, so a cached row is not reported as cold', async () => {
            // FoodMapping stores the token-sorted singular form.
            const { prisma } = fakePrisma(['breast chicken', 'egg', 'pretzel']);
            const rows = [
                makeFunnelRow({ rawLine: '6 oz chicken breast', normalizedForm: 'chicken breast' }),
                makeFunnelRow({ rawLine: '2 eggs', normalizedForm: 'eggs' }),
                makeFunnelRow({ rawLine: 'pretzels', normalizedForm: 'pretzels' }),
                makeFunnelRow({ rawLine: 'sea urchin', normalizedForm: 'sea urchin' }),
            ];
            await attachIncumbents(prisma, rows);
            expect(rows.map(r => r.hadIncumbent)).toEqual([true, true, true, false]);
        });

        it('batches the lookups instead of one query per row', async () => {
            const { prisma, queries } = fakePrisma([]);
            const rows = Array.from({ length: 250 }, (_, i) => makeFunnelRow({ rawLine: `food ${i}` }));
            await attachIncumbents(prisma, rows, 100);
            expect(queries.length).toBe(3);
            expect(queries[0].length).toBe(100);
        });

        it('deduplicates keys so a hot key is looked up once', async () => {
            const { prisma, queries } = fakePrisma(['pretzel']);
            const rows = Array.from({ length: 40 }, () => makeFunnelRow({ rawLine: 'pretzels' }));
            await attachIncumbents(prisma, rows);
            expect(queries).toEqual([['pretzel']]);
            expect(rows.every(r => r.hadIncumbent === true)).toBe(true);
        });
    });
});

// ---------------------------------------------------------------------------
// Finding 2, second half: canonicalizeCacheKey is NOT the FoodMapping key
// ---------------------------------------------------------------------------

describe('finding 2 — the key is the DERIVED key, not canonicalizeCacheKey alone', () => {
    // Every literal below was verified on 2026-07-25 by calling the pipeline's own
    // deriveMappingCacheKey(name, parseIngredientLine(rawLine), null, rawLine). It is
    // asserted here as a literal rather than by importing that function, because
    // importing src/lib/mapping/cache-key.ts loads simple-rerank -> config.ts and warms
    // the ONNX embedder (measured: it logs `embedding.model_loaded`), which is exactly
    // what the eval tooling must never do. Re-verify with:
    //   deriveMappingCacheKey(nf ?? raw, parseIngredientLine(raw), null, raw)

    it('appends the identity discriminators the save path appends (IDENTITY_UNIT_HINTS)', () => {
        // canonicalizeCacheKey alone read "egg" here — a different food's key.
        expect(makeFunnelRow({ rawLine: '3 egg whites', normalizedForm: 'egg' }).cacheKey).toBe('egg white');
    });

    it('appends IDENTITY_QUALIFIERS, so cooked does not share a key with dry', () => {
        expect(makeFunnelRow({ rawLine: '1 cup cooked oats', normalizedForm: 'oats' }).cacheKey).toBe('cooked oat');
    });

    it("collapses duplicate tokens — the brief's own 'rolled rolled oats' example", () => {
        expect(makeFunnelRow({ rawLine: 'rolled rolled oats' }).cacheKey).toBe('oat rolled');
    });

    it('still canonicalizes, singularizes and token-sorts (finding 2, first half)', () => {
        expect(makeFunnelRow({ rawLine: 'x', normalizedForm: 'chicken breast' }).cacheKey).toBe('breast chicken');
        expect(makeFunnelRow({ rawLine: 'x', normalizedForm: 'eggs' }).cacheKey).toBe('egg');
    });

    it('is idempotent under an already-discriminated form', () => {
        expect(makeFunnelRow({ rawLine: 'egg white', normalizedForm: 'egg white' }).cacheKey).toBe('egg white');
        expect(makeFunnelRow({ rawLine: 'whole milk', normalizedForm: 'milk' }).cacheKey).toBe('milk');
    });

    it('PINS the one step that is still missing — the brand prefix — instead of implying it is closed', () => {
        // deriveMappingCacheKey WRITES "bar protein quest" / "casein dymatize powder
        // protein" for these lines, because the query names the brand decisively. The
        // event log records neither the detected brand nor options.brand, so this
        // reads the generic key and hadIncumbent can be false-negative. If this test
        // ever fails because the keys now agree, the caveat
        // cachekey-is-the-read-key-not-always-the-write-key must be updated too.
        expect(makeFunnelRow({ rawLine: 'quest protein bar', normalizedForm: 'protein bar' }).cacheKey)
            .toBe('bar protein');
        expect(makeFunnelRow({ rawLine: 'dymatize casein', normalizedForm: 'casein protein powder' }).cacheKey)
            .toBe('casein powder protein');
    });

    it('degrades to the canonical key rather than losing a row the parser rejects', () => {
        expect(deriveFunnelCacheKey('---', 'pretzels')).toBe('pretzel');
        expect(deriveFunnelCacheKey('', 'eggs')).toBe('egg');
    });

    it('measures its own fidelity, so hadIncumbent is never read as per-row truth', () => {
        const adjusted = keyFidelityOf(makeFunnelRow({ rawLine: '3 egg whites', normalizedForm: 'egg' }));
        expect(adjusted).toMatchObject({
            canonicalOnly: 'egg', discriminatorApplied: true, carriesDiscriminatorToken: true,
        });
        const plain = keyFidelityOf(makeFunnelRow({ rawLine: 'pretzels', normalizedForm: 'pretzels' }));
        expect(plain).toMatchObject({ discriminatorApplied: false, carriesDiscriminatorToken: false });
    });

    it('WARNS in the classify-drops report when rows carry discriminator-bearing tokens', () => {
        const report = aggregate([
            makeFunnelRow({ rawLine: '3 egg whites', normalizedForm: 'egg', funnelStage: 'cache_hit', foodName: 'Egg White', grams: 33, kcalPer100g: 55 }),
            makeFunnelRow({ rawLine: 'cooked quinoa', normalizedForm: 'quinoa', funnelStage: 'cache_hit', foodName: 'Quinoa', grams: 185, kcalPer100g: 120 }),
        ], { inputLabel: 'test' });
        expect(report.inputFidelity.discriminatorTokenRows).toBe(2);
        expect(report.inputFidelity.discriminatorAdjustedRows).toBe(2);
        expect(report.inputFidelity.warnings.some(w => w.startsWith('KEY FIDELITY'))).toBe(true);
        expect(report.inputFidelity.warnings.join(' ')).toContain('hadIncumbent');
        expect(report.inputFidelity.discriminatorExamples[0]).toMatchObject({
            rawLine: '3 egg whites', cacheKey: 'egg white', canonicalOnly: 'egg',
        });
    });

    it('does not cry wolf on rows whose key needed no discriminator', () => {
        const report = aggregate([makeFunnelRow({
            rawLine: 'pretzels', normalizedForm: 'pretzels', funnelStage: 'save_rejected',
            dropReason: 'save_rejected:cross_source_margin', kcalPer100g: 380, grams: 3,
        })], { inputLabel: 'test' });
        expect(report.inputFidelity.warnings.some(w => w.startsWith('KEY FIDELITY'))).toBe(false);
    });

    it('states the identity-discriminator direction in the caveat, not just the brand one', () => {
        const caveat = FUNNEL_CAVEATS.find(c => c.id === 'cachekey-is-the-read-key-not-always-the-write-key')!;
        expect(caveat.note).toContain('IDENTITY DISCRIMINATORS');
        expect(caveat.note).toContain('egg white');
        expect(caveat.note).toContain('brand');
        // and it must not be duplicated by a second entry
        expect(FUNNEL_CAVEATS.filter(c => c.id === caveat.id)).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Finding 3: under_gate's dropReason carries no signal
// ---------------------------------------------------------------------------

describe("finding 3 — under_gate classes are decided by the row, not by the reason string", () => {
    const base = {
        funnelStage: 'under_gate' as const,
        grams: 120,
        kcalPer100g: 180,
        proteinPer100g: 10,
        carbsPer100g: 15,
        fatPer100g: 8,
        confidence: 0.74,
    };

    it('gives the SAME dropReason two different classes when the rows differ', () => {
        const hijack = makeFunnelRow({
            ...base, rawLine: 'just bare chicken breast strips', dropReason: 'under_gate:simple_rerank',
            foodName: 'Boneless Skinless Chicken Breast Strips', brandName: 'Buckley Farms',
        });
        const nearMiss = makeFunnelRow({
            ...base, rawLine: 'ground turkey', dropReason: 'under_gate:simple_rerank',
            foodName: '85% lean ground turkey',
        });
        expect(classifyRow(hijack).classId).toBe('identity-brand-substituted');
        expect(classifyRow(nearMiss).classId).toBe('under-gate-ranking-residual');
    });

    it('gives DIFFERENT dropReasons the same class when the rows are the same shape', () => {
        const forReason = (dropReason: string) => classifyRow(makeFunnelRow({
            ...base, rawLine: 'ground turkey', dropReason, foodName: '85% lean ground turkey',
        })).classId;
        expect(forReason('under_gate:close_match')).toBe('under-gate-ranking-residual');
        expect(forReason('under_gate:clear_winner')).toBe('under-gate-ranking-residual');
        expect(forReason('under_gate:simple_rerank')).toBe('under-gate-ranking-residual');
        expect(forReason('under_gate:single_candidate')).toBe('under-gate-ranking-residual');
    });

    it('reports the under_gate residual as frontier, not as a diagnosed defect', () => {
        const report = aggregate([makeFunnelRow({
            ...base, rawLine: 'ground turkey', dropReason: 'under_gate:close_match', foodName: '85% lean ground turkey',
        })], { inputLabel: 'test' });
        expect(report.frontier.map(c => c.classId)).toContain('under-gate-ranking-residual');
        expect(report.defects.map(c => c.classId)).not.toContain('under-gate-ranking-residual');
        // The raw reasons survive so a recurring shape can be promoted.
        expect(report.frontier[0].dropReasons[0].dropReason).toBe('under_gate:close_match');
    });
});

// ---------------------------------------------------------------------------
// Finding 4: converted, but poisoned
// ---------------------------------------------------------------------------

describe('finding 4 — a successful stage can still be a defect', () => {
    it('flags an all-zero-macro row that the funnel counted as saved', () => {
        const row = makeFunnelRow({
            rawLine: 'brazil nuts', funnelStage: 'saved', source: 'fatsecret', foodName: 'Brazil Nuts',
            grams: 100, kcalPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0, confidence: 0.98,
        });
        expect(row.quality.degenerateMacros).toBe(true);
        const { cls } = classifyRow(row);
        expect(cls?.id).toBe('degenerate-macros-served');
        expect(cls?.fixKind).toBe('data');
    });

    it('detects degeneracy from totalKcal alone, because MappingEventLog has no per-100g panel', () => {
        const row = makeFunnelRow({
            rawLine: 'barbecue sauce', funnelStage: 'saved', foodName: 'Barbecue Sauce', grams: 15.6, totalKcal: 0,
        });
        expect(row.kcalPer100g).toBeNull();
        expect(row.quality.degenerateMacros).toBe(true);
        expect(classifyRow(row).classId).toBe('degenerate-macros-served');
    });

    it('does not call a 0-gram abstention degenerate (nothing was billed)', () => {
        const row = makeFunnelRow({ rawLine: 'chipotle chicken burrito', funnelStage: 'no_match', grams: 0, totalKcal: 0 });
        expect(row.quality.degenerateMacros).toBe(false);
    });

    it('flags a flat-100g serving but respects an explicitly resolved weight tier', () => {
        const flat = makeFunnelRow({ rawLine: 'spinach', funnelStage: 'cache_hit', foodName: 'Spinach', grams: 100, kcalPer100g: 16.3 });
        const asked = makeFunnelRow({ rawLine: '100g spinach', funnelStage: 'cache_hit', foodName: 'Spinach', grams: 100, kcalPer100g: 16.3, servingTier: 'weight_unit' });
        expect(flat.quality.flat100gServing).toBe(true);
        expect(asked.quality.flat100gServing).toBe(false);
    });

    it('marks an ai_estimated backfill so an ingest gap is not mistaken for a ranking gap', () => {
        const row = makeFunnelRow({ rawLine: 'qdoba steak bowl', funnelStage: 'all_filtered', source: 'ai_estimated', grams: 100 });
        expect(row.quality.aiEstimated).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// The --from-db row shape: no per-100g panel
// ---------------------------------------------------------------------------

/**
 * Rebuild an exemplar exactly as classify-drops' readFromDb would deliver it:
 * MappingEventLog stores grams and totalKcal and NO per-100g macros
 * (prisma/schema.prisma:717-752). This is the highest-value test in the file — the
 * whole `corrupt-panel-served` class was dead in this mode and its rows were being
 * counted as HEALTHY, and nothing failed.
 */
function asDbRow(input: FunnelRowInput): FunnelRowInput {
    const withDerivedTotal = makeFunnelRow(input);
    return {
        ...input,
        totalKcal: withDerivedTotal.totalKcal,
        kcalPer100g: null,
        proteinPer100g: null,
        carbsPer100g: null,
        fatPer100g: null,
    };
}

describe('--from-db row shape (grams + totalKcal, no macro panel)', () => {
    it('inverts kcal/100g exactly out of grams and totalKcal', () => {
        const row = makeFunnelRow(asDbRow({
            rawLine: 'lemon', funnelStage: 'cache_hit', foodName: 'Lemon', grams: 58, kcalPer100g: 383,
        }));
        expect(row.kcalPer100g).toBeNull();
        expect(effectiveKcalPer100g(row)).toBeCloseTo(383, 6);
        // and nothing is invented when the row billed nothing
        expect(effectiveKcalPer100g(makeFunnelRow({ rawLine: 'x', grams: 0, totalKcal: 0 }))).toBeNull();
        expect(effectiveKcalPer100g(makeFunnelRow({ rawLine: 'x' }))).toBeNull();
    });

    // THE loop the review asked for: every class, every exemplar, panel stripped.
    for (const cls of FAILURE_CLASSES) {
        for (const input of cls.exemplarRows) {
            const blind = (cls.fromDbBlind ?? []).find(b => b.exemplar === input.rawLine);
            const label = blind
                ? `"${input.rawLine}" is DECLARED blind from --from-db`
                : `"${input.rawLine}" still classifies as ${cls.id} from --from-db`;
            it(`${cls.id}: ${label}`, () => {
                const row = makeFunnelRow(asDbRow(input));
                if (blind) {
                    // Declared losses must be REAL. If this fails the detector improved —
                    // delete the fromDbBlind entry (and its doc text) rather than this test.
                    expect(cls.detector(row)).toBe(false);
                    expect(blind.why.length).toBeGreaterThan(40);
                } else {
                    expect(cls.detector(row)).toBe(true);
                    expect(classifyRow(row).classId).toBe(cls.id);
                }
            });
        }
    }

    it('catches the physically-impossible panel from --from-db (the arm that must not be lost)', () => {
        const carrot = makeFunnelRow(asDbRow({
            rawLine: 'carrot', funnelStage: 'saved', source: 'openfoodfacts', foodName: 'Carrots',
            grams: 61, kcalPer100g: 1720, proteinPer100g: 0.9, carbsPer100g: 9.6, fatPer100g: 0.2,
        }));
        expect(classifyRow(carrot).classId).toBe('corrupt-panel-served');
    });

    it('declares — rather than hides — where a blind exemplar lands instead', () => {
        const lemon = makeFunnelRow(asDbRow({
            rawLine: 'lemon', funnelStage: 'cache_hit', source: 'openfoodfacts', foodName: 'Lemon',
            grams: 58, kcalPer100g: 383, proteinPer100g: 0.4, carbsPer100g: 9.3, fatPer100g: 0.3,
        }));
        // This IS the failure the review found: a corrupt panel counted as clean. It is
        // unfixable from this input (Atwater needs macros), so it must be DECLARED.
        expect(classifyRow(lemon).classId).toBe('cache-hit-healthy');
        const spots = fromDbBlindSpots();
        expect(spots.map(s => `${s.classId}:${s.exemplar}`)).toContain('corrupt-panel-served:lemon');
        expect(spots.every(s => s.why.includes('MappingEventLog') || s.why.includes('Atwater'))).toBe(true);
    });

    it('classify-drops REPORTS the inert detectors when no row carries a panel', () => {
        const fid = measureInputFidelity([
            makeFunnelRow(asDbRow({ rawLine: 'lemon', funnelStage: 'cache_hit', foodName: 'Lemon', grams: 58, kcalPer100g: 383 })),
            makeFunnelRow(asDbRow({ rawLine: 'carrot', funnelStage: 'saved', foodName: 'Carrots', grams: 61, kcalPer100g: 1720 })),
        ]);
        expect(fid.rowsWithPanel).toBe(0);
        expect(fid.inertDetectors.map(d => d.classId)).toContain('corrupt-panel-served');
        expect(fid.warnings[0]).toContain('NO PER-100g MACRO PANEL');
        expect(fid.warnings.join(' ')).toContain('NOT evidence of absence');
    });

    it('says nothing about inert detectors when the input DOES carry panels', () => {
        const fid = measureInputFidelity([makeFunnelRow({
            rawLine: 'lemon', funnelStage: 'cache_hit', foodName: 'Lemon', grams: 58,
            kcalPer100g: 383, proteinPer100g: 0.4, carbsPer100g: 9.3, fatPer100g: 0.3,
        })]);
        expect(fid.rowsWithPanel).toBe(1);
        expect(fid.warnings.some(w => w.includes('NO PER-100g MACRO PANEL'))).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// no_candidates is a corpus gap, never a filter blackout
// ---------------------------------------------------------------------------

describe('no_candidates routing', () => {
    it('routes a no_candidates row to ingest-gap-no-candidates', () => {
        const row = makeFunnelRow({
            rawLine: 'shrimp scampi', normalizedForm: 'shrimp scampi', funnelStage: 'no_candidates',
            dropReason: 'no_candidates:dataset_gap', source: 'ai_estimated', foodName: 'Shrimp Scampi',
            grams: 100, kcalPer100g: 220, proteinPer100g: 12, carbsPer100g: 10, fatPer100g: 14,
        });
        expect(classifyRow(row).classId).toBe('ingest-gap-no-candidates');
        expect(classifyRow(row).cls?.fixKind).toBe('ingest');
    });

    it('routes a VENUE-WORDED no_candidates row to the ingest gap, not the blackout tripwire', () => {
        // The blackout was a FILTER bug: candidates were gathered, then rejected — that is
        // all_filtered by definition. Claiming no_candidates too made this row a "closed"
        // pipeline tripwire and burned the session ingest-gap exists to save.
        for (const rawLine of ['restaurant shrimp scampi', 'chipotle grill chicken bowl', 'corner cafe muffin']) {
            const row = makeFunnelRow({
                rawLine, funnelStage: 'no_candidates', dropReason: 'no_candidates:dataset_gap',
                source: 'ai_estimated', grams: 100, kcalPer100g: 200,
            });
            expect(classifyRow(row).classId).toBe('ingest-gap-no-candidates');
        }
    });

    it('keeps the tripwire on all_filtered, where a filter blackout actually shows up', () => {
        const tripwire = classById('venue-brand-blackout-tripwire')!;
        expect(classStages(tripwire)).toEqual(['all_filtered']);
        const row = makeFunnelRow({
            rawLine: 'restaurant shrimp scampi', funnelStage: 'all_filtered',
            dropReason: 'all_filtered:no_candidate_survived_filters', source: 'ai_estimated', grams: 100, kcalPer100g: 220,
        });
        expect(classifyRow(row).classId).toBe('venue-brand-blackout-tripwire');
    });

    it('leaves no_candidates owned by exactly one class', () => {
        const owners = FAILURE_CLASSES.filter(c => classStages(c).includes('no_candidates'));
        expect(owners.map(c => c.id)).toEqual(['ingest-gap-no-candidates']);
    });
});

// ---------------------------------------------------------------------------
// Live-dropReason coverage: the whole point of seeding from measured data
// ---------------------------------------------------------------------------

describe('live coverage', () => {
    it('measured 19 dropReason classes on the live box', () => {
        expect(LIVE_DROP_REASONS).toHaveLength(19);
    });

    it.each(LIVE_DROP_REASONS.map(l => [l.dropReason, l] as const))(
        '%s resolves to a class',
        (_dropReason, live) => {
            const row = makeFunnelRow({ rawLine: probeLineFor(live), funnelStage: live.stage, dropReason: live.dropReason });
            const { classId, cls } = classifyRow(row);
            expect(cls).not.toBeNull();
            expect(classId).not.toBe(UNCLASSIFIED);
        },
    );

    it('routes fast_path:zero_calorie to the healthy class, not the hijack tripwire', () => {
        // The two fast_path classes are separated by the LINE, so the coverage probe
        // must be a real water query or the audit misreports the owner.
        const live = LIVE_DROP_REASONS.find(l => l.dropReason === 'fast_path:zero_calorie')!;
        const row = makeFunnelRow({ rawLine: probeLineFor(live), funnelStage: live.stage, dropReason: live.dropReason });
        expect(classifyRow(row).classId).toBe('fast-path-zero-calorie');
    });

    it('covers all 19 measured dropReasons with no gaps', () => {
        const report = aggregate(
            LIVE_DROP_REASONS.map(l => makeFunnelRow({ rawLine: probeLineFor(l), funnelStage: l.stage, dropReason: l.dropReason })),
            { inputLabel: 'coverage' },
        );
        expect(report.uncoveredLiveDropReasons).toEqual([]);
        expect(report.unclassifiedEvents).toBe(0);
        expect(report.unclassifiedRate).toBe(0);
    });

    it('still reports a genuinely novel shape as unclassified rather than swallowing it', () => {
        // A stage no class claims: the frontier must remain observable.
        const row = makeFunnelRow({ rawLine: 'something that threw', funnelStage: 'error' });
        expect(classifyRow(row).classId).toBe(UNCLASSIFIED);
        const report = aggregate([row], { inputLabel: 'test' });
        expect(report.unclassified?.events).toBe(1);
        expect(report.unclassifiedRate).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Helpers the detectors lean on
// ---------------------------------------------------------------------------

describe('token helpers', () => {
    it('treats a spelling variant as covered but a missing brand as uncovered', () => {
        expect(uncoveredTokens("moe's guac", 'Guacamole', 'Morrisons')).toEqual(['moes']);
        expect(uncoveredTokens('honey bunches of oats', 'Honey Bunches of Oats', 'Post')).toEqual([]);
        expect(uncoveredTokens('ground beef 90/10', 'Ground Beef 85% Lean 15% Fat', "Rastelli's")).toEqual([]);
    });

    it('drops measure words and bare numbers from identity tokens', () => {
        expect(contentTokens('2 cups cooked white rice')).toEqual(['cooked', 'white', 'rice']);
    });

    it('recognises assembled dishes without calling every two-word food composite', () => {
        expect(isCompositeQuery('chipotle chicken burrito')).toBe(true);
        expect(isCompositeQuery('qdoba chicken bowl')).toBe(true);
        expect(isCompositeQuery('mac and cheese')).toBe(true);
        expect(isCompositeQuery('chicken breast')).toBe(false);
        expect(isCompositeQuery('brazil nuts')).toBe(false);
    });

    it('normalizes interpolated measurements out of a dropReason so it groups', () => {
        expect(dropClassOf('save_rejected', 'save_rejected:implausible_macros:atwater:kcal_412_exceeds_computed_388.5'))
            .toBe('implausible_macros:atwater:kcal_exceeds_computed');
        expect(dropClassOf('under_gate', 'under_gate:confidence_below_threshold(0.42)'))
            .toBe('confidence_below_threshold');
        expect(dropClassOf('saved', null)).toBe('');
    });

    it('matches dropClass patterns exactly or by prefix', () => {
        const row = makeFunnelRow({
            rawLine: 'x', funnelStage: 'save_rejected',
            dropReason: 'save_rejected:implausible_macros:estimate:kcal_vs_expected',
        });
        expect(hasDropClass(row, 'implausible_macros:estimate:*')).toBe(true);
        expect(hasDropClass(row, 'implausible_macros:estimate:kcal_vs_expected')).toBe(true);
        expect(hasDropClass(row, 'implausible_macros:category:*')).toBe(false);
        expect(hasDropClass(row, 'cross_source_margin')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// The generated doc must stay in step with the registry
// ---------------------------------------------------------------------------

describe('generated doc', () => {
    const doc = renderDoc();

    it('lists every class', () => {
        for (const c of FAILURE_CLASSES) expect(doc).toContain(`\`${c.id}\``);
    });

    it('states the fixKind routing rule for ingest classes', () => {
        expect(classById('ingest-gap-no-candidates')?.fixKind).toBe('ingest');
        expect(doc).toContain('NEVER a fix-agent');
    });

    it('carries the live coverage table and the caveats', () => {
        expect(doc).toContain('save_rejected:cross_source_margin');
        expect(doc).toContain('error-stage-is-dead-code');
    });
});
