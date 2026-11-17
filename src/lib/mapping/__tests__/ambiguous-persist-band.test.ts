/**
 * THE SAVE BAND (s461 WHOLE-PERSIST) — persistBandRefusal() and its one call site.
 *
 * getOrCreateAmbiguousServing() writes a model answer before any caller reads it, and that row
 * then answers every later request for the (record, unit). The band decides only whether the
 * answer is WRITTEN; the caller still receives it. Three clauses: the unit's own read bounds,
 * `whole` <= WHOLE_SAVE_MAX_GRAMS, and <= PACKAGE_SAVE_TOLERANCE x the OFF record's own net
 * package. The band sits AFTER the write-target and nosave guards, so a nosave receipt reads as
 * before. The sibling borrow passes no band.
 */

jest.mock('../../db', () => ({
    prisma: {
        $queryRaw: jest.fn().mockResolvedValue([]),
        offFood: { findUnique: jest.fn().mockResolvedValue(null) },
        fdcServing: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
        offServing: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
        aiGeneratedServing: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
    },
}));

jest.mock('../../logger', () => ({
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), audit: jest.fn() },
}));

// The deterministic rungs must not answer: this file is about the model answer and its save.
jest.mock('../../servings/default-count-grams', () => ({
    getSubPieceDefault: jest.fn().mockReturnValue(null),
    getDefaultCountServing: jest.fn().mockReturnValue(null),
}));

jest.mock('../../ai/ambiguous-serving-estimator', () => {
    const actual = jest.requireActual('../../ai/ambiguous-serving-estimator');
    return { ...actual, estimateAmbiguousServing: jest.fn() };
});

import {
    getOrCreateAmbiguousServing, persistBandRefusal, WHOLE_SAVE_MAX_GRAMS, PACKAGE_SAVE_TOLERANCE,
} from '../ambiguous-unit-backfill';
import { estimateAmbiguousServing } from '../../ai/ambiguous-serving-estimator';
import { prisma } from '../../db';
import { logger } from '../../logger';
import { runWithWritePolicy, currentWriteReceipt } from '../../write-policy';

const mockedEstimate = estimateAmbiguousServing as jest.Mock;
const mockedOffFood = prisma.offFood.findUnique as jest.Mock;
const mockedOffUpsert = prisma.offServing.upsert as jest.Mock;
const mockedFdcUpsert = prisma.fdcServing.upsert as jest.Mock;
const mockedQueryRaw = prisma.$queryRaw as jest.Mock;
const mockedWarn = logger.warn as jest.Mock;
const mockedInfo = logger.info as jest.Mock;
const msgs = (m: jest.Mock) => m.mock.calls.map((c) => c[0]);
const estimate = (grams: number) => mockedEstimate.mockResolvedValue({
    status: 'success', estimatedGrams: grams, confidence: 0.8, reasoning: 'r',
});
const pkg = (q: number | null, u: string | null) => mockedOffFood.mockResolvedValue(
    q == null ? null : { packageQuantity: q, packageQuantityUnit: u },
);

beforeEach(() => {
    jest.clearAllMocks();
    mockedQueryRaw.mockResolvedValue([]);
    mockedOffFood.mockResolvedValue(null);
    mockedOffUpsert.mockResolvedValue({});
    mockedFdcUpsert.mockResolvedValue({});
});

