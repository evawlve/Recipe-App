/**
 * SIBLING-ORDER (s462): borrowSiblingServing() decides WHICH sibling rows it reads, so the
 * borrowed weight cannot depend on the order Postgres returns them in. The query used to end in
 * `LIMIT 50` with no ORDER BY over a parallel seq scan; six reads of the same request a few
 * seconds apart billed Nutri-Grain 24-36 g a bar (s462 pd-sibling).
 *
 * The two fixtures are real OffServing sibling sets, frozen read-only 2026-11-17:
 *   GHOST  — Ghost scoop rows (72): 21 g pre-workout scoops and 32-44 g protein scoops.
 *   KELLOG — Kellogg's bar rows (106): 22 g treats bars and 37 g Nutri-Grain bars.
 * Row shape: [OffServing.id, grams, description, sibling kcal/100 g].
 */
import { getOrCreateAmbiguousServing, selectSiblingRows, SIBLING_BORROW_CAP } from '../ambiguous-unit-backfill';
import { prisma } from '../../db';

jest.mock('../../db', () => ({
    prisma: {
        $queryRaw: jest.fn().mockResolvedValue([]),
        offServing: {
            findUnique: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
            upsert: jest.fn().mockResolvedValue({}),
        },
        fdcServing: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
        aiGeneratedServing: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
        offFood: { findUnique: jest.fn().mockResolvedValue(null) },
    },
}));

jest.mock('../../ai/ambiguous-serving-estimator', () => {
    const actual = jest.requireActual('../../ai/ambiguous-serving-estimator');
    return {
        ...actual,
        estimateAmbiguousServing: jest.fn().mockResolvedValue({ status: 'error', error: 'ai must not run' }),
    };
});

