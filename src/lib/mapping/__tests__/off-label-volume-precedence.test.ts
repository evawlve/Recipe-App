/**
 * LANE A / V2a (2026-08-18) — the OFF record's OWN label serving outranks the
 * volume class constant when the requested unit IS the label's unit.
 *
 * THE DEFECT. `buildOffResult()`'s branch chain ran the class constant first:
 *
 *   } else if (unit && volumeToGrams[unit]) {                      // fires FIRST
 *           grams = qty * volumeToGrams[unit];  servingTier = 'volume_unit';
 *   } else if (unit && labelUnitWord && perLabelUnitGrams && ... ) {
 *           grams = qty * perLabelUnitGrams;    servingTier = 'label_unit_match';
 *
 * so `label_unit_match` was UNREACHABLE for every volume unit. For an OFF
 * product whose own `serving_size` reads `1 cup (30 g)` the record states the
 * answer and the class constant billed `240 x 0.5 = 120 g` — 4x over, on the
 * highest-traffic volume tier in the system (`volume_unit`, 413 events / 7 days,
 * 4.3% of all serving-tier traffic).
 *
 * That tier is OFF traffic in all but a rounding error, which is why an OFF-only
 * fix reaches it: measured 2026-08-18, `MappingEventLog` carries 5 rows with
 * `source='fdc'` against 8,200+ `openfoodfacts`, and all 5 are warm rows whose
 * `rawLine` is "about 1 cup of egg whites" — the golden case `n-prose-01`, i.e.
 * OUR OWN eval traffic, not a user. Stated this way deliberately: an earlier
 * draft of this file (and the plan it came from) asserted the absolute "the FDC
 * arm has never billed a live query", and a census this session refuted it. The
 * conclusion is unchanged; the absolute was wrong.
 *
 * The file already states the opposing principle a few lines above, about
 * `PACKAGE_LIKE_UNITS`: *"Units where the product's own label serving IS the
 * thing the user asked for ... For these, trust servingGrams over estimation."*
 * Volume was never added to it, and no comment anywhere defended the order.
 *
 * WHAT CHANGED. One added conjunct on the `volume_unit` branch —
 * `&& !ownLabelBeatsVolumeConstant` — and the derived boolean behind it. No
 * branch body moved; the existing `label_unit_match` branch picks the request up
 * unchanged.
 *
 * TWO STRUCTURAL PROPERTIES make the blast radius provable rather than merely
 * tested, and both matter more than any assertion in this file:
 *
 *   SUBSET. `ownLabelBeatsVolumeConstant` re-tests `volumeToGrams[unit]` itself,
 *   so it can only ever intercept a bill the `volume_unit` branch would have
 *   made. Nothing that reached any other branch can reach this one.
 *
 *   STRICT SUPERSET, i.e. no fall-through. Its conjuncts are a strict superset
 *   of the `label_unit_match` branch's own condition (`unit && labelUnitWord &&
 *   perLabelUnitGrams && singularizeUnit(unit) === labelUnitWord`), so a line it
 *   demotes is GUARANTEED to be caught by that branch on the very next test. A
 *   demoted line cannot fall past it into `PACKAGE_LIKE_UNITS`, the count rungs
 *   or `flat_100g_default`. The dangerous shape for a precedence change — "the
 *   winner was disqualified and the line landed somewhere worse" — is
 *   unreachable by construction, not by luck.
 *
 * THE BAND. The guard reuses `findOwnFdcVolumeServing()`'s density band
 * `[VOLUME_SERVING_MIN_DENSITY, VOLUME_SERVING_MAX_DENSITY]` = [0.1, 1.6] g/ml,
 * and holds out `dash`/`pinch` (absolute cells, not densities) plus the whole
 * pinned flat family `OFF_FLAT_VOLUME_CELLS` (`ml`, `floz`, `fl oz`). Block 5
 * states exactly what the reuse argument does and does not buy; block 4 records
 * the low edge's known cost in the same breath.
 *
 * WHICH BLOCKS WITNESS WHAT — stated because "23 passed" hides it:
 *   1, 2      RED on master, GREEN here. The behaviour change.
 *   3, 6, 7   MASTER-PINNED CONTROLS. Every expectation is the value master
 *             produces, recorded before the fix existed. Green on both trees,
 *             and non-vacuously so: they assert values master genuinely computes.
 *   4         Evidence about the band. Green on master too, but VACUOUSLY —
 *             master answers `volume_unit:120` to every cup request. Not a
 *             control. See the note on that block.
 *   5         Pure derivation over the constants. Tree-independent.
 *   8         The wire field. Tree-independent derivation, driven by the real
 *             branch's real tier.
 */

