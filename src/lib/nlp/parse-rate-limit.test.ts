import {
  FREE_FUNNEL_STAGES,
  NLP_PARSE_LIMIT_PER_DAY_DEFAULT,
  NLP_PARSE_LIMIT_PER_MINUTE_DEFAULT,
  isFreeParseRequest,
  parseLimitEnv,
  readParseLimits,
} from './parse-rate-limit';

describe('parseLimitEnv', () => {
  test('a positive integer is taken as-is (whitespace tolerated)', () => {
    expect(parseLimitEnv('10', 3)).toBe(10);
    expect(parseLimitEnv(' 25 ', 3)).toBe(25);
    expect(parseLimitEnv('1', 3)).toBe(1);
  });

  test.each([
    [undefined], [null], [''], ['   '], ['abc'], ['0'], ['-5'], ['1.5'], ['5x'], ['0x10'], ['1e3'],
  ])('%p falls back to the default', (raw) => {
    expect(parseLimitEnv(raw as string | null | undefined, 7)).toBe(7);
  });
});

describe('readParseLimits', () => {
  const savedMinute = process.env.NLP_PARSE_LIMIT_PER_MINUTE;
  const savedDay = process.env.NLP_PARSE_LIMIT_PER_DAY;

  afterEach(() => {
    if (savedMinute === undefined) delete process.env.NLP_PARSE_LIMIT_PER_MINUTE;
    else process.env.NLP_PARSE_LIMIT_PER_MINUTE = savedMinute;
    if (savedDay === undefined) delete process.env.NLP_PARSE_LIMIT_PER_DAY;
    else process.env.NLP_PARSE_LIMIT_PER_DAY = savedDay;
  });

  test('defaults are 10/min and 100/day when the env is absent', () => {
    delete process.env.NLP_PARSE_LIMIT_PER_MINUTE;
    delete process.env.NLP_PARSE_LIMIT_PER_DAY;
    expect(readParseLimits()).toEqual({ perMinute: 10, perDay: 100 });
    expect(NLP_PARSE_LIMIT_PER_MINUTE_DEFAULT).toBe(10);
    expect(NLP_PARSE_LIMIT_PER_DAY_DEFAULT).toBe(100);
  });

  test('reads the env PER CALL — a change is seen on the next read, no restart of the module', () => {
    process.env.NLP_PARSE_LIMIT_PER_MINUTE = '2';
    process.env.NLP_PARSE_LIMIT_PER_DAY = '30';
    expect(readParseLimits()).toEqual({ perMinute: 2, perDay: 30 });
    process.env.NLP_PARSE_LIMIT_PER_MINUTE = '4';
    expect(readParseLimits().perMinute).toBe(4);
  });

  test('a bad value on one var falls back without touching the other', () => {
    process.env.NLP_PARSE_LIMIT_PER_MINUTE = 'abc';
    process.env.NLP_PARSE_LIMIT_PER_DAY = '50';
    expect(readParseLimits()).toEqual({ perMinute: 10, perDay: 50 });
  });
});

describe('isFreeParseRequest', () => {
  test('the free set is exactly cache_hit and fast_path', () => {
    expect([...FREE_FUNNEL_STAGES].sort()).toEqual(['cache_hit', 'fast_path']);
  });

  test('every line a cache hit, no AI split → free', () => {
    expect(isFreeParseRequest({ funnelStages: ['cache_hit', 'cache_hit'], segCacheHit: null })).toBe(true);
    expect(isFreeParseRequest({ funnelStages: ['cache_hit', 'fast_path'], segCacheHit: true })).toBe(true);
  });

  test('an empty request is free', () => {
    expect(isFreeParseRequest({ funnelStages: [], segCacheHit: null })).toBe(true);
  });

  test('one paid line charges the whole request', () => {
    expect(isFreeParseRequest({ funnelStages: ['cache_hit', 'saved'], segCacheHit: null })).toBe(false);
    for (const stage of ['saved', 'under_gate', 'save_rejected', 'no_match', 'no_candidates', 'all_filtered', 'error']) {
      expect(isFreeParseRequest({ funnelStages: [stage], segCacheHit: null })).toBe(false);
    }
  });

  test('an unclassified line (no stage) is charged', () => {
    expect(isFreeParseRequest({ funnelStages: [undefined], segCacheHit: null })).toBe(false);
    expect(isFreeParseRequest({ funnelStages: [null], segCacheHit: null })).toBe(false);
    expect(isFreeParseRequest({ funnelStages: ['cache_hit', undefined], segCacheHit: null })).toBe(false);
  });

  test('an AI segmentation call (segCacheHit === false) is charged even when every line was cached', () => {
    expect(isFreeParseRequest({ funnelStages: ['cache_hit', 'cache_hit'], segCacheHit: false })).toBe(false);
  });
});