type Fx = Array<[number, number, string, number | null]>;
const GHOST: Fx = [[3791663,35.0,"1 scoop (35 g)",343.0],[3795587,35.5,"1 rounded scoop (35.5 g)",394.4],[3800895,11.0,"1 scoop (11 g)",273.0],[3806896,11.0,"1 scoop (11 g)",272.7],[3807921,42.1,"1 scoop (42.1 g)",380.0],[3808322,41.5,"1 scoop (41.5 g)",385.5],[3809147,11.0,"1 scoop (11 g)",273.0],[3812953,39.0,"1 scoop (39 g)",385.0],[3815650,17.5,"2 scoop (17.5 g)",28.6],[3816104,32.5,"1 rounded scoop (32.5 g)",338.5],[3825088,4.75,"1 scoop (4.75 g)",105.3],[3825890,35.0,"1 scoop (35 g)",342.9],[3828898,34.5,"1 scoop (34.5 g)",376.8],[3837297,17.5,"2 scoops (17.5 g)",28.6],[3837788,9.5,"2 scoops (9.5 g)",52.6],[3857318,39.0,"1 scoop (39 g)",384.6],[3870773,44.5,"1 Rounded scoop (44.5 g)",382.0],[3881815,42.1,"1 rounded scoop (42.1 g)",380.0],[3896145,5.0,"1 scoop (5 g)",100.0],[3896697,12.0,"1.0 scoop (12.0 g)",250.0],[3905544,14.0,"1 scoop (14 g)",71.4],[3906846,5.0,"2 scoops (5 g)",100.0],[3910391,21.5,"1 scoop (21.5 g)",46.5],[3911732,14.5,"1 scoop (14.5 g)",34.5],[3915753,33.0,"1 scoop (33 g)",364.0],[3919197,21.0,"1 scoop (21 g)",23.8],[3926137,34.0,"1 scoop (34 g)",382.4],[3927451,16.5,"1 scoop (16.5 g)",30.3],[3930905,22.0,"1 scoop (22 g)",45.5],[3932633,22.0,"1 scoop (22 g)",45.5],[3933046,9.5,"2 scoops (9.5 g)",52.6],[3936764,5.25,"1 scoop (5.25 g)",95.2],[3937428,21.5,"1 scoop (21.5 g)",46.5],[3937886,22.0,"1 scoop (22 g)",68.2],[3943500,8.25,"1 scoops (8.25 g)",60.6],[3967399,23.0,"1 scoop (23 g)",21.7],[3972726,22.5,"1 scoop (22.5 g)",44.4],[3973948,21.5,"1 scoop (21.5 g)",23.3],[3974900,23.0,"1 scoop (23 g)",43.5],[3985380,13.5,"1 scoop (13.5 g)",74.1],[3987606,15.5,"1 scoop (15.5 g)",32.3],[3992219,12.5,"1 scoop (12.5 g)",40.0],[3999783,22.0,"1 scoop (22 g)",45.5],[4002203,34.0,"1 Scoop (34 g)",382.4],[4003237,22.0,"1 scoop (22 g)",45.5],[4011127,21.0,"1 scoop (21 g)",23.8],[4053467,8.25,"1 scoop (8.25 g)",60.6],[4059696,21.0,"1 scoop (21 g)",23.8],[4080097,21.5,"1 scoop (21.5 g)",46.5],[4092648,12.0,"1 scoop (12 g)",250.0],[4093117,21.0,"1 scoop (21 g)",23.8],[4095829,8.75,"1 scoop (8.75 g)",28.6],[4095831,16.5,"1 scoop (16.5 g)",30.3],[4109254,20.5,"1 scoop (20.5 g)",48.8],[4109715,21.0,"1 scoop (21 g)",47.6],[4125441,5.0,"1 scoops (5 g)",100.0],[4133334,21.5,"1 scoop (21.5 g)",23.3],[4144240,37.0,"1 Rounded Scoop (37 g)",378.4],[4167754,31.5,"1 scoop (31.5 g)",381.0],[4172560,61.5,"2 scoops (61.5 g)",357.7],[4172655,12.0,"1 scoop (12 g)",250.0],[4177090,21.0,"1 scoop (21 g)",23.8],[4180298,63.5,"1 scoop (63.5 g)",346.0],[4201296,44.5,"1 scoop (44.5 g)",359.6],[4203874,39.0,"1 rounded scoop (39 g)",384.6],[4204541,21.0,"1 scoop (21 g)",23.8],[4213511,39.0,"1 rounded scoop (39 g)",384.6],[4218495,11.5,"0.5 scoop (11.5 g)",43.5],[4223717,9.5,"1 scoop (9.5 g)",105.3],[4231357,32.0,"1 rounded scoop (32 g)",312.5],[4231763,39.0,"1 scoop (39 g)",384.6],[4250744,12.0,"1 scoop (12 g)",41.7]];
const KELLOG: Fx = [[3488725,37.0,"1 bar (37 g)",378.4],[3517171,25.0,"1 Bar (25 g)",360.0],[3517187,22.0,"1 bar (22 g)",409.1],[3517211,22.0,"1 bar (22 g)",409.1],[3517260,37.0,"1 Bar (37 g)",405.4],[3642389,28.0,"1 bar (28 g)",437.5],[3643688,45.0,"1 bar (45 g)",395.6],[3643692,36.0,"1 bar (36 g)",313.9],[3647030,26.0,"1 bar (26 g)",404.5],[3648077,37.0,"1 BAR (37 g)",351.0],[3648123,22.0,"1 bar (22 g)",409.1],[3648891,37.0,"1 Bar (37 g)",351.4],[3649370,45.0,"1 bar (45 g)",400.0],[3649456,45.0,"1 BAR (45 g)",378.0],[3649735,22.0,"1 bar (22 g)",321.0],[3650792,37.0,"1 bar (37 g)",351.4],[3650842,55.0,"1 Bar (55 g)",436.0],[3650851,22.0,"1 bar (22 g)",409.1],[3651325,45.0,"1 bar (45 g)",377.8],[3657058,37.0,"1 bar (37 g)",351.4],[3657603,44.0,"2 bar (44 g)",409.1],[3657637,20.0,"1 BAR (20 g)",400.0],[3658093,62.0,"1 bar (62 g)",419.4],[3658208,22.0,"1 bar (22 g)",409.1],[3658336,37.0,"1 bar (37 g)",405.4],[3659298,11.0,"1 bar (11 g)",409.0],[3659402,45.0,"1 bar (45 g)",422.2],[3659484,11.0,"1 BAR (11 g)",409.0],[3659596,60.0,"1 Bar (60 g)",416.7],[3660212,20.0,"1 bar (20 g)",406.3],[3663309,12.0,"1 Bar (12 g)",416.7],[3665648,130.0,"1 bar (130 g)",100.0],[3665771,37.0,"1 Bar (37 g)",351.4],[3666645,33.0,"1 bar (33 g)",393.9],[3667052,38.0,"1 Bar (38 g)",394.7],[3667425,40.0,"1 Bar (40 g)",400.0],[3667489,44.0,"1 bar (44 g)",405.4],[3667613,45.0,"1 Bar (45 g)",256.0],[3667667,43.0,"0.5 bar (43 g)",465.1],[3667772,44.0,"1 Bar (44 g)",340.9],[3667921,33.0,"1 bar (33 g)",515.2],[3667925,11.0,"1 Bar (11 g)",412.0],[3667956,37.0,"1 bar (37 g)",351.4],[3667957,37.0,"1 bar (37 g)",378.4],[3669127,35.0,"1 Bar (35 g)",429.0],[3674969,25.0,"1 BAR (25 g)",400.0],[3675726,25.0,"1 BAR (25 g)",400.0],[3680363,33.0,"1 BAR (33 g)",424.2],[3702395,23.0,"1 bar (23 g)",435.0],[3702402,44.0,"4 BARS (44 g)",409.1],[3702854,37.0,"1 bar (37 g)",351.4],[3702859,37.0,"1 BAR (37 g)",351.4],[3703135,20.0,"1 BAR (20 g)",150.0],[3725175,11.0,"1 Bar (11 g)",409.1],[3733775,37.0,"1 bar (37 g)",351.4],[3733778,45.0,"1 BAR (45 g)",400.0],[3734371,22.0,"1 BAR (22 g)",409.1],[3734384,45.0,"1 BAR (45 g)",400.0],[3769267,44.0,"4 bar (44 g)",102.3],[3769283,45.0,"1 BAR (45 g)",400.0],[3793683,28.0,"1 bar (28 g)",425.0],[3799026,33.0,"1 bar (33 g)",394.0],[3801475,33.0,"1 bar (33 g)",393.9],[3803507,37.0,"1 bar (37 g)",405.4],[3815618,11.0,"1 bars (11 g)",409.1],[3816834,34.0,"1 bar (34 g)",426.5],[3825624,60.0,"1 bar (60 g)",416.7],[3827269,20.0,"1 bar (20 g)",400.0],[3828078,22.0,"1 bar (22 g)",409.0],[3833505,26.0,"1 bar (26 g)",403.8],[3874426,22.0,"1 bar (22 g)",412.8],[3879292,22.0,"1 bar (22 g)",456.3],[3883237,46.0,"1 bar (46 g)",413.0],[3900259,20.0,"1 bar (20 g)",406.3],[3914564,20.0,"1 bar (20 g)",86.0],[3930705,35.0,"1 bar (35 g)",436.0],[3936150,33.0,"1 bar (33 g)",424.0],[3987519,28.0,"2 bars (28 g)",500.0],[3989312,20.0,"1 bar (20 g)",400.0],[4005485,22.0,"1 bar (22 g)",409.1],[4016944,25.0,"1 bar (25 g)",396.0],[4054400,22.0,"1 bar (22 g)",454.5],[4055124,20.0,"1 bar (20g)",390.0],[4072548,22.0,"1 bar (22 g)",409.0],[4085405,38.0,"1 Bar (38 g)",397.0],[4085410,36.0,"1 Bar (36 g)",372.0],[4085412,36.0,"1 Bar (36 g)",378.0],[4119661,48.0,"1 bar (48 g)",350.0],[4122635,11.0,"1 bar (11 g)",409.0],[4128749,20.0,"1 bar (20 g)",415.0],[4130192,40.0,"1 bar (40 g)",415.0],[4138932,24.0,"1 bar (24 g)",391.7],[4168116,20.0,"1 bar (20 g)",411.0],[4194023,22.0,"1 bar (22 g)",413.0],[4194641,22.0,"1 bar (22 g)",412.8],[4199891,22.0,"1 bar (22 g)",409.1],[4207457,22.0,"1 bar (22 g)",409.1],[4216946,22.0,"1 bar (22 g)",409.1],[4232612,22.0,"1 bar (22 g)",409.1],[4235500,40.0,"2 bars (40 g)",425.0],[4238118,26.0,"1 Bar (26 g)",404.5],[4250677,28.0,"1 bar (28 g)",425.0],[4252761,22.0,"1 bar (22 g)",412.8],[4254408,22.0,"1 bar (22 g)",409.1],[4255901,11.0,"1 bar (11 g)",409.1],[4256418,33.0,"1 bar (33 g)",424.2]];

