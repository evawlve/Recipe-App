/**
 * _trailing-qty-replay.ts - PURE replay of foldTrailingQuantityClauses() over a seg driver TSV.
 *
 * Imports only the fold module, fs and the canonicalizer: no DB, no mapper, no network.
 *
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register \
 *     scripts/eval/_trailing-qty-replay.ts --in <driver.tsv> --out <folded.tsv> \
 *     [--pin-out <pin.json> [--folded]] 2> fires.txt
 *
 * Input columns (tab-separated, no csv quoting):
 *   idx draw truth corpusVerdict status itemCount itemsJson ms line
 * itemsJson is [{"r":rawText,"n":normalizedForm,"b":brand}]. status=ok rows are folded with
 * lineKey = canonicalizeSegLine(line); other rows pass through. stderr gets one
 * `FIRE <idx>.<draw> <kind> "<before>" -> "<after>"` per fold, then the totals.
 * --pin-out writes the S49 PinFile {createdAt, seedsPath, lines:[{line, items}]}; items are the
 * UNFOLDED split, or the folded one with --folded.
 */

import * as fs from 'fs';
import { foldTrailingQuantityClauses } from '../../src/lib/nlp/trailing-quantity-fold';
import { canonicalizeSegLine } from '../../src/lib/nlp/seg-line-key';

type Row = { r: string; n: string; b: string };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const inPath = arg('--in');
  const outPath = arg('--out');
  const pinOut = arg('--pin-out');
  const useFolded = process.argv.includes('--folded');
  if (!inPath || !outPath) {
    console.error('usage: --in <driver.tsv> --out <tsv> [--pin-out <json> [--folded]]');
    process.exit(2);
  }
  const lines = fs.readFileSync(inPath, 'utf8').split('\n').filter(l => l.length > 0);
  const header = lines[0];
  const out: string[] = [header];
  const pinLines: Array<{ line: string; items: Array<{ rawText: string; normalizedForm: string; brand: string }> }> = [];
  const seenPin = new Set<string>();
  let rows = 0;
  let fires = 0;
  let rowsFired = 0;

  for (const raw of lines.slice(1)) {
    const c = raw.split('\t');
    if (c.length < 9) { out.push(raw); continue; }
    const [idx, draw, truth, verdict, status, , itemsJson, ms] = c;
    const line = c.slice(8).join('\t');
    rows++;
    if (status !== 'ok') { out.push(raw); continue; }
    const parsed: Row[] = JSON.parse(itemsJson);
    const res = foldTrailingQuantityClauses(
      canonicalizeSegLine(line),
      parsed.map(p => ({ rawText: p.r, normalizedForm: p.n, brand: p.b })),
    );
    if (res.folds.length > 0) {
      rowsFired++;
      for (const f of res.folds) {
        fires++;
        console.error(`FIRE ${idx}.${draw} ${f.kind} "${f.before}" -> "${f.after}"`);
      }
    }
    const folded: Row[] = res.items.map(i => ({ r: i.rawText, n: i.normalizedForm ?? '', b: i.brand ?? '' }));
    out.push([idx, draw, truth, verdict, status, String(folded.length), JSON.stringify(folded), ms, line].join('\t'));
    if (pinOut) {
      const items = useFolded ? folded : parsed;
      const key = `${line}\u0000${JSON.stringify(items)}`;
      if (!seenPin.has(key)) {
        seenPin.add(key);
        pinLines.push({ line, items: items.map(i => ({ rawText: i.r, normalizedForm: i.n, brand: i.b })) });
      }
    }
  }
  fs.writeFileSync(outPath, out.join('\n') + '\n');
  if (pinOut) {
    fs.writeFileSync(
      pinOut,
      JSON.stringify({ createdAt: new Date().toISOString(), seedsPath: inPath, lines: pinLines }, null, 2) + '\n',
    );
  }
  console.error(`rows=${rows} fires=${fires} rowsFired=${rowsFired}`);
}

main();