describe('persistBandRefusal() — the three clauses', () => {
    it('whole_max: a whole above 2,000 g (prod `Roast Turkey` 3,000 g) is not written; 2,000 g is', () => {
        expect(WHOLE_SAVE_MAX_GRAMS).toBe(2000);
        expect(persistBandRefusal('whole', 3000, 'Roast Turkey', null)).toBe('whole_max');
        expect(persistBandRefusal('Whole ', 2400, 'Smoked Turkey', null)).toBe('whole_max');
        expect(persistBandRefusal('whole', 2000, 'Watermelon', null)).toBeNull();
        expect(persistBandRefusal('whole', 60, 'Quest protein bar', null)).toBeNull();
    });

    it('whole_max reads only `whole`: a 2,500 g `large` with no package is written', () => {
        expect(persistBandRefusal('large', 2500, 'Watermelon', null)).toBeNull();
    });

    it('over_package: one unit cannot outweigh the record`s own net package (x1.1)', () => {
        expect(PACKAGE_SAVE_TOLERANCE).toBe(1.1);
        expect(persistBandRefusal('whole', 1200, 'Roasted Chicken', 708.7)).toBe('over_package');
        expect(persistBandRefusal('large', 450, "Hunt's Tomato Ketchup", 396.9)).toBe('over_package');
        expect(persistBandRefusal('whole', 760, 'Roasted Chicken', 708.7)).toBeNull(); // inside 1.1x
        expect(persistBandRefusal('whole', 700, 'Roasted Chicken', 708.7)).toBeNull();
        expect(persistBandRefusal('whole', 1200, 'Roasted Chicken', null)).toBeNull();
        expect(persistBandRefusal('whole', 1200, 'Roasted Chicken', 0)).toBeNull();
    });

    it('unit_bounds: a row the read side would reject is never written', () => {
        expect(persistBandRefusal('piece', 250, 'Mango chunks', null)).toBe('unit_bounds'); // piece max 200
        expect(persistBandRefusal('handful', 5, 'Almonds', null)).toBe('unit_bounds'); // handful min 10
        expect(persistBandRefusal('scoop', 80, 'Whey protein powder', null)).toBe('unit_bounds'); // powder scoop 50
        expect(persistBandRefusal('scoop', 80, 'Vanilla ice cream', null)).toBeNull(); // food scoop 120
        expect(persistBandRefusal('piece', 150, 'Mango chunks', null)).toBeNull();
    });
});

