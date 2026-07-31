/**
 * panel-inflated-family.test.ts — tier 2 of detect-corrupt-panel.ts: the
 * per-SERVING panel stored as per-100g, found through a COARSER sibling group
 * than exact normalizeNameKey() equality.
 *
 * WHAT THIS TIER EXISTS FOR. normalizeNameKey() is a token-SET identity, so one
 * extra brand or flavour token makes a row a singleton and tier 1 can never
 * test it. Measured on the live corpus 2026-07-31: 661,150 of 1,083,139
 * kcal-bearing rows (61.0%) sit in groups below MIN_GROUP=4. The two live
 * records this tier was built to reach:
 *   off_9568310020398 "Fairlife core power elite" -> exact group size 1
 *   off_9337369550008 "Core power elite vanilla"  -> exact group size 2
 * Both store 230 kcal/100g at servingGrams 414 (the whole bottle) against a
 * true density of 55.6. 230 / 4.14 = 55.56.
 *
 * ASSERTIONS ARE POSITIVE (playbook: "assert the right answer, never enumerate
 * the wrong ones"). The integration test pins the EXACT flagged set over the
 * fixture corpus, so a rule that starts flagging something new fails even if
 * nobody predicted what that something would be.
 *
 * MUTATION RESULTS — each guard below has a named test that dies when the guard
 * is deleted; recorded here because a passing test is not evidence until it has
 * been watched to fail (playbook §13). See the block at the bottom of the file.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    runScan,
    familyKey,
    nameTokens,
    relativeMad,
    FAMILY_DF_MAX,
    type ScanDb,
    type Row,
} from '../detect-corrupt-panel';
import {
    decideMark,
    rejectPanelInflatedFamily,
    FAMILY_MIN_TOKENS,
    FAMILY_MIN_GROUP,
    FAMILY_MAX_REL_MAD,
    FAMILY_RESCALE_TOL,
    FAMILY_INFLATED_RATIO,
    MAX_REAL_GTIN_LENGTH,
    MAX_TRUSTABLE_SIBLING_MEDIAN,
    FAMILY_TIER_AUDITED_FP_RATE,
    type CorruptScanFlag,
    type FamilyScaleInputs,
} from '../../../src/lib/mapping/corrupt-mark';

// ===========================================================================
// The fixture corpus
// ===========================================================================
//
// FIXTURE SCALE NOTE. The shipped FAMILY_DF_MAX is 2000, calibrated on a
// 1.08M-row corpus where `vanilla` has df 13,166 and `core` has df 198. In a
// 77-row fixture every token is rare, so 2000 would strip nothing and the test
// would exercise a grouping the production scan never performs. The fixture
// therefore reproduces the RATIO instead: `familyDfMax: 15`, with 40 filler
// products that push `vanilla` and `chocolate` over the cutoff while `core`,
// `power` and `elite` stay under it. That is the same relationship the live
// corpus has, at fixture scale.

const FIXTURE_DF_MAX = 15;

const row = (
    barcode: string, name: string, brandName: string | null,
    calories: number, servingGrams: number | null
): Row => ({ barcode, name, brandName, servingGrams, nutrientsPer100g: { calories } });

/** Core Power Elite: 8 clean rows at the true 55.6 density + the two live
 *  corrupt records, all landing on family key `core elite power`. */
const CORE_POWER: Row[] = [
    row('CP1', 'Core Power Elite', 'Fairlife', 55.6, 414),
    row('CP2', 'Core Power Elite', 'Fairlife', 55.6, 414),
    row('CP3', 'Core Power Elite', 'Fairlife', 55.6, 414),
    row('CP4', 'Core Power Elite', 'Fairlife', 55.6, 414),
    row('CP5', 'Core Power Elite', 'Fairlife', 55.6, 414),
    row('CP6', 'Core Power Elite', 'Fairlife', 55.6, 414),
    row('CP7', 'Core Power Elite Vanilla', 'Fairlife', 55.6, 414),
    row('CP8', 'Core Power Elite Chocolate', 'Fairlife', 55.6, 414),
    // THE TARGETS — the two live barcodes, verbatim name/brand/panel/serving.
    row('9568310020398', 'Fairlife core power elite', 'Fairlife', 230, 414),
    row('9337369550008', 'Core power elite vanilla', 'Fairlife', 230, 414),
];
const TARGETS = ['9568310020398', '9337369550008'];
/** The ~55 kcal siblings that must NEVER be flagged. */
const CLEAN_SIBLINGS = ['CP1', 'CP2', 'CP3', 'CP4', 'CP5', 'CP6', 'CP7', 'CP8'];

