/**
 * Bare-serving defaults (Track 3, Jul 2026) — buildOffResult resolution order
 * for digitless unitless qty-1 requests ("the unitless qty-1 class", 82
 * confirmed triage rows 2026-07-21):
 *   (1) the record's OWN in-band label serving  → 'bare_label_serving'
 *   (2) count-noun piece when the NAME implies one (seed / discrete backfill)
 *   (3) same-brand sibling median label serving → 'bare_sibling_serving'
 *   (4) bounded floor — never flat-100g for a discrete-piece name
 *
 * Representative triage rows exercised here: combos cheddar pretzel (label
 * over per-piece divide), yoplait original strawberry (label over seed piece),
 * pepper jack (head-gated CAP), snickers/barebells (placeholder-100 → sibling
 * median), kirkland protein bar (discrete backfill), sun chips (label over
 * count-label divide).
 */

import { buildOffResult, isTightNameGroup } from '../map-ingredient-with-fallback';
import { hydrateOffCandidate } from '../../openfoodfacts/hydrate';
import { getOrCreateAmbiguousServing } from '../ambiguous-unit-backfill';
import { prisma } from '../../db';
import type { ParsedIngredient } from '../../parse/ingredient-line';

jest.mock('../../db', () => ({
    prisma: {
        $queryRaw: jest.fn().mockResolvedValue([]),
        fdcFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        offFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        aiGeneratedFood: {
            findMany: jest.fn().mockResolvedValue([]),
            findFirst: jest.fn().mockResolvedValue(null),
            findUnique: jest.fn().mockResolvedValue(null),
        },
        foodMapping: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    },
}));

jest.mock('../../openfoodfacts/hydrate', () => ({
    hydrateOffCandidate: jest.fn(),
}));

jest.mock('../ambiguous-unit-backfill', () => {
    const actual = jest.requireActual('../ambiguous-unit-backfill');
    return {
        ...actual,
        getOrCreateAmbiguousServing: jest.fn(),
    };
});

function makeCandidate(name: string) {
    return {
        id: 'off_100',
        source: 'openfoodfacts' as const,
        name,
        score: 1,
        foodType: 'generic',
        rawData: {},
    } as any;
}

function makeHydrated(overrides: Record<string, unknown>) {
    return {
        foodId: 'off_100',
        foodName: 'Food',
        brandName: null,
        nutrientsPer100g: { calories: 400, protein: 10, carbs: 50, fat: 15 },
        servingGrams: null,
        servingDescription: null,
        servingUnitCount: 1,
        packageQuantity: null,
        packageQuantityUnit: null,
        ...overrides,
    };
}

function bareParsed(name: string, qty = 1): ParsedIngredient {
    return { qty, multiplier: 1, unit: null, name };
}

const mockedQueryRaw = prisma.$queryRaw as jest.Mock;

/**
 * `prisma.$queryRaw` is a TAGGED TEMPLATE — argument 0 is the template-strings
 * array, not a SQL string. Both sibling borrows go through this one mock:
 * `borrowSiblingLabelServing` (brand-keyed) and `borrowNameSiblingLabelServing`
 * (name-keyed, N1). Under a single `mockResolvedValue` the two stubs could
 * never differ, which makes every raise-only clamp assertion VACUOUS — the
 * clamp test would pass with the clamp deleted. Dispatch on the SQL text, and
 * record the shapes actually issued so a refactor that stops issuing one of
 * them cannot pass silently (T3).
 */
let brandSiblingRows: unknown[] = [];   // borrowSiblingLabelServing     ("brandName" ILIKE)
let nameSiblingRows: unknown[] = [];    // borrowNameSiblingLabelServing (lower(name) =)
let otherQueryRows: unknown[] = [];     // borrowSiblingPackageGrams, and anything else
const observedSql: string[] = [];

/** The pre-dispatch behaviour: every borrow saw the same rows. */
function setAllSiblingRows(rows: unknown[]) {
    brandSiblingRows = rows;
    otherQueryRows = rows;
}