const mockedQueryRaw = prisma.$queryRaw as jest.Mock;

function asRows(fx: Fx, selfKcal: number | null) {
    return fx.map(([id, grams, description, kcal]) => ({ id, grams, description, kcal, siblingSelfKcal: selfKcal }));
}

/** Deterministic Fisher-Yates (LCG seed), so a failure names its permutation. */
function shuffled<T>(xs: T[], seed: number): T[] {
    const out = xs.slice();
    let s = seed >>> 0;
    for (let i = out.length - 1; i > 0; i--) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        const j = s % (i + 1);
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

async function borrow(rows: unknown[], unit: string, brand: string): Promise<number | undefined> {
    mockedQueryRaw.mockResolvedValueOnce(rows);
    const r = await getOrCreateAmbiguousServing('off_0000000000001', 'Some Product', unit, brand);
    return r.status === 'success' ? r.grams : undefined;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockedQueryRaw.mockResolvedValue([]);
});

describe('selectSiblingRows() — pure', () => {
    it('reads every row at or under the cap, in any order', () => {
        const rows = asRows(GHOST.slice(0, SIBLING_BORROW_CAP), 375);
        expect(selectSiblingRows(rows, 375)).toBe(rows);
    });

    it('over the cap, keeps the cap rows closest to the record kcal/100 g', () => {
        const rows = asRows(GHOST, 375);
        const picked = selectSiblingRows(rows, 375);
        expect(picked).toHaveLength(SIBLING_BORROW_CAP);
        const worst = Math.max(...picked.map(r => Math.abs((r.kcal as number) - 375)));
        const left = rows.filter(r => !picked.includes(r));
        expect(left).toHaveLength(GHOST.length - SIBLING_BORROW_CAP);
        for (const r of left) expect(r.kcal == null ? Infinity : Math.abs(r.kcal - 375)).toBeGreaterThanOrEqual(worst);
    });

    it('rows with no calories go last; ties break on OffServing.id', () => {
        const rows = [
            { id: 9, grams: 1, description: 'bar', kcal: null },
            { id: 7, grams: 2, description: 'bar', kcal: 300 },
            { id: 3, grams: 3, description: 'bar', kcal: 300 },
            { id: 5, grams: 4, description: 'bar', kcal: 500 },
        ];
        expect(selectSiblingRows(rows, 300, 2).map(r => r.id)).toEqual([3, 7]);
        expect(selectSiblingRows(rows, 300, 3).map(r => r.id)).toEqual([3, 7, 5]);
    });

    it.each([null, undefined, 0, -5, Number.NaN])('self kcal %p reads every row (the full brand median)', (k) => {
        const rows = asRows(KELLOG, null);
        expect(selectSiblingRows(rows, k as number | null | undefined)).toBe(rows);
    });

    it('the picked set does not depend on input order', () => {
        const ids = (xs: Array<{ id?: number | null }>) => xs.map(r => r.id).sort((a, b) => (a as number) - (b as number));
        const base = ids(selectSiblingRows(asRows(KELLOG, 351), 351));
        for (let seed = 1; seed <= 25; seed++) {
            expect(ids(selectSiblingRows(shuffled(asRows(KELLOG, 351), seed), 351))).toEqual(base);
        }
    });
});

