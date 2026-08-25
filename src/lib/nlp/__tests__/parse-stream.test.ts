/**
 * The SSE frame codec behind /api/nlp/parse?stream=1 (src/lib/nlp/parse-stream.ts).
 *
 * Pins the two properties a streaming client depends on: a frame round-trips through
 * `encode` → `decode` unchanged, and a decoder fed arbitrary chunk boundaries — one byte
 * at a time, or six frames in one burst — yields the same frame sequence with the
 * unterminated tail carried in `rest`. The mobile client re-implements `decodeSseFrames`
 * (the repos share no code); this is the reference behaviour it is checked against.
 */

import { decodeSseFrames, encodeSseFrame, type ParseStreamFrame } from '../parse-stream';

const FRAMES: ParseStreamFrame[] = [
  { type: 'segments', items: [{ index: 0, rawText: '2 eggs', mealType: 'breakfast' }, { index: 1, rawText: 'toast with butter', mealType: 'breakfast' }] },
  { type: 'item', index: 1, item: { rawText: 'toast with butter', foodName: 'Toast', grams: 30, note: 'line\nbreak "quoted"' } },
  { type: 'item', index: 0, item: { rawText: '2 eggs', foodName: 'Egg', grams: 100 } },
  { type: 'done', count: 2, receipt: null },
];

describe('parse-stream SSE codec', () => {
  test('a frame is one `event:` line, one `data:` line and a blank line', () => {
    const wire = encodeSseFrame(FRAMES[3]);
    expect(wire).toBe('event: done\ndata: {"type":"done","count":2,"receipt":null}\n\n');
  });

  test('encode → decode round-trips every frame type, including strings with newlines', () => {
    const wire = FRAMES.map(encodeSseFrame).join('');
    const { frames, rest } = decodeSseFrames(wire);
    expect(frames).toEqual(FRAMES);
    expect(rest).toBe('');
  });

  test('chunk boundaries do not matter: byte-at-a-time yields the same frames as one burst', () => {
    const wire = FRAMES.map(encodeSseFrame).join('');
    const got: ParseStreamFrame[] = [];
    let buffer = '';
    for (const ch of wire) {
      buffer += ch;
      const { frames, rest } = decodeSseFrames(buffer);
      got.push(...frames);
      buffer = rest;
    }
    expect(got).toEqual(FRAMES);
    expect(buffer).toBe('');
  });

  test('an unterminated tail is returned as `rest`, not parsed and not lost', () => {
    const wire = encodeSseFrame(FRAMES[0]) + 'event: item\ndata: {"type":"item","index":0,';
    const { frames, rest } = decodeSseFrames(wire);
    expect(frames).toEqual([FRAMES[0]]);
    expect(rest).toBe('event: item\ndata: {"type":"item","index":0,');
  });

  test('a block without a data line (a comment or keep-alive) is skipped', () => {
    const wire = ': keep-alive\n\n' + encodeSseFrame(FRAMES[3]);
    expect(decodeSseFrames(wire).frames).toEqual([FRAMES[3]]);
  });
});