beforeEach(() => {
    jest.clearAllMocks();
    brandSiblingRows = [];
    nameSiblingRows = [];
    otherQueryRows = [];
    observedSql.length = 0;
    mockedQueryRaw.mockImplementation((strings: TemplateStringsArray) => {
        const sql = Array.isArray(strings) ? strings.join('?') : String(strings);
        observedSql.push(sql);
        if (sql.includes('"brandName" ILIKE')) return Promise.resolve(brandSiblingRows);
        if (sql.includes('lower(name) =')) return Promise.resolve(nameSiblingRows);
        return Promise.resolve(otherQueryRows);
    });
    (getOrCreateAmbiguousServing as jest.Mock).mockResolvedValue({ status: 'error', error: 'not mocked' });
});

describe('step (1) — own in-band label serving wins for bare requests', () => {
    it("bills the full label serving, not the per-piece divide ('combos cheddar pretzel' 28g label ÷ 9 pieces)", async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Combos Cheddar Pretzel',
            brandName: 'Combos',
            servingGrams: 28,
            servingDescription: '9 piece (28 g)',
            servingUnitCount: 9,
        }));

        const result = await buildOffResult(
            makeCandidate('Combos Cheddar Pretzel'),
            bareParsed('combos cheddar pretzel'), 0.9, 'combos cheddar pretzel'
        );

        expect(result?.servingTier).toBe('bare_label_serving');
        expect(result?.grams).toBe(28);   // NOT 28/9 = 3.11
    });

    it("bills the label cup, not the strawberry seed piece ('yoplait original strawberry' 170g vs 12g)", async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Yoplait Original Strawberry',
            brandName: 'Yoplait',
            servingGrams: 170,
            servingDescription: '170 g',
        }));

        const result = await buildOffResult(
            makeCandidate('Yoplait Original Strawberry'),
            bareParsed('yoplait original strawberry'), 0.9, 'yoplait original strawberry'
        );

        expect(result?.servingTier).toBe('bare_label_serving');
        expect(result?.grams).toBe(170);
    });

    it("survives the contained-token spice cap ('pepper jack' 28g label, was capped to 2.5g)", async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Pepper Jack Cheese',
            servingGrams: 28,
            servingDescription: '3 SLICES (28 g)',
            servingUnitCount: 3,
        }));

        const result = await buildOffResult(
            makeCandidate('Pepper Jack Cheese'), bareParsed('pepper jack'), 0.9, 'pepper jack'
        );

        expect(result?.servingTier).toBe('bare_label_serving');
        expect(result?.grams).toBe(28);
    });

    it("bills the count-labeled serving whole, not one chip ('sun chips harvest cheddar' 28g vs 2g)", async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Sun Chips Harvest Cheddar',
            brandName: 'Sun Chips',
            servingGrams: 28,
            servingDescription: '14 chips (28 g)',
            servingUnitCount: 14,
        }));

        const result = await buildOffResult(
            makeCandidate('Sun Chips Harvest Cheddar'),
            bareParsed('sun chips harvest cheddar'), 0.9, 'sun chips harvest cheddar'
        );

        expect(result?.servingTier).toBe('bare_label_serving');
        expect(result?.grams).toBe(28);
    });

    it('explicit counts still use the per-piece divide ("3 sun chips" keeps label_count_derived)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Sun Chips Harvest Cheddar',
            servingGrams: 28,
            servingDescription: '14 chips (28 g)',
            servingUnitCount: 14,
        }));

        const result = await buildOffResult(
            makeCandidate('Sun Chips Harvest Cheddar'),
            bareParsed('sun chips', 3), 0.9, '3 sun chips'
        );

        expect(result?.servingTier).toBe('label_count_derived');
        expect(result?.grams).toBe(6);   // 3 × 2g per chip
    });
});

