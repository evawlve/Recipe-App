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
 * 4.3% of all serving-tier traffic; ALL of it OFF — the FDC arm of that tier has
 * never billed a live query).
 *
 * The file already states the opposing principle a few lines above, about
 * `PACKAGE_LIKE_UNITS`: *"Units where the product's own label serving IS the
 * thing the user asked for ... For these, trust servingGrams over estimation."*
 * Volume was never added to it, and no comment anywhere defended the order.
 *
 * WHAT CHANGED. ONE new `else if` inserted ahead of `volume_unit`. Zero existing
 * lines modified. The new branch re-tests `volumeToGrams[unit]` itself, so its
 * firing population is provably a SUBSET of what `volume_unit` billed before —
 * nothing that reached any other branch can reach this one.
 *
 * THE BAND. The new branch reuses `findOwnFdcVolumeServing()`'s density band
 * `[VOLUME_SERVING_MIN_DENSITY, VOLUME_SERVING_MAX_DENSITY]` = [0.1, 1.6] g/ml,
 * and REFUSES any unit with no millilitre cell (`ml`, `dash`, `pinch`). Block 5
 * below is the measurement that justifies reusing rather than inventing a band,
 * and blocks 3 and 6 are its negative controls.
 *
 * RED ON MASTER: blocks 1 and 2 (120 g / `volume_unit` where 30 g / 240 g /
 * `label_unit_match` is asserted). Blocks 3-7 are GREEN ON BOTH TREES — they are
 * the controls, and per the plan they matter more than the RED.
 */

import { buildOffResult, findOwnFdcVolumeServing } from '../map-ingredient-with-fallback';
import { hydrateOffCandidate } from '../../openfoodfacts/hydrate';
import { resolveVolumeGrams } from '../../units/volume-density';
import { categoryDensity, DRY_GRANULE_DENSITY_CATEGORIES } from '../../units/density';
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
// 4. THE BAND REFUSES A JUNK LABEL
// ------------------------------------------------------------------
describe('4. out-of-band labels are refused and fall to the constant', () => {
    it('"1 cup (500 g)" implies 2.08 g/ml — denser than any food — so the constant wins', async () => {
        mockedHydrateOff.mockResolvedValue(offHydrated({
            servingGrams: 500, servingDescription: '1 cup (500 g)', servingUnitCount: 1,
        }));
        expect(await bill({ qty: 1, unit: 'cup' }, '1 cup cereal')).toBe(`volume_unit:${CLASS_CONSTANT_CUP_G}`);
    });

    it('"1 cup (12 g)" implies 0.05 g/ml — lighter than puffed cereal — so the constant wins', async () => {
        mockedHydrateOff.mockResolvedValue(offHydrated({
            servingGrams: 12, servingDescription: '1 cup (12 g)', servingUnitCount: 1,
        }));
        expect(await bill({ qty: 1, unit: 'cup' }, '1 cup cereal')).toBe(`volume_unit:${CLASS_CONSTANT_CUP_G}`);
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
     * The band's job here is NOT to second-guess a plausible label — it is to
     * refuse a label the estimator's OWN physics could never have produced.
     * `resolveVolumeGrams()` emits exactly four shapes of cup cell:
     *   pourable (liquid | beverage)  240 g   -> 1.0000 g/ml
     *   paste                         250 g   -> 1.0417 g/ml
     *   solid, flat default           120 g   -> 0.5000 g/ml
     *   solid, dry-granule category   240 x categoryDensity(c)
     *                                         -> {oats .36 ... sugar .85}
     * so the whole reachable range is [0.36, 1.0417] g/ml. [0.1, 1.6] brackets
     * that with 3.6x of slack below and 1.54x above. A label the band refuses is
     * therefore MORE extreme than anything the constant it is replacing could
     * ever say — which is the only condition under which "the record is wrong
     * and the class guess is better" can be asserted without a corpus read.
     *
     * (A live-corpus read of the actual OFF label density distribution was
     * attempted and refused by this session's permission classifier — see the
     * PR body. This is the argument that stands in for it, and unlike prose it
     * goes RED if a future constants PR pushes a class density past the band.)
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
// 6. UNITS WITH NO MILLILITRE CELL ARE REFUSED — the ml / dash / pinch guard
// ------------------------------------------------------------------
describe('6. a unit with no millilitre cell cannot be banded, so it keeps the constant', () => {
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