import { buildOffResult, findOwnFdcVolumeServing } from '../map-ingredient-with-fallback';
import { hydrateOffCandidate } from '../../openfoodfacts/hydrate';
import { resolveVolumeGrams } from '../../units/volume-density';
import { categoryDensity, DRY_GRANULE_DENSITY_CATEGORIES } from '../../units/density';
import { portionProvenanceForTier } from '../serving-ai-tiers';
import { prisma } from '../../db';
import type { ParsedIngredient } from '../../parse/ingredient-line';

/**
 * `VOLUME_SERVING_MIN_DENSITY` / `VOLUME_SERVING_MAX_DENSITY`
 * (`serving/hydration-lane.ts:2048-2049`), TRANSCRIBED rather than imported so
 * this file compiles unchanged on pristine master and its RED is behavioural,
 * not a missing-export compile error. Block 5's first test pins the
 * transcription against the REAL band by driving the already-exported
 * `findOwnFdcVolumeServing()` — the only other consumer — across all four
 * edges, so the two copies cannot drift.
 */
const BAND_MIN = 0.1;
const BAND_MAX = 1.6;
/** Millilitres in a cup, on both the owner's and the lane's private table. */
const CUP_ML = 240;

jest.mock('../../db', () => ({
    prisma: {
        $queryRaw: jest.fn().mockResolvedValue([]),
        fdcServing: {
            findMany: jest.fn().mockResolvedValue([]),
            findUnique: jest.fn().mockResolvedValue(null),
            findFirst: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue({}),
        },
        fdcFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        offFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        offServing: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
        fatSecretFood: { findUnique: jest.fn().mockResolvedValue(null) },
        aiGeneratedFood: {
            findMany: jest.fn().mockResolvedValue([]),
            findFirst: jest.fn().mockResolvedValue(null),
            findUnique: jest.fn().mockResolvedValue(null),
        },
        foodMapping: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    },
}));

// Every model-reaching rung OFF, so the branch under test is the only resolver.
jest.mock('../ambiguous-unit-backfill', () => {
    const actual = jest.requireActual('../ambiguous-unit-backfill');
    return { ...actual, getOrCreateAmbiguousServing: jest.fn().mockResolvedValue({ status: 'error', error: 'mocked-off' }) };
});
jest.mock('../../ai/ambiguous-serving-estimator', () => {
    const actual = jest.requireActual('../../ai/ambiguous-serving-estimator');
    return { ...actual, estimateAmbiguousServing: jest.fn().mockResolvedValue({ status: 'error', error: 'mocked-off' }) };
});
jest.mock('../../openfoodfacts/hydrate', () => ({ hydrateOffCandidate: jest.fn() }));

const mockedHydrateOff = hydrateOffCandidate as jest.Mock;

/**
 * A SOLID, uncategorised name: no LIQUID_RE / PASTE_RE / BEVERAGE_RE token and
 * no CATEGORY_KEYWORDS hit, so `resolveVolumeGrams()` bills the flat 0.5 g/ml
 * dry-goods default and one cup of it is exactly the 120 g the defect bills.
 */
const SOLID_NAME = 'Crunchy Puffed Cereal';
/** The class constant this lane is overtaking, restated as a number. */
const CLASS_CONSTANT_CUP_G = 120;

function parsed(p: Partial<ParsedIngredient>): ParsedIngredient {
    return { qty: 1, multiplier: 1, unit: undefined, name: 'cereal', ...p } as ParsedIngredient;
}

function offCandidate(name = SOLID_NAME) {
    return { id: 'off_100', source: 'openfoodfacts' as const, name, score: 1, foodType: 'generic', rawData: {} } as never;
}