describe('step (3) — same-brand sibling median for placeholder/garbage labels', () => {
    it("resolves the placeholder-100 snickers SKU from 148 sibling bars (~39.8g)", async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Snickers',
            brandName: 'Snickers',
            servingGrams: 100,
            servingDescription: '1 portion (100 g)',
        }));
        setAllSiblingRows([{ med: 39.8, n: 148 }]);

        const result = await buildOffResult(
            makeCandidate('Snickers'), bareParsed('snickers'), 0.9, 'snickers'
        );

        expect(result?.servingTier).toBe('bare_sibling_serving');
        expect(result?.grams).toBe(39.8);
    });

    it("resolves 'barebells caramel cashew' to the 55g brand median, not the 1.5g cashew seed", async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Caramel Cashew',
            brandName: 'Barebells',
            servingGrams: 100,
            servingDescription: '100 g',
        }));
        setAllSiblingRows([{ med: 55, n: 200 }]);

        const result = await buildOffResult(
            makeCandidate('Caramel Cashew'),
            bareParsed('barebells caramel cashew'), 0.9, 'barebells caramel cashew'
        );

        expect(result?.servingTier).toBe('bare_sibling_serving');
        expect(result?.grams).toBe(55);
    });

    it('rejects garbage sub-3g label metadata and borrows the sibling median (hot-pocket "1.0g" class)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Ham & Cheese Hot Pocket',
            brandName: 'Hot Pockets',
            servingGrams: 1,
            servingDescription: '1.0g',
        }));
        setAllSiblingRows([{ med: 127, n: 12 }]);

        const result = await buildOffResult(
            makeCandidate('Ham & Cheese Hot Pocket'),
            bareParsed('hot pocket ham and cheese'), 0.9, 'hot pocket ham and cheese'
        );

        expect(result?.servingTier).toBe('bare_sibling_serving');
        expect(result?.grams).toBe(127);
    });

    it('fewer than 3 siblings → falls through to the label default + legacy CAP (butter chicken)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Butter Chicken',
            brandName: 'Golden Chicken',
            servingGrams: 100,
            servingDescription: '1 portion (100 g)',
        }));
        setAllSiblingRows([{ med: 55, n: 2 }]);

        const result = await buildOffResult(
            makeCandidate('Butter Chicken'), bareParsed('butter chicken'), 0.9, 'butter chicken'
        );

        // Sibling borrow refused (n < 3) → label_serving_default 100g → the
        // legacy containment CAP ('butter' token) shrinks it to 14g. This
        // documents the PRE-EXISTING tail defect (triage row: butter chicken
        // 14g): fixing it requires >=3 brand siblings, which routes through
        // the untouched bare_sibling_serving tier instead.
        expect(result?.servingTier).toBe('bare_category_default');
        expect(result?.grams).toBe(14);
    });

    it('digit lines never take the bare path ("1 gatorade" keeps the package bill)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Gatorade Thirst Quencher',
            brandName: 'Gatorade',
            servingGrams: null,
            packageQuantity: 591,
            packageQuantityUnit: 'ml',
        }));
        setAllSiblingRows([{ med: 355, n: 190 }]);

        const result = await buildOffResult(
            makeCandidate('Gatorade Thirst Quencher'), bareParsed('gatorade'), 0.9, '1 gatorade'
        );

        expect(result?.servingTier).toBe('package_count_own');
        expect(result?.grams).toBe(591);
    });

    it('bare beverage with an own ml package keeps drink-the-unit semantics (digitless "gatorade")', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Gatorade Thirst Quencher',
            brandName: 'Gatorade',
            servingGrams: null,
            packageQuantity: 591,
            packageQuantityUnit: 'ml',
        }));
        setAllSiblingRows([{ med: 355, n: 190 }]);

        const result = await buildOffResult(
            makeCandidate('Gatorade Thirst Quencher'), bareParsed('gatorade'), 0.9, 'gatorade'
        );

        expect(result?.servingTier).toBe('package_count_own');
        expect(result?.grams).toBe(591);
    });
});

