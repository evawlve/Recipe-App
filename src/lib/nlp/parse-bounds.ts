/**
 * /api/nlp/parse input bounds — how much ONE request may ask for (review H1, 2026-09-24).
 *
 * The per-user limiter (parse-rate-limit.ts) counts REQUESTS. Before these bounds a single
 * request could carry any number of lines, and every line runs the mapper concurrently —
 * retrieval, possibly model calls — so the allowance bought unbounded work. These are the
 * caps on one request. They sit AHEAD of the dev-key bypass in the route: a keyed caller
 * skips the limiter entirely, so these are the only cap it gets.
 *
 * Constants, never env: CI's `check` job fails on a new literal env read missing from
 * `.env.example`, and a bound nobody can loosen by accident is the point.
 *
 * THE NUMBERS (arithmetic in reports/2026-09-24_cloud-security-round-two.md §ROW 1). Each is
 * at least 3x the largest input anything in the repo sends today:
 *  - text: the longest line is 184 chars (the S51 arm driver's ten-food line), golden 176,
 *    Spanish 50. 1,000 is 5.4x.
 *  - items[]: every script posts exactly one item. 30 is 30x.
 *  - items[].rawText: the golden set's longest is 51 chars. 200 is 3.9x.
 *  - segmented: the S51 line splits into 10 items, the golden set expects at most 7. 30 is 3x
 *    (25 would have been 2.5x).
 *  - body bytes: 30 items x 200 UTF-16 units x 3 UTF-8 bytes = 18,000 bytes of rawText alone,
 *    so 16 KiB could refuse a body the char bounds admit; 32 KiB cannot.
 *
 * Lengths are JS `.length` (UTF-16 code units), which is what a React Native `maxLength`
 * counts too.
 */
export const MAX_PARSE_TEXT_CHARS = 1000;
export const MAX_PARSE_ITEMS = 30;
export const MAX_PARSE_ITEM_CHARS = 200;
export const MAX_SEGMENTED_ITEMS = 30;
export const MAX_PARSE_BODY_BYTES = 32 * 1024;

/**
 * USER-FACING COPY. The mobile client puts a non-2xx `error` string straight into
 * `Alert.alert('Parser Error', …)` and into `nlp_failures_log`, so this is what a person reads.
 */
export const PARSE_TOO_LARGE_MESSAGE =
  'That log is too long — up to 1,000 characters or 30 foods at a time.';

export interface ParseBoundsRefusal {
  status: 413;
  error: string;
}

const TOO_LARGE: ParseBoundsRefusal = { status: 413, error: PARSE_TOO_LARGE_MESSAGE };

/**
 * The `content-length` pre-check, before a byte is read. Absent or unparseable → false;
 * the bounded read (`readBodyTextWithin()`) is what catches a body sent without one.
 */
export function contentLengthTooLarge(header: string | null): boolean {
  if (header == null) return false;
  const n = Number(header);
  return Number.isFinite(n) && n > MAX_PARSE_BODY_BYTES;
}

/**
 * Read a request body as UTF-8 text, stopping at `maxBytes`. Returns null the moment the
 * total passes the cap (and cancels the stream), so a chunked body with no `content-length`
 * costs at most `maxBytes` of memory rather than whatever the caller sent.
 */
export async function readBodyTextWithin(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string | null> {
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

function itemRawText(item: unknown): string | null {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object' && 'rawText' in item) {
    const raw = (item as { rawText: unknown }).rawText;
    if (typeof raw === 'string') return raw;
  }
  return null;
}

/**
 * The 413 check on a parsed body. null = within bounds OR not this check's business: a
 * non-string `text` or a non-array `items` is left to the route's existing 400, so `{}` and
 * `{ text: 5 }` still read 400. Both fields are checked when both are present — the route
 * only reads one, but an oversized field is refused either way.
 */
export function checkParseBounds(body: unknown): ParseBoundsRefusal | null {
  if (!body || typeof body !== 'object') return null;
  const { text, items } = body as { text?: unknown; items?: unknown };
  if (typeof text === 'string' && text.length > MAX_PARSE_TEXT_CHARS) return TOO_LARGE;
  if (Array.isArray(items)) {
    if (items.length > MAX_PARSE_ITEMS) return TOO_LARGE;
    for (const item of items) {
      const raw = itemRawText(item);
      if (raw !== null && raw.length > MAX_PARSE_ITEM_CHARS) return TOO_LARGE;
    }
  }
  return null;
}

/**
 * The cap on what a segmentation may fan out to — a 1,000-char line can still split into
 * fifty items. Slices, never refuses: by the time the split is known the request has done
 * its work, and the first MAX_SEGMENTED_ITEMS lines are still the user's.
 */
export function capSegmentedItems<T>(items: T[]): { items: T[]; dropped: number } {
  if (items.length <= MAX_SEGMENTED_ITEMS) return { items, dropped: 0 };
  return { items: items.slice(0, MAX_SEGMENTED_ITEMS), dropped: items.length - MAX_SEGMENTED_ITEMS };
}