describe('the model-save site passes the band', () => {
    it('an out-of-band whole is returned for this request but never written, and says so at warn', async () => {
        estimate(3000);
        const r = await getOrCreateAmbiguousServing('off_0201954009433', 'Roast Turkey', 'whole');

        expect(r).toEqual({ status: 'success', grams: 3000, confidence: 0.8 });
        expect(mockedOffUpsert).not.toHaveBeenCalled();
        expect(msgs(mockedWarn)).toContain('ambiguous_backfill.persist_out_of_band');
        const w = mockedWarn.mock.calls.find((c) => c[0] === 'ambiguous_backfill.persist_out_of_band')![1];
        expect(w).toMatchObject({ foodId: 'off_0201954009433', unit: 'whole', grams: 3000, refusal: 'whole_max' });
        expect(msgs(mockedInfo)).not.toContain('ambiguous_backfill.saved');
    });

    it('reads the OFF record`s package: 1,200 g over a 709 g pack is not written, 600 g is', async () => {
        pkg(708.738, 'g');
        estimate(1200);
        await getOrCreateAmbiguousServing('off_0646670523793', 'Roasted Chicken', 'whole');
        expect(mockedOffFood).toHaveBeenCalledWith(expect.objectContaining({ where: { barcode: '0646670523793' } }));
        expect(mockedOffUpsert).not.toHaveBeenCalled();

        estimate(600);
        await getOrCreateAmbiguousServing('off_0646670523793', 'Roasted Chicken', 'whole');
        expect(mockedOffUpsert).toHaveBeenCalledTimes(1);
        expect(mockedOffUpsert.mock.calls[0][0].create).toMatchObject({ description: 'whole', grams: 600 });
        expect(msgs(mockedInfo)).toContain('ambiguous_backfill.saved');
    });

    it('a package in ml reads as grams; any other unit, or no package, skips the clause', async () => {
        pkg(354.9, 'ml');
        estimate(500);
        await getOrCreateAmbiguousServing('off_0000000000001', 'Sparkling Kiwi Guava', 'large');
        expect(mockedOffUpsert).not.toHaveBeenCalled();

        pkg(12, 'oz');
        await getOrCreateAmbiguousServing('off_0000000000001', 'Sparkling Kiwi Guava', 'large');
        expect(mockedOffUpsert).toHaveBeenCalledTimes(1);
    });

    it('a package lighter than the record`s own label serving is a mis-read: the serving is the floor', async () => {
        // prod (s461 rf-persist-b): noosa mango, packageQuantity 0.5 g on a 113 g serving
        mockedOffFood.mockResolvedValue({ packageQuantity: 0.5, packageQuantityUnit: 'g', servingGrams: 113 });
        estimate(113);
        await getOrCreateAmbiguousServing('off_0815909021830', 'mango', 'whole');
        expect(mockedOffFood).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ servingGrams: true }) }));
        expect(mockedOffUpsert).toHaveBeenCalledTimes(1);

        estimate(200);
        await getOrCreateAmbiguousServing('off_0815909021830', 'mango', 'whole');
        expect(mockedOffUpsert).toHaveBeenCalledTimes(1);

        // a serving lighter than the package keeps the package: Hunt's 397 g bottle, 17 g serving
        mockedOffFood.mockResolvedValue({ packageQuantity: 396.9, packageQuantityUnit: 'g', servingGrams: 17 });
        estimate(450);
        await getOrCreateAmbiguousServing('off_0027000382073', "Hunt's Tomato Ketchup", 'large');
        expect(mockedOffUpsert).toHaveBeenCalledTimes(1);
    });

    it('a failed package lookup writes as today', async () => {
        mockedOffFood.mockRejectedValue(new Error('connection reset'));
        estimate(1200);
        await getOrCreateAmbiguousServing('off_0646670523793', 'Roasted Chicken', 'whole');
        expect(mockedOffUpsert).toHaveBeenCalledTimes(1);
    });

    it('an in-band estimate on an fdc_ id is written; an out-of-band one is not; FDC reads no package', async () => {
        estimate(500);
        await getOrCreateAmbiguousServing('fdc_171705', 'Chicken, whole, roasted', 'whole');
        expect(mockedFdcUpsert).toHaveBeenCalledTimes(1);

        estimate(4500);
        await getOrCreateAmbiguousServing('fdc_171705', 'Turkey, whole, roasted', 'whole');
        expect(mockedFdcUpsert).toHaveBeenCalledTimes(1);
        expect(mockedOffFood).not.toHaveBeenCalled();
    });

    it('an fs_ id keeps its own no-target warn and never reaches the band', async () => {
        estimate(3000);
        await getOrCreateAmbiguousServing('fs_2314048', 'Rotisserie Chicken', 'whole');
        expect(msgs(mockedWarn)).toContain('ambiguous_backfill.persist_skipped_no_target');
        expect(msgs(mockedWarn)).not.toContain('ambiguous_backfill.persist_out_of_band');
    });

    it('nosave refuses FIRST: the receipt names the refused row and the package is never read', async () => {
        estimate(3000);
        const receipt = await runWithWritePolicy({ suppress: ['aiServing'] }, async () => {
            await getOrCreateAmbiguousServing('off_0201954009433', 'Roast Turkey', 'whole');
            return currentWriteReceipt();
        });
        expect(receipt!.refusedTotal).toBe(1);
        expect(receipt!.refused[0]).toMatchObject({ kind: 'aiServing', table: 'OffServing', key: 'off_0201954009433:whole' });
        expect(mockedOffFood).not.toHaveBeenCalled();
        expect(msgs(mockedWarn)).not.toContain('ambiguous_backfill.persist_out_of_band');
    });

    it('the sibling borrow passes no band: a genuine same-brand label median is written as before', async () => {
        pkg(50, 'g');
        mockedQueryRaw.mockResolvedValue([{ grams: 60, description: '1 bar (60 g)' }, { grams: 62, description: '1 bar (62 g)' }]);
        await getOrCreateAmbiguousServing('off_0888849010912', 'Quest protein bar', 'bar', 'Quest');
        expect(mockedEstimate).not.toHaveBeenCalled();
        expect(mockedOffUpsert).toHaveBeenCalledTimes(1);
        expect(mockedOffUpsert.mock.calls[0][0].create).toMatchObject({ source: 'sibling_borrow' });
    });
});