/** The mass-INFLATED family: median 3200 kcal/100g. A different corruption in
 *  which the plausible-looking row is the corrupt one, so this tier must not
 *  judge it. `MC` satisfies every OTHER condition — ratio 1.63, rescale within
 *  1.6% of the median — so removing the median guard flags it immediately. */
const MARASCHINO: Row[] = [
    ...Array.from({ length: 8 }, (_, i) =>
        row(`MR${i + 1}`, 'Maraschino Cherry Red', 'Luxardo', 3200, 30)),
    row('MCORRUPT', 'Acme Maraschino Cherry Red', 'Acme', 5200, 160),
];

/** The OFF chain-restaurant import: >13-digit synthetic barcodes carrying the
 *  DIVIDED-panel corruption, whose repair runs the opposite direction. */
const CHAIN: Row[] = [
    ...Array.from({ length: 8 }, (_, i) =>
        row(`100000000000${i + 1}`, 'Castle Lavaburst Orange', 'White Castle', 7.1, 295.735)),
    row('12228445487636949309', 'White Castle Lavaburst Orange', 'White Castle', 20, 295.735),
];

/** A FUSED family: one key covering products of genuinely different densities.
 *  `GCORRUPT` passes ratio and rescale; only the dispersion guard rejects it. */
const FUSED: Row[] = [
    ...[20, 30, 40, 50, 60, 70, 80, 85].map((k, i) =>
        row(`FG${i + 1}`, 'Acme Gamma Delta', 'Acme Labs', k, 200)),
    row('GCORRUPT', 'Epsilon Acme Gamma Delta', 'Epsilon Acme', 110, 200),
];

/** A row BOTH tiers reach: its exact-name group is large enough for tier 1 AND
 *  its family group is large enough for tier 2, and it satisfies both
 *  signatures. Without the tier-2 dedupe it is flagged twice, which would put
 *  the same barcode into two populations the parent is restoring separately. */
const DOUBLE_REACH: Row[] = [
    ...Array.from({ length: 8 }, (_, i) => row(`Z${i + 1}`, 'Zeta Omega Bar', 'Acme', 50, 200)),
    row('ZDUP', 'Zeta Omega Bar', 'Acme', 100, 200),
];

/** Ballast that pushes `vanilla` and `chocolate` past the fixture DF cutoff,
 *  exactly as the live corpus does. servingGrams null keeps them inert. */
const FILLER: Row[] = [
    ...Array.from({ length: 20 }, (_, i) => row(`FV${i}`, 'Vanilla Pudding Cup', 'Store', 100, null)),
    ...Array.from({ length: 20 }, (_, i) => row(`FC${i}`, 'Chocolate Bar Snack', 'Store', 500, null)),
];

const CORPUS: Row[] = [...CORE_POWER, ...MARASCHINO, ...CHAIN, ...FUSED, ...DOUBLE_REACH, ...FILLER];

const pagedFindMany = (rows: Row[]) =>
    async (q: unknown) => ((q as { cursor?: unknown })?.cursor ? [] : rows);
const scanDb = (rows: Row[]): ScanDb => ({
    offFood: { findMany: pagedFindMany(rows), findUnique: async () => null },
});

interface Flag {
    barcode: string; direction: string; kcal100: number; servingGrams: number;
    rescaled: number; siblingMedian: number; groupSize: number;
    family?: { key: string; relMad: number; median: number };
}

async function scan(rows: Row[] = CORPUS): Promise<Flag[]> {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-family-'));
    const code = await runScan(scanDb(rows), { outDir: out, familyDfMax: FIXTURE_DF_MAX, print: 0 });
    expect(code).toBe(0);
    const file = fs.readdirSync(out).find(f => f.startsWith('corrupt-panel-scan-'))!;
    return JSON.parse(fs.readFileSync(path.join(out, file), 'utf8')).flagged as Flag[];
}