/** Shaped exactly like `hydrateOffCandidate()`'s return — see `openfoodfacts/hydrate.ts`. */
function offHydrated(over: Partial<{
    foodName: string; brandName: string | null;
    servingGrams: number | null; servingDescription: string | null; servingUnitCount: number;
}> = {}) {
    return {
        foodId: 'off_100',
        foodName: SOLID_NAME,
        brandName: null,
        nutrientsPer100g: { calories: 380, protein: 6, carbs: 84, fat: 2 },
        servingGrams: null,
        servingDescription: null,
        servingUnitCount: 1,
        packageQuantity: null,
        packageQuantityUnit: null,
        ...over,
    };
}

/** `${servingTier}:${grams}` — one string so a wrong tier and a wrong number both show. */
async function bill(
    p: Partial<ParsedIngredient>, rawLine: string, candidateName = SOLID_NAME,
): Promise<string> {
    const r = await buildOffResult(offCandidate(candidateName), parsed(p), 0.9, rawLine);
    return `${r?.servingTier}:${r?.grams}`;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockedHydrateOff.mockResolvedValue(offHydrated());
});

// ------------------------------------------------------------------
// 1. THE RED — the record states the answer and the constant billed anyway
// ------------------------------------------------------------------
describe('1. RED on master: an OFF label whose unit IS the requested unit wins', () => {
    it('`1 cup` on a record labelled "1 cup (30 g)" bills 30 g / label_unit_match, not 120 g / volume_unit', async () => {
        mockedHydrateOff.mockResolvedValue(offHydrated({
            servingGrams: 30, servingDescription: '1 cup (30 g)', servingUnitCount: 1,
        }));
        expect(await bill({ qty: 1, unit: 'cup' }, '1 cup cereal')).toBe('label_unit_match:30');
    });

    it('the plural spelling `cups` singularises onto the same label (2 cups -> 60 g)', async () => {
        mockedHydrateOff.mockResolvedValue(offHydrated({
            servingGrams: 30, servingDescription: '1 cup (30 g)', servingUnitCount: 1,
        }));
        expect(await bill({ qty: 2, unit: 'cups' }, '2 cups cereal')).toBe('label_unit_match:60');
    });

    it('tbsp and tsp labels win the same way (the other two live spellings of this tier)', async () => {
        mockedHydrateOff.mockResolvedValue(offHydrated({
            servingGrams: 12, servingDescription: '1 tbsp (12 g)', servingUnitCount: 1,
        }));
        expect(await bill({ qty: 2, unit: 'tbsp' }, '2 tbsp cereal')).toBe('label_unit_match:24');

        mockedHydrateOff.mockResolvedValue(offHydrated({
            servingGrams: 4, servingDescription: '1 tsp (4 g)', servingUnitCount: 1,
        }));
        expect(await bill({ qty: 3, unit: 'tsp' }, '3 tsp cereal')).toBe('label_unit_match:12');
    });
});

// ------------------------------------------------------------------
// 2. THE LABEL'S OWN COUNT DIVIDES — "2 cups (480 g)" is 240 g per cup
// ------------------------------------------------------------------
describe('2. the label unit-count divides (perLabelUnitGrams = servingGrams / labelUnitCount)', () => {
    it('a "2 cups (480 g)" label bills 240 g for ONE cup, not 480 g', async () => {
        mockedHydrateOff.mockResolvedValue(offHydrated({
            servingGrams: 480, servingDescription: '2 cups (480 g)', servingUnitCount: 2,
        }));
        expect(await bill({ qty: 1, unit: 'cup' }, '1 cup cereal')).toBe('label_unit_match:240');
        expect(await bill({ qty: 2, unit: 'cups' }, '2 cups cereal')).toBe('label_unit_match:480');
    });

    it('a fractional label count divides too ("0.5 cup (15 g)" -> 30 g per cup)', async () => {
        mockedHydrateOff.mockResolvedValue(offHydrated({
            servingGrams: 15, servingDescription: '0.5 cup (15 g)', servingUnitCount: 0.5,
        }));
        expect(await bill({ qty: 1, unit: 'cup' }, '1 cup cereal')).toBe('label_unit_match:30');
    });
});