describe('borrowSiblingServing() through getOrCreateAmbiguousServing()', () => {
    it('the SQL carries no LIMIT and reads the sibling kcal and the self kcal', async () => {
        await borrow(asRows(GHOST, 375), 'scoop', 'Ghost');
        const sql = (mockedQueryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
        expect(sql).not.toMatch(/\bLIMIT\b/i);
        expect(sql).toContain('AS kcal');
        expect(sql).toContain('AS "siblingSelfKcal"');
    });

    it('is deterministic: 25 permutations of 106 Kellogg bar rows bill one weight', async () => {
        const seen = new Set<number | undefined>();
        for (let seed = 1; seed <= 25; seed++) seen.add(await borrow(shuffled(asRows(KELLOG, 351), seed), 'bar', "Kellogg's"));
        expect([...seen]).toEqual([37]);
    });

    it('a protein powder borrows protein scoops, not the brand pre-workout scoop (Ghost, 375 kcal)', async () => {
        expect(await borrow(shuffled(asRows(GHOST, 375), 7), 'scoop', 'Ghost')).toBe(31.5);
    });

    it('a pre-workout keeps the pre-workout scoop (Ghost, 61 kcal)', async () => {
        expect(await borrow(shuffled(asRows(GHOST, 61), 7), 'scoop', 'Ghost')).toBe(21);
    });

    it('no self kcal: the full brand median over every row, in any order', async () => {
        expect(await borrow(shuffled(asRows(KELLOG, null), 3), 'bar', "Kellogg's")).toBe(28);
        expect(await borrow(shuffled(asRows(KELLOG, null), 11), 'bar', "Kellogg's")).toBe(28);
    });

    it('at or under the cap nothing changes: three siblings, median 54 (Quest style)', async () => {
        expect(await borrow([
            { grams: 60, description: '1 bar (60 g)' },
            { grams: 54, description: 'bar' },
            { grams: 100, description: '2 bars (100 g)' },
        ], 'bar', 'Quest')).toBe(54);
    });
});
