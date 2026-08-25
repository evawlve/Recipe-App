/**
 * /api/nlp/parse `?stream=1` — the frame contract, and nothing else.
 *
 * WHY A STREAM. Items in one request already resolve in parallel and spread from ~0.2 s
 * (cache hit / gate-skipped) to ~7 s (an AI serving estimate); the one-shot JSON array
 * hides that spread behind the slowest line. The client's staged card can exist BEFORE
 * its food is known (mobile `status: 'resolving'`, 2026-08-24), so the route can now hand
 * cards over as each line lands. Contract owner: `plans/v1/magic-log-user-flow.md`
 * §Resolution states in the mobile repo; this module is the wire half of it.
 *
 * FRAMES, in order, as Server-Sent Events (`event: <type>` + `data: <json>`):
 *   segments  — ONCE, as soon as the split is known: one `{index, rawText, mealType}` per
 *               line. The client deals in `items.length` skeleton cards titled with the
 *               user's own words. Never emitted before segmentation finishes, because the
 *               count is unknown until then; a client-side heuristic pre-split is REFUSED
 *               (the AI split disagrees with heuristics on `X with Y` toppings and chain
 *               names containing `and`, so pre-dealt cards would re-shuffle).
 *   item      — N times, in RESOLUTION order, not input order. `index` addresses the
 *               segment; `item` is byte-for-byte the element the one-shot array would
 *               have carried at that index (same builder, same fields, same debug echo).
 *   done      — ONCE, after every item and after the request's own bookkeeping
 *               (MappingEventLog, the rate-limit charge). Carries `count` and the
 *               `X-Write-Receipt` body under `receipt` (the header cannot ride a streamed
 *               body: headers are sent before the first frame and the receipt is read
 *               after the last item). `receipt` is `null` unless the request was
 *               `nosave=1`, exactly as the header is absent then.
 *   error     — INSTEAD of `done` when the pipeline throws mid-stream. The HTTP status is
 *               already 200 by then; this frame is the 500 the one-shot path would have
 *               sent. A client must treat a stream that closes without `done` as failed.
 *
 * WHAT THE STREAM DOES NOT CHANGE. Auth, rate limiting (count AND charge), `nosave`,
 * `nocache`, `debug`, the write-policy scope, MappingEventLog, the segmentation cache —
 * every one of them runs the same code in the same order; the stream only changes WHEN
 * the bytes leave. The default one-shot response is untouched, so installed builds keep
 * working. SSE over NDJSON because it is the framing proxies (the Tailscale Funnel in
 * front of the box) are least likely to buffer; whether the Funnel flushes per frame is
 * UNVERIFIED until the first deployed probe — a correct client is correct either way,
 * because the frames are the same bytes in the same order whether they arrive in one
 * burst or six.
 */

import type { WriteReceipt } from '@/lib/write-policy';

export type ParseStreamSegment = {
  index: number;
  rawText: string;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snacks';
};

export type ParseStreamFrame =
  | { type: 'segments'; items: ParseStreamSegment[] }
  | { type: 'item'; index: number; item: unknown }
  | { type: 'done'; count: number; receipt: WriteReceipt | null }
  | { type: 'error'; message: string };

export type ParseStreamSink = (frame: ParseStreamFrame) => void;

/** Response headers for the streamed variant. `no-transform` + `X-Accel-Buffering` ask
 *  every proxy on the path not to buffer; `Content-Type` is what makes it SSE. */
export const PARSE_STREAM_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
});

/**
 * One SSE event. `data` is a single JSON line — the frame object itself, `type` included,
 * so a client may parse `data` alone and ignore the `event:` line. A newline inside the
 * JSON cannot occur (JSON.stringify escapes them), which is what keeps the `\n\n`
 * terminator unambiguous.
 */
export function encodeSseFrame(frame: ParseStreamFrame): string {
  return `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`;
}

/**
 * Split a chunk of SSE text into frames. The test-side half of `encodeSseFrame()` — the
 * mobile client carries its own copy of this logic (`src/lib/parse-stream-client.ts`),
 * because the two repos share no code. `rest` is the unterminated tail to prepend to the
 * next chunk. Only the `data:` line is read; `event:` is decoration.
 */
export function decodeSseFrames(text: string): { frames: ParseStreamFrame[]; rest: string } {
  const frames: ParseStreamFrame[] = [];
  let rest = text;
  for (;;) {
    const end = rest.indexOf('\n\n');
    if (end < 0) break;
    const block = rest.slice(0, end);
    rest = rest.slice(end + 2);
    const dataLine = block.split('\n').find((line) => line.startsWith('data:'));
    if (!dataLine) continue;
    frames.push(JSON.parse(dataLine.slice('data:'.length).trim()) as ParseStreamFrame);
  }
  return { frames, rest };
}