// ------------------------------------------------------------------
// 3. NEGATIVE CONTROLS — green on BOTH trees. The constant is still the fallback.
// ------------------------------------------------------------------
describe('3. the class constant is still the fallback', () => {
    it('no label at all -> volume_unit, the class constant', async () => {
        expect(await bill({ qty: 1, unit: 'cup' }, '1 cup cereal')).toBe(`volume_unit:${CLASS_CONSTANT_CUP_G}`);
    });

    it('a label whose unit is NOT the requested unit -> volume_unit', async () => {
        mockedHydrateOff.mockResolvedValue(offHydrated({
            servingGrams: 150, servingDescription: '1 container (150 g)', servingUnitCount: 1,
        }));
        expect(await bill({ qty: 1, unit: 'cup' }, '1 cup cereal')).toBe(`volume_unit:${CLASS_CONSTANT_CUP_G}`);
    });

    it('a label unit word with a description but NO servingGrams -> volume_unit', async () => {
        mockedHydrateOff.mockResolvedValue(offHydrated({
            servingGrams: null, servingDescription: '1 cup', servingUnitCount: 1,
        }));
        expect(await bill({ qty: 1, unit: 'cup' }, '1 cup cereal')).toBe(`volume_unit:${CLASS_CONSTANT_CUP_G}`);
    });

    it('a LIQUID record with no label still bills the pourable constant (1 cup milk -> 240 g)', async () => {
        mockedHydrateOff.mockResolvedValue(offHydrated({ foodName: 'Whole Milk' }));
        expect(await bill({ qty: 1, unit: 'cup', name: 'milk' }, '1 cup milk', 'Whole Milk')).toBe('volume_unit:240');
    });
});

// ------------------------------------------------------------------
// 4. WHAT THE BAND REFUSES — one junk label, and one that is NOT junk
// ------------------------------------------------------------------
/**
 * NOTE ON WHAT THESE TWO REFUSAL TESTS CAN AND CANNOT WITNESS. They pass on
 * master too, but VACUOUSLY: master answers `volume_unit:120` to every cup
 * request because the label branch is unreachable there, so on master they
 * cannot tell "the band refused the label" apart from "no label was ever
 * consulted." They discriminate only on this branch, where the same fixture
 * with an in-band gram figure returns `label_unit_match`. They are evidence
 * about the band, not master-pinned controls — blocks 3, 6 and 7 are the
 * master-pinned controls.
 */
describe('4. what the band refuses', () => {
    it('JUNK, correctly refused: "1 cup (500 g)" implies 2.08 g/ml, denser than honey', async () => {
        mockedHydrateOff.mockResolvedValue(offHydrated({
            servingGrams: 500, servingDescription: '1 cup (500 g)', servingUnitCount: 1,
        }));
        expect(await bill({ qty: 1, unit: 'cup' }, '1 cup cereal')).toBe(`volume_unit:${CLASS_CONSTANT_CUP_G}`);
    });

    /**
     * NOT JUNK. This test pins a KNOWN LIMITATION, not a desired behaviour.
     *
     * A cup of popcorn really is ~8 g (0.033 g/ml). The label is CORRECT and the
     * band refuses it anyway, so the line bills the flat-solid class constant of
     * 120 g — a ~15x overbill, ~630 kcal charged for ~31 kcal of food. Puffed
     * wheat at `1 cup (15 g)` (0.0625 g/ml) is the same failure at ~8x.
     * `popcorn` matches no CATEGORY_KEYWORDS entry, so it cannot even reach a
     * dry-granule density and takes the flat 0.5.
     *
     * It is asserted here because it is TRUE OF THIS BRANCH, and because the
     * alternative — leaving it unasserted — is how a reader concludes the low
     * edge is calibrated. It is not. The band's low edge was inherited from
     * `findOwnFdcVolumeServing()` and is unmeasured against the OFF label
     * population; the corpus read that would settle it was written and refused
     * by this session's permission classifier.
     *
     * NOT A REGRESSION: master bills 120 g for this exact line too, by a
     * different route (the label branch is unreachable there). This lane neither
     * causes nor fixes it. Narrowing the low edge is a separate change that
     * needs the measurement first — whoever gets it owns this test.
     */
    it('LIMITATION, carried forward from master: real popcorn at "1 cup (8 g)" is refused and overbilled 15x', async () => {
        mockedHydrateOff.mockResolvedValue(offHydrated({
            foodName: 'Popcorn', servingGrams: 8, servingDescription: '1 cup (8 g)', servingUnitCount: 1,
        }));
        expect(await bill({ qty: 1, unit: 'cup', name: 'popcorn' }, '1 cup popcorn', 'Popcorn'))
            .toBe('volume_unit:120');
    });

    it('the band edges are INCLUSIVE and admit the extremes ([0.1, 1.6] g/ml on a 240 ml cup)', async () => {
        mockedHydrateOff.mockResolvedValue(offHydrated({
            servingGrams: CUP_ML * BAND_MIN, servingDescription: '1 cup (24 g)', servingUnitCount: 1,
        }));
        expect(await bill({ qty: 1, unit: 'cup' }, '1 cup cereal')).toBe('label_unit_match:24');

        mockedHydrateOff.mockResolvedValue(offHydrated({
            servingGrams: CUP_ML * BAND_MAX, servingDescription: '1 cup (384 g)', servingUnitCount: 1,
        }));
        expect(await bill({ qty: 1, unit: 'cup' }, '1 cup cereal')).toBe('label_unit_match:384');
    });
});