let logSpy: jest.SpyInstance;
beforeEach(() => { logSpy = jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { logSpy.mockRestore(); });

// ===========================================================================
// 1. The grouping key
// ===========================================================================

describe('familyKey — the discriminative-token grouping key', () => {
    // The live document frequencies, so this test is about the real corpus's
    // token distribution rather than an invented one.
    const liveDf = new Map<string, number>([
        ['core', 198], ['elite', 176], ['power', 1346], ['fairlife', 29],
        ['vanilla', 13166], ['chocolate', 58054], ['strawberry', 15302],
        ['protein', 25343], ['milk', 25721], ['shake', 4558], ['high', 30000],
    ]);

    it('THE DEFEAT CASE: the two live records join the family exact grouping splits apart', () => {
        // Under normalizeNameKey these are `core elite fairlife power` (group 1)
        // and `core elite power vanilla` (group 2). Under familyKey they are the
        // same family as every other Core Power Elite row.
        expect(familyKey('Fairlife core power elite', 'Fairlife', liveDf)).toBe('core elite power');
        expect(familyKey('Core power elite vanilla', 'Fairlife', liveDf)).toBe('core elite power');
        expect(familyKey('Core Power Elite Chocolate', 'Fairlife', liveDf)).toBe('core elite power');
        expect(familyKey('Core Power Elite Strawberry', 'fairlife', liveDf)).toBe('core elite power');
    });

    it('keeps a genuinely different product in a different family', () => {
        // Plain Core Power is 41.1 kcal/100g; Elite is 55.6. Fusing them would
        // put a 35% error into the reference the whole tier rests on.
        expect(familyKey('Core Power High Protein Milk Shake', 'Fairlife', liveDf)).toBe('core power');
        expect(familyKey('Core Power High Protein Milk Shake', 'Fairlife', liveDf))
            .not.toBe(familyKey('Core Power Elite Chocolate', 'Fairlife', liveDf));
    });

    it('returns null rather than a 1-token key when the strip leaves too little', () => {
        // Playbook §3: ask what happens when the strip removes everything. A
        // single generic token is the measured worst false-positive mode
        // (`filet` fused beef tenderloin with a 132 kcal median).
        expect(familyKey('Chocolate Milk', 'Store', liveDf)).toBeNull();     // all generic
        expect(familyKey('Elite Protein', 'Store', liveDf)).toBeNull();      // 1 token survives
        expect(FAMILY_MIN_TOKENS).toBe(2);
    });

    it('returns null when the name normalizes away entirely', () => {
        expect(familyKey('!!!', null, liveDf)).toBeNull();
        expect(nameTokens('!!!')).toEqual([]);
        expect(nameTokens(null)).toEqual([]);
    });

    it('strips brand tokens by BRAND, not by rarity — a rare brand token is still dropped', () => {
        // `fairlife` has df 29, far below the cutoff, so only the brand strip
        // removes it. Without that strip the first defeat case above fails.
        expect(familyKey('Fairlife core power elite', null, liveDf))
            .toBe('core elite fairlife power');
        expect(familyKey('Fairlife core power elite', 'Fairlife', liveDf))
            .toBe('core elite power');
    });

    it('defaults to the shipped FAMILY_DF_MAX, and the shipped value is 2000', () => {
        // Pinned so a future tweak has to argue with the audit that set it.
        expect(FAMILY_DF_MAX).toBe(2000);
        expect(familyKey('Core power elite vanilla', 'Fairlife', liveDf))
            .toBe(familyKey('Core power elite vanilla', 'Fairlife', liveDf, FAMILY_DF_MAX));
    });
});

describe('the audited population number', () => {
    it('pins the LIVE false-positive rate, not the fixture one', () => {
        // Playbook §2: a fixture number is a claim about the fixture. This suite
        // is 100% precise on its own corpus and the live tier-2 set is 29% FP.
        // Both numbers are correct; only one of them is about the population,
        // and it is the one that decides whether anything may be marked.
        expect(FAMILY_TIER_AUDITED_FP_RATE).toBeCloseTo(9 / 31, 10);
        expect(FAMILY_TIER_AUDITED_FP_RATE).toBeGreaterThan(0.2);
    });
});

describe('relativeMad — dispersion measured robustly', () => {
    it('is zero for a family whose corrupt members are a minority', () => {
        // The whole point: 2 corrupt rows at 230 must not make the Core Power
        // family look dispersed. A stddev here would read 0.9 and the group
        // would be thrown away — detecting nothing.
        expect(relativeMad([55.6, 55.6, 55.6, 55.6, 55.6, 55.6, 55.6, 55.6, 230, 230], 55.6)).toBe(0);
    });

    it('is large for a fused family', () => {
        expect(relativeMad([20, 30, 40, 50, 60, 70, 80, 85], 55)).toBeCloseTo(20 / 55, 5);
    });

    it('refuses a non-positive median instead of dividing by it', () => {
        expect(relativeMad([1, 2], 0)).toBe(Infinity);
        expect(relativeMad([], 10)).toBe(Infinity);
    });
});

// ===========================================================================
// 2. The rule
// ===========================================================================

describe('rejectPanelInflatedFamily — every condition names its own refusal', () => {
    /** The live off_9568310020398 measurements. */
    const target = (): FamilyScaleInputs => ({
        barcode: '9568310020398',
        kcal100: 230,
        servingGrams: 414,
        familyMedian: 55.6,
        groupSize: 16,
        relMad: 0,
    });

    it('ACCEPTS the live record behind golden case n-supp-23', () => {
        expect(rejectPanelInflatedFamily(target())).toBeNull();
    });

    it('REJECTS the clean 55.6 siblings — they are not inflated against their own median', () => {
        expect(rejectPanelInflatedFamily({ ...target(), barcode: 'CP1', kcal100: 55.6 }))
            .toBe('family_not_inflated_vs_median');
        // and the boundary is exactly FAMILY_INFLATED_RATIO
        const atRatio = 55.6 * FAMILY_INFLATED_RATIO;
        expect(rejectPanelInflatedFamily({ ...target(), kcal100: atRatio, servingGrams: 160 }))
            .toBeNull();
        expect(rejectPanelInflatedFamily({ ...target(), kcal100: atRatio - 0.001, servingGrams: 160 }))
            .toBe('family_not_inflated_vs_median');
    });

    it('REJECTS the mass-inflated family (median > the trustable ceiling)', () => {
        // 5200 kcal/100g against a 3200 median: ratio 1.63, rescale 3250 vs
        // 3200. Every other condition passes. Only this guard stops it.
        const maraschino: FamilyScaleInputs = {
            barcode: 'MCORRUPT', kcal100: 5200, servingGrams: 160,
            familyMedian: 3200, groupSize: 9, relMad: 0,
        };
        expect(rejectPanelInflatedFamily(maraschino)).toBe('family_median_implausible');
        expect(rejectPanelInflatedFamily({ ...maraschino, familyMedian: MAX_TRUSTABLE_SIBLING_MEDIAN + 0.001 }))
            .toBe('family_median_implausible');
    });

    it('REJECTS synthetic chain-import barcodes — a different corruption family', () => {
        const chain: FamilyScaleInputs = {
            barcode: '12228445487636949309', kcal100: 20, servingGrams: 295.735,
            familyMedian: 7.1, groupSize: 9, relMad: 0,
        };
        expect(rejectPanelInflatedFamily(chain)).toBe('family_barcode_not_real_gtin');
        expect(rejectPanelInflatedFamily({ ...chain, barcode: '1'.repeat(MAX_REAL_GTIN_LENGTH) }))
            .toBeNull();
        expect(rejectPanelInflatedFamily({ ...chain, barcode: '1'.repeat(MAX_REAL_GTIN_LENGTH + 1) }))
            .toBe('family_barcode_not_real_gtin');
    });

    it('REJECTS a group that is too small or too dispersed to be a reference', () => {
        expect(rejectPanelInflatedFamily({ ...target(), groupSize: FAMILY_MIN_GROUP - 1 }))
            .toBe('family_group_too_small');
        expect(rejectPanelInflatedFamily({ ...target(), groupSize: FAMILY_MIN_GROUP }))
            .toBeNull();
        expect(rejectPanelInflatedFamily({ ...target(), relMad: FAMILY_MAX_REL_MAD + 0.001 }))
            .toBe('family_dispersion_too_high');
        expect(rejectPanelInflatedFamily({ ...target(), relMad: FAMILY_MAX_REL_MAD }))
            .toBeNull();
    });

    it('REJECTS servings outside the single-occasion window and inside the 90-110 dead zone', () => {
        expect(rejectPanelInflatedFamily({ ...target(), servingGrams: 1 }))
            .toBe('family_serving_out_of_window');
        expect(rejectPanelInflatedFamily({ ...target(), servingGrams: 601 }))
            .toBe('family_serving_out_of_window');
        // 100 g cannot distinguish a per-serving panel from a correct one at all.
        expect(rejectPanelInflatedFamily({ ...target(), kcal100: 100, servingGrams: 100, familyMedian: 55.6 }))
            .toBe('family_serving_in_dead_zone');
    });

    it('REJECTS a row whose rescale misses the family median, at the tolerance edge', () => {
        // Tolerance is 0.15, NOT tier 1's 0.30 — a coarser group buys precision
        // here. Audited: 0.30 -> 0.15 removed 7 of 15 false positives.
        const med = 100;
        const base: FamilyScaleInputs = {
            barcode: 'X', kcal100: 0, servingGrams: 200, familyMedian: med, groupSize: 10, relMad: 0,
        };
        // rescaled = kcal100/2, so kcal100 = 2*(med +/- tol*med)
        expect(rejectPanelInflatedFamily({ ...base, kcal100: 2 * med * (1 + FAMILY_RESCALE_TOL) }))
            .toBeNull();
        expect(rejectPanelInflatedFamily({ ...base, kcal100: 2 * med * (1 + FAMILY_RESCALE_TOL) + 0.01 }))
            .toBe('family_rescale_misses_median');
        expect(FAMILY_RESCALE_TOL).toBe(0.15);
    });

    it('REJECTS missing or non-finite evidence rather than treating it as zero', () => {
        expect(rejectPanelInflatedFamily(null)).toBe('family_evidence_missing');
        expect(rejectPanelInflatedFamily(undefined)).toBe('family_evidence_missing');
        expect(rejectPanelInflatedFamily({ ...target(), servingGrams: NaN }))
            .toBe('family_evidence_missing');
        expect(rejectPanelInflatedFamily({ ...target(), familyMedian: 0 }))
            .toBe('family_evidence_missing');
        expect(rejectPanelInflatedFamily({ ...target(), barcode: '' }))
            .toBe('family_evidence_missing');
    });
});

// ===========================================================================
// 3. decideMark — the marking gate
// ===========================================================================

describe('decideMark — panel-inflated-family', () => {
    const flag = (over: Partial<CorruptScanFlag> = {}): CorruptScanFlag => ({
        barcode: '9568310020398', name: 'Fairlife core power elite', brandName: 'Fairlife',
        kcal100: 230, servingGrams: 414, tier: 'direct',
        direction: 'panel-inflated-family',
        rescaled: 56, siblingMedian: 56, groupSize: 16, triageConfirmed: false,
        family: { key: 'core elite power', relMad: 0, median: 55.6 },
        ...over,
    });

    it('marks the target with its own reason string', () => {
        expect(decideMark(flag())).toEqual({ mark: true, reason: 'panel-inflated-family:direct' });
    });

    it('the two panel-inflated populations stay separable by prefix', () => {
        // The parent is restoring the tier-1 population separately; the marks
        // must not be entangled. Note the same footgun panel-inflated-serving
        // documents: bare "panel-inflated" selects BOTH generations, so a
        // --clear-prefix must carry the colon.
        expect('panel-inflated-family:direct'.startsWith('panel-inflated')).toBe(true);
        expect('panel-inflated-family:direct'.startsWith('panel-inflated:')).toBe(false);
        expect('panel-inflated-family:direct'.startsWith('panel-inflated-family:')).toBe(true);
    });

    it('re-runs the WHOLE rule from measurements — a hand-edited scan cannot mark', () => {
        // Every one of these files claims the row is corrupt. decideMark must
        // believe the measurements instead.
        expect(decideMark(flag({ kcal100: 55.6 })))
            .toEqual({ mark: false, skip: 'family_not_inflated_vs_median' });
        expect(decideMark(flag({ groupSize: 3 })))
            .toEqual({ mark: false, skip: 'family_group_too_small' });
        expect(decideMark(flag({ family: { key: 'k', relMad: 0.9, median: 55.6 } })))
            .toEqual({ mark: false, skip: 'family_dispersion_too_high' });
        expect(decideMark(flag({ barcode: '9'.repeat(20) })))
            .toEqual({ mark: false, skip: 'family_barcode_not_real_gtin' });
        expect(decideMark(flag({ family: { key: 'k', relMad: 0, median: 3200 } })))
            .toEqual({ mark: false, skip: 'family_median_implausible' });
    });

    it('refuses when the family evidence block is absent entirely', () => {
        expect(decideMark(flag({ family: undefined })))
            .toEqual({ mark: false, skip: 'family_evidence_missing' });
        expect(decideMark(flag({ servingGrams: null })))
            .toEqual({ mark: false, skip: 'family_evidence_missing' });
    });

    it('re-verifies against the UNROUNDED median, not the rounded display value', () => {
        // A 0.3 kcal/100g diet-soda family rounds to 0; reading siblingMedian
        // would make every such flag refuse for the wrong reason (or, with a
        // different rounding, mark for the wrong reason).
        const tiny = flag({
            barcode: '9300675094498', kcal100: 1, servingGrams: 250,
            siblingMedian: 0, rescaled: 0,
            family: { key: 'caffeine zero', relMad: 0, median: 0.4 },
        });
        expect(decideMark(tiny)).toEqual({ mark: true, reason: 'panel-inflated-family:direct' });
    });

    it('leaves the tier-1 directions exactly as they were', () => {
        const base = flag({ direction: 'panel-inflated', family: undefined });
        expect(decideMark(base)).toEqual({ mark: true, reason: 'panel-inflated:direct' });
        expect(decideMark({ ...base, groupSize: 7 }))
            .toEqual({ mark: false, skip: 'inflated_group_too_small' });
        expect(decideMark({ ...base, direction: 'panel-low', kcal100: 20, siblingMedian: 55 }))
            .toEqual({ mark: true, reason: 'panel-low:direct' });
    });
});

// ===========================================================================
// 4. The scan, end to end over the fixture corpus
// ===========================================================================

describe('runScan — tier 2 over a fixture corpus', () => {
    it('THE REQUIRED ANSWER: the whole flagged set, by barcode and by direction', async () => {
        const flagged = await scan();
        // Positive form: the entire set, not a list of things absent. Anything
        // newly flagged fails this even if nobody predicted what it would be.
        expect(
            flagged.map(f => `${f.barcode}:${f.direction}`).sort()
        ).toEqual([
            '9337369550008:panel-inflated-family',
            '9568310020398:panel-inflated-family',
            'ZDUP:panel-inflated',
        ]);
    });

    it('reconstructs the true density: 230 kcal/100g at 414 g rescales onto 55.6', async () => {
        const t = (await scan()).find(f => f.barcode === '9568310020398')!;
        expect(t.kcal100).toBe(230);
        expect(t.servingGrams).toBe(414);
        expect(t.family!.key).toBe('core elite power');
        expect(t.family!.median).toBeCloseTo(55.6, 5);
        expect(t.rescaled).toBe(56);            // 230 * 100 / 414 = 55.56
        expect(t.groupSize).toBe(10);
    });

    it('does NOT flag the ~55 kcal Core Power Elite siblings', async () => {
        const flagged = new Set((await scan()).map(f => f.barcode));
        for (const b of CLEAN_SIBLINGS) expect(flagged.has(b)).toBe(false);
    });

    it('does NOT flag anything in the mass-inflated (>950 median) family', async () => {
        const flagged = new Set((await scan()).map(f => f.barcode));
        for (const r of MARASCHINO) expect(flagged.has(r.barcode)).toBe(false);
    });

    it('does NOT flag the synthetic chain-import row, or the fused family', async () => {
        const flagged = new Set((await scan()).map(f => f.barcode));
        expect(flagged.has('12228445487636949309')).toBe(false);
        expect(flagged.has('GCORRUPT')).toBe(false);
    });

    it('the two tiers never claim the same row', async () => {
        // ZDUP satisfies BOTH signatures: exact group n=9 median 50, family
        // group n=9 median 50, ratio 2.0, rescale exact. Tier 1 decides it and
        // tier 2 must stay out, or the same barcode lands in two populations
        // that are being restored independently.
        const flagged = await scan();
        expect(new Set(flagged.map(f => f.barcode)).size).toBe(flagged.length);
        expect(flagged.filter(f => f.barcode === 'ZDUP')).toHaveLength(1);
        expect(flagged.find(f => f.barcode === 'ZDUP')!.direction).toBe('panel-inflated');
    });

    it('COUNTER-CONTROL: the corrupt rows are what makes the set non-empty', async () => {
        // Playbook §5: a detector needs rows it must NOT match, or a passing
        // test is tautological. Remove the two corrupt rows and the SAME corpus
        // under the SAME thresholds must produce zero flags.
        const corrupt = [...TARGETS, 'ZDUP'];
        const clean = CORPUS.filter(r => !corrupt.includes(r.barcode));
        expect(await scan(clean)).toEqual([]);
    });

    it('still fails closed on an empty corpus', async () => {
        const out = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-family-'));
        const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        expect(await runScan(scanDb([]), { outDir: out, familyDfMax: FIXTURE_DF_MAX })).toBe(2);
        expect(fs.readdirSync(out)).toHaveLength(0);
        errSpy.mockRestore();
    });
});

// ===========================================================================
// MUTATION LOG (playbook §13) — executed 2026-07-31 by a harness that patches
// the source, runs `npx jest <this file>`, records the dying tests, and
// restores. Restored-tree re-run: 31 passed, exit 0.
// ===========================================================================
//
// A guard with no named killer is untested regardless of the pass count. 12 of
// 12 mutations are killed; the first pass had ELEVEN, and the survivor is the
// reason DOUBLE_REACH exists (see below).
//
//   mutation                              | first test that died
//   --------------------------------------|-----------------------------------
//   drop family_median_implausible         | REJECTS the mass-inflated family
//   drop family_barcode_not_real_gtin      | REJECTS synthetic chain-import
//                                          | barcodes
//   drop family_dispersion_too_high        | REJECTS a group that is too small
//                                          | or too dispersed
//   drop family_group_too_small            | REJECTS a group that is too small
//                                          | or too dispersed
//   drop the 90-110 g dead-zone guard      | REJECTS servings outside the
//                                          | single-occasion window
//   FAMILY_MIN_TOKENS 2 -> 1               | returns null rather than a
//                                          | 1-token key
//   FAMILY_RESCALE_TOL 0.15 -> 0.30        | REJECTS a row whose rescale
//                                          | misses the family median
//   FAMILY_MAX_REL_MAD 0.10 -> 0.50        | THE REQUIRED ANSWER
//   decideMark reads the ROUNDED median    | re-verifies against the UNROUNDED
//                                          | median
//   familyKey brand strip removed          | THE DEFEAT CASE
//   relativeMad -> MEAN abs deviation      | is zero for a family whose
//                                          | corrupt members are a minority
//                                          | (0 -> 0.627, and the target then
//                                          | goes undetected)
//   tier-2 dedupe `if (tier1Flagged)`      | THE REQUIRED ANSWER + the two
//     removed                              | tiers never claim the same row
//
// THE SURVIVOR, and what it cost. On the first run the dedupe mutation left the
// suite fully GREEN: the fixture contained no row that both tiers could reach,
// so no input could distinguish the two implementations. That is the failure
// mode playbook §13 names — "the fixture was too well-behaved" — and the fix
// was not another assertion but a new input (DOUBLE_REACH / `ZDUP`), built so
// the two implementations MUST disagree on it.
