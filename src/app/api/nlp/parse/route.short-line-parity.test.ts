/**
 * /api/nlp/parse — the short-line fast path, pinned against the MOBILE client's copy of it.
 *
 * `singleItemFromText()` in ./route.ts decides whether a line skips the segmenter (≤ 60 chars
 * after trim, a trailing `for|at|as <meal>` suffix stripped, none of `,;\n+&` or the words
 * `and|with|plus`, ≤ 6 words). The mobile client mirrors that rule as `isShortLine()` in
 * `src/lib/magic-flow-timing.ts` (KindaHealthyMobile) to decide whether the ADD TO chips wave
 * once or loop while the parse reads (punch #278, Lane E S48).
 *
 * SHORT_LINE_FIXTURES below is a VERBATIM COPY of the table of the same name in mobile
 * `src/components/food-log/__tests__/meal-slot-row-nudge.test.tsx` (26 rows,
 * `[name, text, short]`). The backend cannot import the mobile repo, so the two tables MUST
 * CHANGE TOGETHER: a change to either rule, or to either table, lands in both repos in the
 * same session. `short` is the mobile fixture's claim that `singleItemFromText()` returns
 * non-null for `text`.
 *
 * `singleItemFromText()` is module-private and a Next route module may export only handlers
 * and config, so this drives POST and reads the observable the function controls: the fast
 * path answers 200 with exactly one item and never reaches the segmentation branch (no
 * SegmentationCache read, no `parse` LLM call); every other line reaches that branch. The
 * `empty` row never reaches `singleItemFromText()` at all — the route's own 400 guard on a
 * falsy `text` answers first — which is still "not the fast path", the row's claim.
 *
 * Harness: the same mocks as route.seg-cache.test.ts (prisma, structured-client, mapper,
 * resolve-payload); the segmentation-cache module, canonicalizer and ai-segmenter run real.
 */

import { NextRequest } from 'next/server';
import { POST } from './route';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: { getUser: jest.fn() } })),
}));

jest.mock('@/lib/db', () => ({
  prisma: {
    nlpRequestLog: { count: jest.fn(), create: jest.fn() },
    mappingEventLog: { createMany: jest.fn() },
    segmentationCache: {
      findUnique: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/ai/structured-client', () => ({
  callStructuredLlm: jest.fn(),
}));

jest.mock('@/lib/mapping/map-ingredient-with-fallback', () => ({
  mapIngredientWithFallback: jest.fn().mockResolvedValue({ status: 'no_match' }),
}));

jest.mock('@/lib/nlp/resolve-payload', () => ({
  resolveFoodDetails: jest.fn(),
}));

// ---------------------------------------------------------------------------------------------
// VERBATIM from mobile `src/components/food-log/__tests__/meal-slot-row-nudge.test.tsx`
// (Lane E S48). Change both together — see the header.
const SHORT_LINE_FIXTURES: [name: string, text: string, short: boolean][] = [
  ['a plain short line', 'one banana', true],
  ['a NEWLINE is a separator', '2 eggs\ntoast', false],
  ['61 chars — its suffix would bring it to 47, but length is tested BEFORE the suffix comes off', 'blueberry cream cheese bagels toasted perfectly for breakfast', false],
  ['a `for snack.` suffix (singular, full stop) — 8 words with it, 6 once it comes off', 'a small bowl of plain yogurt for snack.', true],
  ['7 words, no separator', 'overnight oats almond butter chia seeds banana', false],
  ['6 words with `with`', 'coffee with oat milk no sugar', false],
  ['exactly 6 words', 'large iced oat milk vanilla latte', true],
  ['exactly 60 characters', `${'a'.repeat(58)} b`, true],
  ['`and` inside a word is not the word `and`', 'turkey sandwich', true],
  ['`&` is a separator', 'mac & cheese', false],
  ['the sitting’s long line', '2 eggs, toast and a flat white', false],
  ['a meal suffix and nothing else', 'for lunch', false],
  ['a short line inside surrounding whitespace', '   one banana   ', true],
  ['empty', '', false],
  ['7 words — loops even when `SegmentationCache` answers', '16.4 ounces of Real good chicken tenders', false],
  // The S48 refuter lens mutated each backend rule in turn; these eleven are the rules the fifteen
  // above left undiscriminated (all eleven evaluated on the backend's own function, S48).
  ['6 words inside surrounding whitespace — the TRIM is what keeps it at 6', '  a b c d e f  ', true],
  ['`;` is a separator', 'eggs; toast', false],
  ['`+` is a separator', 'eggs + toast', false],
  ['`,` is a separator', 'eggs toast, jam', false],
  ['the word `and`', 'eggs and toast', false],
  ['the word `plus`', 'bagel plus jam', false],
  ['`AND` in capitals — the signals are case-blind', 'Eggs AND toast', false],
  ['`FOR LUNCH` in capitals — so is the suffix', 'a b c d e f FOR LUNCH', true],
  ['an `at dinner` suffix', 'a b c d e f at dinner', true],
  ['an `as breakfast` suffix', 'a b c d e f as breakfast', true],
  ['a suffix MID-line is not a suffix — it is anchored at the end', 'a b c d e for lunch f', false],
];
// ---------------------------------------------------------------------------------------------

function parseRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/nlp/parse', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': 'test-dev-key-short-line', // dev bypass: skips Supabase auth + rate limiting
    },
    body: JSON.stringify(body),
  });
}

describe('/api/nlp/parse short-line fast path — parity with mobile SHORT_LINE_FIXTURES', () => {
  const { prisma } = require('@/lib/db');
  const { callStructuredLlm } = require('@/lib/ai/structured-client');

  beforeAll(() => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
    process.env.DEV_API_KEY = 'test-dev-key-short-line';
    delete process.env.MAPPING_EVENT_LOG_ENABLED;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    prisma.segmentationCache.findUnique.mockResolvedValue(null);
    prisma.segmentationCache.update.mockResolvedValue({});
    prisma.segmentationCache.upsert.mockResolvedValue({});
    prisma.mappingEventLog.createMany.mockResolvedValue({ count: 0 });
    callStructuredLlm.mockResolvedValue({
      status: 'success',
      content: { items: [{ rawText: 'x', mealType: 'snacks', brand: '', normalizedForm: 'x' }] },
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('carries all 26 rows of the mobile table', () => {
    expect(SHORT_LINE_FIXTURES).toHaveLength(26);
  });

  it.each(SHORT_LINE_FIXTURES)('%s', async (_name, text, short) => {
    const response = await POST(parseRequest({ text }));
    const segmentationBranch =
      prisma.segmentationCache.findUnique.mock.calls.length > 0 ||
      callStructuredLlm.mock.calls.some(([arg]: [{ purpose?: string }]) => arg?.purpose === 'parse');
    const fastPath = response.status === 200 && !segmentationBranch;

    expect(fastPath).toBe(short);

    if (short) {
      // The fast path hands the mapper exactly one line.
      expect(await response.json()).toHaveLength(1);
    } else if (text !== '') {
      // A non-short line did reach the segmenter (cache read, then the LLM on a miss) — not
      // some other failure that merely looks like "not the fast path".
      expect(response.status).toBe(200);
      expect(prisma.segmentationCache.findUnique).toHaveBeenCalledTimes(1);
      expect(callStructuredLlm).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'parse' }));
    }
  });
});
