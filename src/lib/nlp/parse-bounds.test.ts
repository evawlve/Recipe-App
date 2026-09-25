/**
 * parse-bounds.ts — each bound at N (admitted) and N+1 (refused), the user copy as an exact
 * string, and the shapes the route's existing 400 keeps.
 */
import {
  MAX_PARSE_TEXT_CHARS,
  MAX_PARSE_ITEMS,
  MAX_PARSE_ITEM_CHARS,
  MAX_SEGMENTED_ITEMS,
  MAX_PARSE_BODY_BYTES,
  PARSE_TOO_LARGE_MESSAGE,
  checkParseBounds,
  contentLengthTooLarge,
  readBodyTextWithin,
  capSegmentedItems,
} from './parse-bounds';

const REFUSED = { status: 413, error: PARSE_TOO_LARGE_MESSAGE };

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

describe('parse-bounds: the numbers', () => {
  test('are the ones the report derives', () => {
    expect(MAX_PARSE_TEXT_CHARS).toBe(1000);
    expect(MAX_PARSE_ITEMS).toBe(30);
    expect(MAX_PARSE_ITEM_CHARS).toBe(200);
    expect(MAX_SEGMENTED_ITEMS).toBe(30);
    expect(MAX_PARSE_BODY_BYTES).toBe(32 * 1024);
  });

  test('the 413 copy is user-facing and pinned byte for byte', () => {
    expect(PARSE_TOO_LARGE_MESSAGE).toBe('That log is too long — up to 1,000 characters or 30 foods at a time.');
  });

  test('the byte cap admits the largest body the char bounds admit (30 x 200 three-byte chars)', () => {
    const items = Array.from({ length: MAX_PARSE_ITEMS }, () => ({
      rawText: '食'.repeat(MAX_PARSE_ITEM_CHARS),
      mealType: 'breakfast',
      brand: '',
      normalizedForm: '',
    }));
    const bytes = new TextEncoder().encode(JSON.stringify({ items })).byteLength;
    expect(checkParseBounds({ items })).toBeNull();
    expect(bytes).toBeLessThanOrEqual(MAX_PARSE_BODY_BYTES);
  });
});

describe('checkParseBounds', () => {
  test('text: N chars admitted, N+1 refused', () => {
    expect(checkParseBounds({ text: 'a'.repeat(MAX_PARSE_TEXT_CHARS) })).toBeNull();
    expect(checkParseBounds({ text: 'a'.repeat(MAX_PARSE_TEXT_CHARS + 1) })).toEqual(REFUSED);
  });

  test('items: N items admitted, N+1 refused', () => {
    expect(checkParseBounds({ items: Array(MAX_PARSE_ITEMS).fill('egg') })).toBeNull();
    expect(checkParseBounds({ items: Array(MAX_PARSE_ITEMS + 1).fill('egg') })).toEqual(REFUSED);
  });

  test('items[].rawText: N chars admitted, N+1 refused — string form and object form alike', () => {
    const ok = 'a'.repeat(MAX_PARSE_ITEM_CHARS);
    const long = 'a'.repeat(MAX_PARSE_ITEM_CHARS + 1);
    expect(checkParseBounds({ items: [ok] })).toBeNull();
    expect(checkParseBounds({ items: [{ rawText: ok }] })).toBeNull();
    expect(checkParseBounds({ items: [long] })).toEqual(REFUSED);
    expect(checkParseBounds({ items: ['egg', { rawText: long, mealType: 'lunch' }] })).toEqual(REFUSED);
  });

  test('an oversized text is refused even beside a valid items array', () => {
    expect(checkParseBounds({ items: ['egg'], text: 'a'.repeat(MAX_PARSE_TEXT_CHARS + 1) })).toEqual(REFUSED);
  });

  test('shapes the route answers 400 are not this check\'s business: null', () => {
    expect(checkParseBounds({})).toBeNull();
    expect(checkParseBounds({ text: 5 })).toBeNull();
    expect(checkParseBounds({ items: 'not an array' })).toBeNull();
    expect(checkParseBounds(null)).toBeNull();
    expect(checkParseBounds('text')).toBeNull();
  });

  test('items without a string rawText are left to the route (it drops them)', () => {
    expect(checkParseBounds({ items: [null, 5, { rawText: 7 }, {}] })).toBeNull();
  });
});

describe('contentLengthTooLarge', () => {
  test('N bytes admitted, N+1 refused', () => {
    expect(contentLengthTooLarge(String(MAX_PARSE_BODY_BYTES))).toBe(false);
    expect(contentLengthTooLarge(String(MAX_PARSE_BODY_BYTES + 1))).toBe(true);
  });

  test('absent or unparseable → false (the bounded read is the backstop)', () => {
    expect(contentLengthTooLarge(null)).toBe(false);
    expect(contentLengthTooLarge('abc')).toBe(false);
  });
});

describe('readBodyTextWithin', () => {
  test('N bytes read whole, across chunks', async () => {
    await expect(readBodyTextWithin(streamOf('ab', 'cd'), 4)).resolves.toBe('abcd');
  });

  test('N+1 bytes → null', async () => {
    await expect(readBodyTextWithin(streamOf('ab', 'cde'), 4)).resolves.toBeNull();
  });

  test('counts BYTES, not characters, and decodes UTF-8 split across chunks', async () => {
    const bytes = new TextEncoder().encode('é'); // 2 bytes
    const split = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(bytes.slice(0, 1)); c.enqueue(bytes.slice(1)); c.close(); },
    });
    await expect(readBodyTextWithin(split, 2)).resolves.toBe('é');
    await expect(readBodyTextWithin(streamOf('é'), 1)).resolves.toBeNull();
  });

  test('no body → empty string (JSON.parse then throws, as req.json() did)', async () => {
    await expect(readBodyTextWithin(null, 10)).resolves.toBe('');
  });
});

describe('capSegmentedItems', () => {
  test('N kept whole, N+1 sliced to N with the drop counted', () => {
    const n = Array.from({ length: MAX_SEGMENTED_ITEMS }, (_, i) => i);
    expect(capSegmentedItems(n)).toEqual({ items: n, dropped: 0 });
    const over = Array.from({ length: MAX_SEGMENTED_ITEMS + 1 }, (_, i) => i);
    const capped = capSegmentedItems(over);
    expect(capped.items).toEqual(n);
    expect(capped.dropped).toBe(1);
  });
});