describe('step (2) — count-noun piece resolution for bare requests', () => {
    it("routes 'kirkland protein bar chocolate chip' through the discrete 'bar' backfill with brandForBorrow", async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Protein Bar Chocolate Chip Cookie Dough',
            brandName: 'Kirkland Signature',
            servingGrams: null,
        }));
        (getOrCreateAmbiguousServing as jest.Mock).mockResolvedValue({ status: 'success', grams: 60 });

        const result = await buildOffResult(
            makeCandidate('Protein Bar Chocolate Chip Cookie Dough'),
            bareParsed('kirkland protein bar chocolate chip'), 0.9, 'kirkland protein bar chocolate chip'
        );

        expect(result?.servingTier).toBe('discrete_unit_backfill');
        expect(result?.grams).toBe(60);
        expect(getOrCreateAmbiguousServing).toHaveBeenCalledWith(
            'off_100', 'Protein Bar Chocolate Chip Cookie Dough', 'bar', 'Kirkland Signature'
        );
    });

    it('runs the discrete backfill even when the label is a placeholder (bare request, 100g flat)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Barebells Protein Bar Caramel Cashew',
            brandName: 'Barebells',
            servingGrams: 100,
            servingDescription: '100 g',
        }));
        (getOrCreateAmbiguousServing as jest.Mock).mockResolvedValue({ status: 'success', grams: 55 });

        const result = await buildOffResult(
            makeCandidate('Barebells Protein Bar Caramel Cashew'),
            bareParsed('barebells protein bar'), 0.9, 'barebells protein bar'
        );

        expect(result?.servingTier).toBe('discrete_unit_backfill');
        expect(result?.grams).toBe(55);
    });

    it("skips a tiny per-piece seed on a bare singular (bare 'almond' → lexicon 28g, not the 1.2g nut)", async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Almond',
            servingGrams: null,
        }));

        const result = await buildOffResult(
            makeCandidate('Almond'), bareParsed('almond'), 0.9, 'almond'
        );

        expect(result?.servingTier).toBe('bare_category_default');
        expect(result?.grams).toBe(28);
    });

    it("keeps a piece-sized seed on a bare singular ('banana' 118g — the piece IS the serving)", async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Banana',
            servingGrams: null,
        }));

        const result = await buildOffResult(
            makeCandidate('Banana'), bareParsed('banana'), 0.9, 'banana'
        );

        expect(result?.servingTier).toBe('seed_count_default');
        expect(result?.grams).toBe(118);
    });

    it('explicit counts keep tiny per-piece seeds ("3 almonds" → 3.6g)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Almonds',
            servingGrams: null,
        }));

        const result = await buildOffResult(
            makeCandidate('Almonds'), bareParsed('almonds', 3), 0.9, '3 almonds'
        );

        expect(result?.servingTier).toBe('seed_count_default');
        expect(result?.grams).toBeCloseTo(3.6, 1);
    });
});

describe('dose-anchored categories — own-label/sibling steps must NOT outrank the tsp/scoop default', () => {
    it('n-serv-37: bare "sugar" ignores a cup-measure label and lands on the 4g tsp default', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Granulated White Sugar',
            brandName: 'Domino',
            servingGrams: 104,
            servingDescription: '0.5 cup (104 g)',
        }));
        // Even a plausible sibling median must not answer either.
        setAllSiblingRows([{ med: 104, n: 12 }]);

        const result = await buildOffResult(
            makeCandidate('Granulated White Sugar'), bareParsed('sugar'), 0.9, 'sugar'
        );

        expect(result?.servingTier).toBe('bare_category_default');
        expect(result?.grams).toBe(4);
    });

    it('n-serv-37 variant: label-less sugar record skips the sibling median too', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Granulated White Sugar',
            brandName: 'Domino',
            servingGrams: null,
        }));
        setAllSiblingRows([{ med: 104, n: 12 }]);

        const result = await buildOffResult(
            makeCandidate('Granulated White Sugar'), bareParsed('sugar'), 0.9, 'sugar'
        );

        // count_unresolved_floor → REPLACE via the sugars lexicon entry.
        expect(result?.servingTier).toBe('bare_category_default');
        expect(result?.grams).toBe(4);
    });

    it('n-serv-43: bare "ghost pre workout" skips the 32.5g two-scoop sibling median → 12g scoop default', async () => {
        // Live shape: off_0810028296060 has NULL servingGrams/servingSize;
        // 147 Ghost siblings (protein tubs) median exactly 32.5g — which the
        // eval caught billing as bare_sibling_serving.
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Ghost Legend Pre Workout Cherry Limeade',
            brandName: 'Ghost',
            servingGrams: null,
        }));
        setAllSiblingRows([{ med: 32.5, n: 147 }]);

        const result = await buildOffResult(
            makeCandidate('Ghost Legend Pre Workout Cherry Limeade'),
            bareParsed('ghost pre workout'), 0.9, 'ghost pre workout'
        );

        expect(result?.servingTier).toBe('bare_category_default');
        expect(result?.grams).toBe(12);
    });

    it('dose category with an in-band package tier still resolves through the CAP (ghost 473g tub → 12g)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Ghost Legend Pre Workout',
            brandName: 'Ghost',
            servingGrams: null,
            packageQuantity: 473,
            packageQuantityUnit: 'ml',
        }));

        const result = await buildOffResult(
            makeCandidate('Ghost Legend Pre Workout'),
            bareParsed('ghost pre workout'), 0.9, 'ghost pre workout'
        );

        expect(result?.servingTier).toBe('bare_category_default');
        expect(result?.grams).toBe(12);
    });
});