// ------------------------------------------------------------------
// 5. THE MEASUREMENT that justifies REUSING the band rather than inventing one
// ------------------------------------------------------------------
describe('5. the band is strictly wider than every density the estimator itself can produce', () => {
    /**
     * WHAT THIS BLOCK PROVES, AND — read this first — WHAT IT DOES NOT.
     *
     * `resolveVolumeGrams()` emits exactly four shapes of cup cell:
     *   pourable (liquid | beverage)  240 g   -> 1.0000 g/ml
     *   paste                         250 g   -> 1.0417 g/ml
     *   solid, flat default           120 g   -> 0.5000 g/ml
     *   solid, dry-granule category   240 x categoryDensity(c)
     *                                         -> {oats .36 ... sugar .85}
     * so the whole reachable range is [0.36, 1.0417] g/ml, and [0.1, 1.6]
     * brackets it with 3.6x of slack below and 1.54x above.
     *
     * PROVES: a bound on the CHANGE. Wherever the band refuses a label, the line
     * falls to a constant that was already at least that far from the label's
     * number, so a refusal cannot bill worse than master billed the same line.
     * That is what makes reusing the band safe to ship.
     *
     * DOES NOT PROVE: that the band is right about FOOD. It is a fact about the
     * estimator's cells; the band is applied to the LABEL's implied density, and
     * labels are a different population — real foods sit outside [0.36, 1.0417]
     * in both directions, and the low edge demonstrably refuses correct labels
     * (block 4's popcorn case, ~15x overbill). The corpus read that would
     * calibrate the edges against real OFF labels was written and refused by
     * this session's permission classifier, so no such claim is made here.
     *
     * Unlike prose, this goes RED if a future constants PR pushes a class
     * density past the band.
     */
    const reachableDensities = (): number[] => {
        const solids = [0.5, ...[...DRY_GRANULE_DENSITY_CATEGORIES]
            .map(c => categoryDensity(c))
            .filter((d): d is number => d != null && d > 0)];
        return [240 / 240, 250 / 240, ...solids];
    };

    it('BAND_MIN/BAND_MAX above are the REAL band — pinned through findOwnFdcVolumeServing()', async () => {
        const fdcFindMany = prisma.fdcServing.findMany as unknown as jest.Mock;
        const probe = async (density: number) => {
            fdcFindMany.mockResolvedValue([
                { description: '1 cup', grams: CUP_ML * density, isAiEstimated: false },
            ]);
            return (await findOwnFdcVolumeServing(1, 'cup'))?.perUnitGrams ?? null;
        };
        // Inclusive at both edges, refused just outside them. Four probes, so a
        // change to either constant in the lane fails HERE as well as in the
        // OFF branch this file is about.
        expect(await probe(BAND_MIN)).toBeCloseTo(CUP_ML * BAND_MIN, 6);
        expect(await probe(BAND_MAX)).toBeCloseTo(CUP_ML * BAND_MAX, 6);
        expect(await probe(BAND_MIN - 0.001)).toBeNull();
        expect(await probe(BAND_MAX + 0.001)).toBeNull();
    });

    it('every density resolveVolumeGrams() can produce sits strictly inside the band', () => {
        for (const d of reachableDensities()) {
            expect(d).toBeGreaterThan(BAND_MIN);
            expect(d).toBeLessThan(BAND_MAX);
        }
    });

    it('the slack is at least 1.5x on both sides — the band is not a re-statement of the estimator', () => {
        const ds = reachableDensities();
        const lo = Math.min(...ds);
        const hi = Math.max(...ds);
        expect(lo).toBeCloseTo(0.36, 6);                 // oats, the lightest class cell
        expect(hi).toBeCloseTo(250 / 240, 6);            // paste, the densest class cell
        expect(lo / BAND_MIN).toBeGreaterThan(1.5);
        expect(BAND_MAX / hi).toBeGreaterThan(1.5);
    });

    it('cross-check: the four class cells are what the estimator actually returns', () => {
        const cup = (n: string) => resolveVolumeGrams(n).perUnit['cup'];
        expect(cup('Whole Milk')).toBeCloseTo(240, 6);              // pourable
        expect(cup('Peanut Butter')).toBeCloseTo(250, 6);           // paste
        expect(cup(SOLID_NAME)).toBeCloseTo(120, 6);                // flat solid
        expect(cup('Granulated Sugar')).toBeCloseTo(204, 6);        // dry granule, densest
        expect(cup('Rolled Oats')).toBeCloseTo(86.4, 6);            // dry granule, lightest
    });
});

