/**
 * segmentation-cache unit tests: hit path, version keying, write-through,
 * fail-open on every prisma error, and the throttled TTL sweep.
 *
 * jest.resetModules() per test: the TTL sweep throttle is module state
 * (writesSinceSweep), so each test gets a fresh module + fresh prisma mocks.
 */

jest.mock('@/lib/db', () => ({
  prisma: {
    segmentationCache: {
      findUnique: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

const validItems = [
  { rawText: '2 eggs', mealType: 'breakfast', brand: '', normalizedForm: 'eggs' },
  { rawText: 'wheat toast', mealType: 'breakfast', brand: '', normalizedForm: 'wheat toast' },
];

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('segmentation-cache', () => {
  let segCache: typeof import('../segmentation-cache');
  let SEG_PARSER_VERSION: string;
  let prisma: {
    segmentationCache: {
      findUnique: jest.Mock;
      update: jest.Mock;
      upsert: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let warnSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    /* eslint-disable @typescript-eslint/no-var-requires */
    segCache = require('../segmentation-cache');
    SEG_PARSER_VERSION = require('../ai-segmenter').SEG_PARSER_VERSION;
    prisma = require('@/lib/db').prisma;
    /* eslint-enable @typescript-eslint/no-var-requires */
    prisma.segmentationCache.update.mockResolvedValue({});
    prisma.segmentationCache.upsert.mockResolvedValue({});
    prisma.segmentationCache.deleteMany.mockResolvedValue({ count: 0 });
  });

  afterEach(async () => {
    await flush(); // settle fire-and-forget promises before restoring spies
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  describe('lookupSegmentationCache', () => {
    test('hit returns cached segments and bumps hitCount/lastUsedAt fire-and-forget', async () => {
      prisma.segmentationCache.findUnique.mockResolvedValue({
        lineKey: '2 eggs and toast',
        parserVersion: SEG_PARSER_VERSION,
        segmentsJson: validItems,
        hitCount: 3,
        lastUsedAt: new Date(),
        createdAt: new Date(),
      });

      const result = await segCache.lookupSegmentationCache('2 eggs and toast');
      expect(result).toEqual(validItems);
      expect(prisma.segmentationCache.update).toHaveBeenCalledWith({
        where: {
          lineKey_parserVersion: { lineKey: '2 eggs and toast', parserVersion: SEG_PARSER_VERSION },
        },
        data: { hitCount: { increment: 1 }, lastUsedAt: expect.any(Date) },
      });
    });

    test('lookup is keyed by CURRENT parser version (old-version rows are unreachable)', async () => {
      prisma.segmentationCache.findUnique.mockResolvedValue(null);
      const result = await segCache.lookupSegmentationCache('2 eggs and toast');
      expect(result).toBeNull();
      expect(prisma.segmentationCache.findUnique).toHaveBeenCalledWith({
        where: {
          lineKey_parserVersion: { lineKey: '2 eggs and toast', parserVersion: SEG_PARSER_VERSION },
        },
      });
      expect(prisma.segmentationCache.update).not.toHaveBeenCalled();
    });

    test('malformed segmentsJson reads as a miss (no bump, warning logged)', async () => {
      prisma.segmentationCache.findUnique.mockResolvedValue({
        segmentsJson: [{ rawText: '', mealType: 'brunch' }],
      });
      const result = await segCache.lookupSegmentationCache('weird row');
      expect(result).toBeNull();
      expect(prisma.segmentationCache.update).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('malformed segmentsJson'));
    });

    test('fail-open: prisma read throwing yields a miss, never a throw', async () => {
      prisma.segmentationCache.findUnique.mockRejectedValue(new Error('db down'));
      await expect(segCache.lookupSegmentationCache('2 eggs and toast')).resolves.toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('lookup failed (fail-open'),
        expect.any(Error),
      );
    });

    test('fail-open: a failing hit bump does not affect the returned segments', async () => {
      prisma.segmentationCache.findUnique.mockResolvedValue({ segmentsJson: validItems });
      prisma.segmentationCache.update.mockRejectedValue(new Error('bump failed'));
      const result = await segCache.lookupSegmentationCache('2 eggs and toast');
      expect(result).toEqual(validItems);
      await flush();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('hit bump failed'), expect.any(Error));
    });
  });

  describe('writeSegmentationCache', () => {
    test('upserts under the CURRENT parser version', async () => {
      await segCache.writeSegmentationCache('2 eggs and toast', validItems as never);
      expect(prisma.segmentationCache.upsert).toHaveBeenCalledWith({
        where: {
          lineKey_parserVersion: { lineKey: '2 eggs and toast', parserVersion: SEG_PARSER_VERSION },
        },
        create: {
          lineKey: '2 eggs and toast',
          parserVersion: SEG_PARSER_VERSION,
          segmentsJson: validItems,
          lastUsedAt: expect.any(Date),
        },
        update: { segmentsJson: validItems, lastUsedAt: expect.any(Date) },
      });
    });

    test('fail-open: upsert throwing resolves quietly and skips the sweep counter', async () => {
      prisma.segmentationCache.upsert.mockRejectedValue(new Error('db down'));
      await expect(segCache.writeSegmentationCache('k', validItems as never)).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('write-through failed'),
        expect.any(Error),
      );
      expect(prisma.segmentationCache.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('opportunistic TTL sweep', () => {
    test(`sweeps expired rows exactly once per ${'TTL_SWEEP_EVERY_N_WRITES'} successful writes`, async () => {
      const n = segCache.TTL_SWEEP_EVERY_N_WRITES;
      for (let i = 0; i < n - 1; i++) {
        await segCache.writeSegmentationCache(`line ${i}`, validItems as never);
      }
      expect(prisma.segmentationCache.deleteMany).not.toHaveBeenCalled();

      await segCache.writeSegmentationCache('the nth line', validItems as never);
      expect(prisma.segmentationCache.deleteMany).toHaveBeenCalledTimes(1);

      const arg = prisma.segmentationCache.deleteMany.mock.calls[0][0];
      const cutoff: Date = arg.where.lastUsedAt.lt;
      const expectedCutoff = Date.now() - segCache.SEG_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
      expect(Math.abs(cutoff.getTime() - expectedCutoff)).toBeLessThan(60 * 1000);

      // counter reset: next write does not sweep again
      await segCache.writeSegmentationCache('one more', validItems as never);
      expect(prisma.segmentationCache.deleteMany).toHaveBeenCalledTimes(1);
    });

    test('fail-open: sweep errors are swallowed', async () => {
      prisma.segmentationCache.deleteMany.mockRejectedValue(new Error('sweep failed'));
      for (let i = 0; i < segCache.TTL_SWEEP_EVERY_N_WRITES; i++) {
        await segCache.writeSegmentationCache(`line ${i}`, validItems as never);
      }
      await flush();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('TTL sweep failed'), expect.any(Error));
    });
  });
});