describe('step (4) — bounded discrete floor, never flat-100g for piece names', () => {
    it('bills one ~50g bar when nothing else resolves (no brand, no label, backfill error)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            // Two-char first token keeps brandForBorrow null → no sibling borrow.
            foodName: 'IQ Protein Bar Birthday Cake',
            brandName: null,
            servingGrams: null,
        }));
        (getOrCreateAmbiguousServing as jest.Mock).mockResolvedValue({ status: 'error', error: 'ai down' });

        const result = await buildOffResult(
            makeCandidate('IQ Protein Bar Birthday Cake'),
            bareParsed('protein bar birthday cake'), 0.9, 'protein bar birthday cake'
        );

        expect(result?.servingTier).toBe('bare_discrete_floor');
        expect(result?.grams).toBe(50);
    });
});

/**
 * (E) NAME-GROUP SIBLING MEDIAN — N1, item #16, Aug 2026.
 *
 * The rung sits BELOW applyOffBareQueryGuard and is gated on the surviving
 * fabricated tier ('count_unresolved_floor'), so the category lexicon, every
 * package/label tier and rung (C2)'s brand borrow all keep precedence. Only the
 * UPWARD half of the name-group mixture ships: a name group is a mixture
 * (asparagus 85 g, blueberries 62.5 g — dried/freeze-dried products dominate)
 * and the downward half is worse than the 100 g floor it would replace.
 */