// ------------------------------------------------------------------
// 6. THE HELD-OUT UNITS — the pinned flat family, plus dash/pinch
// ------------------------------------------------------------------
/**
 * `volume-unit-spellings.test.ts` block 4 is a real no-regression pin for the
 * flat-ml asymmetry, but it CANNOT witness this guard: all four of its OFF
 * fixtures carry `servingGrams: null, servingDescription: null`, so no label
 * exists for the new branch to prefer and the guard is never consulted. So this
 * block is the only place the hold-out is exercised at all — its fixtures DO
 * carry a matching label, and assert the constant wins anyway.
 *
 * WHICH TEST HERE ACTUALLY WITNESSES THE HOLD-OUT: only the `floz` one. The
 * lane's private `VOLUME_UNIT_ML` has NO `ml` key, so `ml` was already refused
 * by the missing-cell arm of the guard — the `ml` test below stays green if
 * `OFF_FLAT_VOLUME_CELLS` is mutated out of the guard, so it pins the BEHAVIOUR
 * without witnessing the mechanism. `floz` has a cell (30) and an in-band label
 * density (45/30 = 1.5), so it is the one case the hold-out decides, and it
 * flips red when the hold-out is removed.
 *
 * COST OF THE HOLD-OUT: ZERO events, not 2. The `ml` half changes nothing (it
 * was already refused) and measured `floz` traffic is 0. An earlier draft said
 * "costs 2" by charging the hold-out for `ml`'s 2 events, which it does not
 * cause.
 */
describe('6. the pinned flat family and the absolute cells are held out', () => {
    it('`floz` on a record labelled "1 floz (45 g)" keeps the flat 30 g, NOT the label', async () => {
        // 45/30 = 1.5 g/ml is INSIDE [0.1, 1.6], so only the OFF_FLAT_VOLUME_CELLS
        // hold-out stops this. Without it the whole pinned family would be
        // half-applied: `ml` protected, `floz` label-readable. floz traffic is 0
        // events, which is why it must be the consistent rule and not a judgement
        // call made under pressure from a number.
        mockedHydrateOff.mockResolvedValue(offHydrated({
            servingGrams: 45, servingDescription: '1 floz (45 g)', servingUnitCount: 1,
        }));
        expect(await bill({ qty: 1, unit: 'floz' }, '1 floz cereal')).toBe('volume_unit:30');
    });

    it('`ml` on a record labelled "250 ml" still bills the flat ml pin, label or no label', async () => {
        // What parseOffServingSize() actually produces for a "250 ml" label:
        // leadingCount("250 ml") = 250, so perLabelUnitGrams = 250/250 = 1 g/ml.
        mockedHydrateOff.mockResolvedValue(offHydrated({
            servingGrams: 250, servingDescription: '250 ml', servingUnitCount: 250,
        }));
        expect(await bill({ qty: 250, unit: 'ml' }, '250 ml cereal')).toBe('volume_unit:250');
    });

    it('`dash` and `pinch` are ABSOLUTE cells (0.6 g / 0.3 g), not densities — unchanged', async () => {
        mockedHydrateOff.mockResolvedValue(offHydrated({
            servingGrams: 5, servingDescription: '1 dash (5 g)', servingUnitCount: 1,
        }));
        expect(await bill({ qty: 1, unit: 'dash' }, '1 dash cereal')).toBe('volume_unit:0.6');

        mockedHydrateOff.mockResolvedValue(offHydrated({
            servingGrams: 5, servingDescription: '1 pinch (5 g)', servingUnitCount: 1,
        }));
        expect(await bill({ qty: 1, unit: 'pinch' }, '1 pinch cereal')).toBe('volume_unit:0.3');
    });
});