describe('step (E) — name-group sibling median, raise-only', () => {
    it('raise-only: a below-floor name median is refused (asparagus 85 g does not beat the 100 g floor)', async () => {
        // 'asparagus' ends in -us, so isMorphologicalPluralToken excludes it and
        // the line genuinely REACHES this rung. A plural fixture (blueberries)
        // would be stopped by the bare-plural gate and pass for the wrong reason.
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Asparagus',
            brandName: null,
            servingGrams: null,
            nutrientsPer100g: { calories: 20, protein: 2.2, carbs: 3.9, fat: 0.1 },
        }));
        setAllSiblingRows([]);
        // A genuine MIXTURE, which is the population the clamp was justified on:
        // fresh spears sit near 85 g and dried/freeze-dried packs near 20-30 g,
        // so p75/p25 = 200/40 = 5.0 and the group median is not a serving size.
        nameSiblingRows = [{ med: 85, n: 25, p25: 40, p75: 200 }];

        const result = await buildOffResult(
            makeCandidate('Asparagus'), bareParsed('asparagus'), 0.9, 'asparagus'
        );

        // MUTATION TEST: deleting `&& nameSib.grams > grams` from the (E) rung
        // makes this fail with 'bare_name_sibling_serving' / 85. Deleting the
        // `isTightNameGroup(...)` conjunct from `lowersIntoTightGroup` fails it
        // with 'bare_name_sibling_serving_tight' / 85.
        expect(result?.servingTier).toBe('count_unresolved_floor');
        expect(result?.grams).toBe(100);
    });

    it('TIGHT group lowers below the floor (mature cheddar 100 → 30 g, n=17 all 30)', async () => {
        // Real corpus group, measured 2026-08-05: 17 in-band siblings named
        // 'Mature cheddar', every one declaring 30 g, so p75/p25 = 1.00. This is
        // a conventional label serving repeated across near-identical SKUs, not
        // a mixture — the 100 g floor is a bare literal outranking it.
        //
        // SINGULAR on purpose. 'Broccoli florets' is the more vivid uniform
        // group (n=130, all 85 g) but it is bare-PLURAL, so rung (E) never runs
        // for it and the fixture would prove nothing about this clamp. The two
        // blockers partition the residual: 15 raise-blocked, 13 plural-blocked.
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Mature cheddar',
            brandName: null,
            servingGrams: null,
            nutrientsPer100g: { calories: 416, protein: 25.4, carbs: 0.1, fat: 34.9 },
        }));
        setAllSiblingRows([]);
        nameSiblingRows = [{ med: 30, n: 17, p25: 30, p75: 30 }];

        const result = await buildOffResult(
            makeCandidate('Mature cheddar'), bareParsed('mature cheddar'), 0.9, 'mature cheddar'
        );

        // MUTATION TEST: restoring the raise-only clamp (dropping the
        // `|| lowersIntoTightGroup` disjunct) fails this with
        // 'count_unresolved_floor' / 100.
        expect(result?.servingTier).toBe('bare_name_sibling_serving_tight');
        expect(result?.grams).toBe(30);
    });

    it('a TIGHT bare-PLURAL group lowers, on its own tier (broccoli florets 100 → 85 g, n=130)', async () => {
        // Real corpus group, measured 2026-08-05: n=130 in-band siblings named
        // 'Broccoli florets', every one declaring 85 g (1 cup), ratio 1.00 — the
        // most uniform group in the whole residual population.
        //
        // This test previously asserted the OPPOSITE, as a deliberate pin that
        // #252's tight relaxation had not widened the plural gate. Widening it is
        // this change, and the pin is inverted rather than deleted so the flip is
        // visible in history.
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Broccoli florets',
            brandName: null,
            servingGrams: null,
            nutrientsPer100g: { calories: 34, protein: 2.8, carbs: 6.6, fat: 0.4 },
        }));
        setAllSiblingRows([]);
        nameSiblingRows = [{ med: 85, n: 130, p25: 85, p75: 85 }];

        const result = await buildOffResult(
            makeCandidate('Broccoli florets'), bareParsed('broccoli florets'), 0.9, 'broccoli florets'
        );

        // MUTATION TEST: restoring `&& !isBarePluralRequest(...)` to the (E)
        // condition fails this with 'count_unresolved_floor' / 100. Stamping the
        // singular '_tight' tier instead of '_plural' fails it too — the arms
        // must stay separately countable.
        expect(result?.servingTier).toBe('bare_name_sibling_serving_plural');
        expect(result?.grams).toBe(85);
    });

    it('a DISPERSED bare-PLURAL group is still refused (roasted red peppers, ratio 4.33)', async () => {
        // The other half of the plural population, and the reason the relaxation
        // is tight-gated rather than a plain gate removal. Real corpus group,
        // measured 2026-08-05: n=13, median 45 g, p25 30 / p75 130 — jarred
        // whole peppers against sliced portions, exactly the MIXTURE shape.
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Roasted red peppers',
            brandName: null,
            servingGrams: null,
            nutrientsPer100g: { calories: 27, protein: 1.1, carbs: 5.4, fat: 0.2 },
        }));
        setAllSiblingRows([]);
        nameSiblingRows = [{ med: 45, n: 13, p25: 30, p75: 130 }];

        const result = await buildOffResult(
            makeCandidate('Roasted red peppers'), bareParsed('roasted red peppers'), 0.9, 'roasted red peppers'
        );

        // MUTATION TEST: dropping the plural arm's `tightGroup` requirement — the
        // naive "just delete the plural gate" change — fails this with
        // 'bare_name_sibling_serving_plural' / 45.
        expect(result?.servingTier).toBe('count_unresolved_floor');
        expect(result?.grams).toBe(100);
    });

    it('a TIGHT bare-PLURAL group also RAISES (cod fillets 100 → 113 g, ratio 1.01)', async () => {
        // The plural arm is direction-free: tightness alone admits. Real corpus
        // group, measured 2026-08-05: n=22, median 113 g (4 oz), p25 112 / p75
        // 113. Only 2 of the 7 tight plural repairs are raises, which is why
        // DIRECTION was the wrong axis to gate this on — a raise-only plural rule
        // would have repaired 2 and admitted 3 mixtures.
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Cod fillets',
            brandName: null,
            servingGrams: null,
            nutrientsPer100g: { calories: 82, protein: 17.8, carbs: 0, fat: 0.7 },
        }));
        setAllSiblingRows([]);
        nameSiblingRows = [{ med: 113, n: 22, p25: 112, p75: 113 }];

        const result = await buildOffResult(
            makeCandidate('Cod fillets'), bareParsed('cod fillets'), 0.9, 'cod fillets'
        );

        expect(result?.servingTier).toBe('bare_name_sibling_serving_plural');
        expect(result?.grams).toBe(113);
    });

    it('the SEPARATE tier is keyed on DIRECTION, not on tightness (a tight RAISE stays the original tier)', async () => {
        // Without this the two axes are confounded and a tier-keyed instrument
        // reading `_tight` would silently be reading "was measured tight", not
        // "billed below the floor". 'Big Mac' is tight AND raises.
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Big Mac',
            brandName: null,
            servingGrams: null,
        }));
        setAllSiblingRows([]);
        nameSiblingRows = [{ med: 232, n: 3, p25: 220, p75: 240 }];

        const result = await buildOffResult(
            makeCandidate('Big Mac'), bareParsed('big mac'), 0.9, 'big mac'
        );

        expect(result?.servingTier).toBe('bare_name_sibling_serving');
        expect(result?.grams).toBe(232);
    });

    it('a NULL p25/p75 never reads as tight (fail-closed on absent dispersion)', async () => {
        // The borrow coalesces NULLs to p25=0 / p75=Infinity precisely so a
        // missing aggregate cannot be mistaken for a uniform group. A fixture
        // that simply omits the columns is the shape an older cached/mocked row
        // has, and it must decline rather than lower.
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Asparagus',
            brandName: null,
            servingGrams: null,
        }));
        setAllSiblingRows([]);
        nameSiblingRows = [{ med: 85, n: 25, p25: null, p75: null }];

        const result = await buildOffResult(
            makeCandidate('Asparagus'), bareParsed('asparagus'), 0.9, 'asparagus'
        );

        // MUTATION TEST: coalescing a missing percentile to `row.med` — the
        // "helpful" refactor, which makes every NULL group read as p25 == p75
        // and therefore perfectly tight — fails this with 30 g.
        //
        // Swapping the 0/Infinity sentinels for each other does NOT fail it, and
        // that was checked rather than assumed: the ratio arithmetic already
        // fails closed for every NULL combination, so the sentinel choice is
        // unobservable here. This is a REGRESSION PIN on the outcome, not a
        // guard test for those two literals.
        expect(result?.servingTier).toBe('count_unresolved_floor');
        expect(result?.grams).toBe(100);
    });

    it('name-group median raises the fabricated floor (big mac 100 → 232 g at n=3)', async () => {
        // brandForBorrow is the food name's first token gated at length >= 4, so
        // 'Big' is null and rung (C2) is structurally unreachable here — which is
        // exactly why the plan's flagship line needs a NAME-keyed borrow.
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Big Mac',
            brandName: null,
            servingGrams: null,
        }));
        setAllSiblingRows([]);
        nameSiblingRows = [{ med: 232, n: 3, p25: 220, p75: 240 }];

        const result = await buildOffResult(
            makeCandidate('Big Mac'), bareParsed('big mac'), 0.9, 'big mac'
        );

        // n=3 pins the minimum as well: 'a big mac' sits at exactly n=3 live, so
        // raising the borrow to n>=5 turns this red.
        expect(result?.servingTier).toBe('bare_name_sibling_serving');
        expect(result?.grams).toBe(232);
    });

    it('issues both the brand-keyed and the name-keyed sibling query', async () => {
        // Instrument tripwire: without it, a refactor that stops issuing the
        // name-keyed query makes the raise-only test above pass vacuously.
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Asparagus',
            brandName: null,
            servingGrams: null,
        }));
        setAllSiblingRows([]);
        nameSiblingRows = [{ med: 85, n: 25 }];

        await buildOffResult(
            makeCandidate('Asparagus'), bareParsed('asparagus'), 0.9, 'asparagus'
        );

        expect(observedSql.some(s => s.includes('"brandName" ILIKE'))).toBe(true);
        expect(observedSql.some(s => s.includes('lower(name) ='))).toBe(true);
    });

    it('the category lexicon still wins over a name median (coca cola stays 355 g)', async () => {
        // GUARD-PRECEDENCE PIN — this encodes the entire narrowing. Moving the
        // rung up to (C2) turns it red: 'bare_sibling_serving' is guard-exempt,
        // so a borrow there pre-empts bare_category_default and this bills 275.
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Coca Cola',
            brandName: null,
            servingGrams: null,
        }));
        setAllSiblingRows([]);
        nameSiblingRows = [{ med: 275, n: 6 }];

        const result = await buildOffResult(
            makeCandidate('Coca Cola'), bareParsed('coca cola'), 0.9, 'coca cola'
        );

        expect(result?.servingTier).toBe('bare_category_default');
        expect(result?.grams).toBe(355);
    });
});