// ------------------------------------------------------------------
// 7. THE CONTROL THAT MATTERS MOST — nothing a BARE request resolves to moves
// ------------------------------------------------------------------
describe('7. `labelUnitWord`\'s four other consumers are untouched', () => {
    /**
     * `labelUnitWord` also feeds `usableBareLabelServing()` (bare_label_serving /
     * bare_plural_serving) and the label-count-derived per-piece branch. None of
     * them can be reached by the new branch: `isBareUnitlessQty1()` returns false
     * the moment `parsed.unit` is truthy (`bare-query-guard.ts:113`), and the
     * per-piece branches sit inside `else if (!unit && ...)`. The new branch
     * additionally re-tests `volumeToGrams[unit]`, so it requires a unit twice
     * over. These assertions are that argument, executed.
     *
     * Every expectation here is the value MASTER produces, pinned before the fix
     * was written.
     */
    it('a BARE request on a cup-labelled record is unchanged (bare_label_serving)', async () => {
        mockedHydrateOff.mockResolvedValue(offHydrated({
            servingGrams: 30, servingDescription: '1 cup (30 g)', servingUnitCount: 1,
        }));
        expect(await bill({ qty: 1, unit: undefined }, 'cereal')).toBe('bare_label_serving:30');
    });

    it('a BARE PLURAL request on a cup-labelled record is unchanged (bare_plural_serving)', async () => {
        mockedHydrateOff.mockResolvedValue(offHydrated({
            foodName: 'Crunchy Puffed Flakes', servingGrams: 30,
            servingDescription: '1 cup (30 g)', servingUnitCount: 1,
        }));
        const r = await buildOffResult(
            offCandidate('Crunchy Puffed Flakes'),
            parsed({ qty: 1, unit: undefined, name: 'flakes' }), 0.9, 'flakes',
        );
        expect(`${r?.servingTier}:${r?.grams}`).toBe('bare_plural_serving:30');
    });

    it('a unitless COUNT on a cup-labelled record is unchanged (no volume unit in play)', async () => {
        mockedHydrateOff.mockResolvedValue(offHydrated({
            servingGrams: 30, servingDescription: '1 cup (30 g)', servingUnitCount: 1,
        }));
        expect(await bill({ qty: 3, unit: undefined }, '3 cereal')).toBe('label_serving_default:90');
    });

    it('a NON-volume label_unit_match still fires on the ORIGINAL branch ("2 scoops (46g)" -> 23 g)', async () => {
        mockedHydrateOff.mockResolvedValue(offHydrated({
            servingGrams: 46, servingDescription: '2 scoops (46 g)', servingUnitCount: 2,
        }));
        expect(await bill({ qty: 1, unit: 'scoop' }, '1 scoop cereal')).toBe('label_unit_match:23');
    });

    it('a WEIGHT unit still pre-empts everything (weight_unit is the first branch)', async () => {
        mockedHydrateOff.mockResolvedValue(offHydrated({
            servingGrams: 30, servingDescription: '1 cup (30 g)', servingUnitCount: 1,
        }));
        expect(await bill({ qty: 100, unit: 'g' }, '100 g cereal')).toBe('weight_unit:100');
    });
});