/**
 * The dispersion predicate on its own. Every ratio below is a real name group
 * measured over `OffFood` on 2026-08-05 (the 28-row #18 residual), so the
 * boundary is pinned by the corpus rather than by invented numbers.
 */
describe('isTightNameGroup', () => {
    it.each([
        ['Broccoli florets — 130 rows all 85 g', 85, 85, true],
        ['Mature cheddar — 17 rows all 30 g', 30, 30, true],
        ['Chicken tenderloins — 112/113.4', 112, 113.4, true],
        ['Rotisserie chicken — 84/113, ratio 1.345', 84, 113, true],
        ['Albacore tuna — 75.75/113, ratio 1.492 (just inside)', 75.75, 113, true],
        ['Spaghetti and meatballs — 198.75/336, ratio 1.69', 198.75, 336, false],
        ['pasta — 56/115.5, ratio 2.06 (dry vs cooked)', 56, 115.5, false],
        ['hot chocolate — 15.5/33, ratio 2.13 (sachet vs mug)', 15.5, 33, false],
        ['Roasted red peppers — 30/130, ratio 4.33', 30, 130, false],
    ])('%s', (_label, p25, p75, expected) => {
        expect(isTightNameGroup(p25 as number, p75 as number)).toBe(expected);
    });

    it('the boundary is inclusive at exactly 1.5 and excludes just above it', () => {
        // MUTATION TEST: flipping `<=` to `<` fails the first of these.
        expect(isTightNameGroup(100, 150)).toBe(true);
        expect(isTightNameGroup(100, 150.01)).toBe(false);
    });

    it('degenerate inputs are never tight', () => {
        // p25 = 0 would make the ratio Infinity or NaN; Infinity is the borrow's
        // coalesce for a NULL p75. Each must decline, not divide.
        expect(isTightNameGroup(0, 0)).toBe(false);
        expect(isTightNameGroup(0, 85)).toBe(false);
        expect(isTightNameGroup(85, 0)).toBe(false);
        expect(isTightNameGroup(0, Number.POSITIVE_INFINITY)).toBe(false);
        expect(isTightNameGroup(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(false);
        expect(isTightNameGroup(Number.NaN, 85)).toBe(false);
        expect(isTightNameGroup(-30, -20)).toBe(false);
    });

    it('an inverted pair is refused rather than silently reordered', () => {
        // p75 < p25 can only mean the aggregate was misread. Sorting the pair
        // here would turn a broken instrument into a plausible answer.
        expect(isTightNameGroup(113, 84)).toBe(false);
    });
});