// ------------------------------------------------------------------
// 8. THE WIRE FIELD — portionProvenance goes from 'borrowed' to ABSENT
// ------------------------------------------------------------------
/**
 * A DECISION, not a side effect. Moving a line from `volume_unit` to
 * `label_unit_match` also moves what `/api/nlp/parse` puts on the wire for it,
 * because `portionProvenanceForTier()` is derived from the tier — and
 * `PortionProvenance` is `'borrowed' | 'floor'`, with NO `'own'` member.
 * `volume_unit` is in `BORROWED_OR_DEFAULTED_SERVING_TIERS`; `label_unit_match`
 * is in none of the five class lists. So the field goes from `'borrowed'` to
 * ABSENT on 4.3% of serving-tier traffic, and the mobile badge that reads it
 * stops badging those lines.
 *
 * ABSENT IS THE CORRECT VALUE, and this is the argument:
 *
 *   1. The field is a WARNING, not a provenance enum — its two members are
 *      "borrowed from another record" and "fabricated floor". The route spreads
 *      it `...(p ? { portionProvenance: p } : {})` and its own comment at
 *      `route.ts:567-568` says the field is "omitted (never null) when the tier
 *      is in neither list, so every honest row stays byte-identical on the
 *      wire." A line billed from the record's OWN label, in the very unit the
 *      user asked for, is the definition of an honest row.
 *   2. It is NOT A NEW WIRE STATE. `label_unit_match` already ships with the
 *      field absent today, for every non-volume label ("1 scoop" on a
 *      "2 scoops (46g)" tub). This lane routes more lines onto a tier whose
 *      provenance was already settled and tested; it invents nothing.
 *   3. The direction is strictly honest: lines stop claiming 'borrowed' when
 *      they are not borrowed. A line that KEEPS the constant keeps 'borrowed',
 *      which is still true of it.
 *
 * `route.portion-provenance.test.ts` mocks the tier directly, so it cannot see
 * this move. These assertions drive the REAL branch and feed its actual tier to
 * the real derivation, which is the only way the move is observable in jest.
 */
describe('8. portionProvenance: the moved lines stop claiming borrowed', () => {
    /** The route's own emit shape, `route.ts:571`. */
    const wire = (tier: string | undefined) => {
        const p = portionProvenanceForTier(tier);
        return { foodName: 'x', ...(p ? { portionProvenance: p } : {}) } as Record<string, unknown>;
    };

    it('the derivation itself: volume_unit -> borrowed, label_unit_match -> undefined', () => {
        expect(portionProvenanceForTier('volume_unit')).toBe('borrowed');
        expect(portionProvenanceForTier('label_unit_match')).toBeUndefined();
        // There is no 'own' member to move to — the absence IS the value.
        expect(portionProvenanceForTier('label_unit_match')).not.toBe('own');
    });

    it('a MOVED line ships no portionProvenance key at all (not null, not undefined — absent)', async () => {
        mockedHydrateOff.mockResolvedValue(offHydrated({
            servingGrams: 30, servingDescription: '1 cup (30 g)', servingUnitCount: 1,
        }));
        const r = await buildOffResult(offCandidate(), parsed({ qty: 1, unit: 'cup' }), 0.9, '1 cup cereal');
        expect(r?.servingTier).toBe('label_unit_match');
        expect(Object.prototype.hasOwnProperty.call(wire(r?.servingTier), 'portionProvenance')).toBe(false);
    });

    it('a line the band REFUSED keeps portionProvenance borrowed — it really is a class default', async () => {
        mockedHydrateOff.mockResolvedValue(offHydrated({
            servingGrams: 500, servingDescription: '1 cup (500 g)', servingUnitCount: 1,
        }));
        const r = await buildOffResult(offCandidate(), parsed({ qty: 1, unit: 'cup' }), 0.9, '1 cup cereal');
        expect(r?.servingTier).toBe('volume_unit');
        expect(wire(r?.servingTier).portionProvenance).toBe('borrowed');
    });

    it('the non-volume label_unit_match already shipped the field absent — this lane invents no state', async () => {
        mockedHydrateOff.mockResolvedValue(offHydrated({
            servingGrams: 46, servingDescription: '2 scoops (46 g)', servingUnitCount: 2,
        }));
        const r = await buildOffResult(offCandidate(), parsed({ qty: 1, unit: 'scoop' }), 0.9, '1 scoop cereal');
        expect(r?.servingTier).toBe('label_unit_match');
        expect(Object.prototype.hasOwnProperty.call(wire(r?.servingTier), 'portionProvenance')).toBe(false);
    });
});
