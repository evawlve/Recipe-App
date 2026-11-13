/**
 * _trailing-qty-replay.ts - PURE replay of foldTrailingQuantityClauses() over a seg driver TSV.
 *
 * Imports only the fold module, fs and the canonicalizer: no DB, no mapper, no network.
 *
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register \
 *     scripts/eval/_trailing-qty-replay.ts --in <driver.tsv> --out <folded.tsv> \
 *     [--pin-out <pin.json> [--folded]] [--pass trailing-qty|negated|both|fill|all] 2> fires.txt
 *
 * Input columns (tab-separated, no csv quoting):
 *   idx draw truth corpusVerdict status itemCount itemsJson ms line
 * itemsJson is [{"r":rawText,"n":normalizedForm,"b":brand}]. status=ok rows are folded with
 * lineKey = canonicalizeSegLine(line); other rows pass through. stderr gets one
 * `FIRE <idx>.<draw> <kind> "<before>" -> "<after>"` per fold, then the totals.
 * --pass (absent = trailing-qty, output byte-identical to before): `negated` applies
 * dropNegatedParts(); `both` = drop then fold, as the route does; `fill` applies fillRestaurantBrand()
 * alone (stderr `FIRE[fill] <idx>.<draw> "<item1 brand>" -> <n> items` per fired row, and the totals
 * line `rows=<n> fills=<f> rowsFired=<r>`); `all` = drop -> fold -> fill. Only when --pass is given do
 * FIRE lines carry the pass name (`FIRE[negated] ...`, `FIRE[trailing-qty] ...`).
 * --pin-out writes the S49 PinFile {createdAt, seedsPath, lines:[{line, items}]}; items are the
 * UNFOLDED split, or the folded one with --folded.
 */

import * as fs from 'fs';
import { foldTrailingQuantityClauses } from '../../src/lib/nlp/trailing-quantity-fold';
import { dropNegatedParts } from '../../src/lib/nlp/negated-part-drop';
import { fillRestaurantBrand } from '../../src/lib/nlp/restaurant-brand-fill';
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
  const pass = arg('--pass');
  if (pass !== undefined && !['trailing-qty', 'negated', 'both', 'fill', 'all'].includes(pass)) {
    console.error('--pass must be trailing-qty|negated|both|fill|all');
    process.exit(2);
  }
  const doNeg = pass === 'negated' || pass === 'both' || pass === 'all';
  const doFold = pass === undefined || pass === 'trailing-qty' || pass === 'both' || pass === 'all';
  const doFill = pass === 'fill' || pass === 'all';
  const useFolded = process.argv.includes('--folded');
  if (!inPath || !outPath) {
    console.error('usage: --in <driver.tsv> --out <tsv> [--pin-out <json> [--folded]] [--pass trailing-qty|negated|both|fill|all]');
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
  let fills = 0;

  for (const raw of lines.slice(1)) {
    const c = raw.split('\t');
    if (c.length < 9) { out.push(raw); continue; }
    const [idx, draw, truth, verdict, status, , itemsJson, ms] = c;
    const line = c.slice(8).join('\t');
    rows++;
    if (status !== 'ok') { out.push(raw); continue; }
    const parsed: Row[] = JSON.parse(itemsJson);
    const lineKey = canonicalizeSegLine(line);
    let cur = parsed.map(p => ({ rawText: p.r, normalizedForm: p.n, brand: p.b }));
    let fired = false;
    if (doNeg) {
      const np = dropNegatedParts(lineKey, cur);
      cur = np.items;
      for (const d of np.drops) {
        fired = true;
        fires++;
        console.error(`FIRE[negated] ${idx}.${draw} ${d.kind} "${d.rawText}"`);
      }
    }
    if (doFold) {
      const res = foldTrailingQuantityClauses(lineKey, cur);
      cur = res.items;
      for (const f of res.folds) {
        fired = true;
        fires++;
        console.error(`FIRE${pass === undefined ? '' : '[trailing-qty]'} ${idx}.${draw} ${f.kind} "${f.before}" -> "${f.after}"`);
      }
    }
    if (doFill) {
      const item1Brand = cur[0]?.brand ?? '';
      const bf = fillRestaurantBrand(cur);
      cur = bf.items;
      if (bf.fills > 0) {
        fired = true;
        fires++;
        fills += bf.fills;
        console.error(`FIRE[fill] ${idx}.${draw} "${item1Brand}" -> ${cur.length} items`);
      }
    }
    if (fired) rowsFired++;
    const folded: Row[] = cur.map(i => ({ r: i.rawText, n: i.normalizedForm ?? '', b: i.brand ?? '' }));
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
  if (pass === 'fill') console.error(`rows=${rows} fills=${fills} rowsFired=${rowsFired}`);
  else console.error(`rows=${rows} fires=${fires} rowsFired=${rowsFired}`);
}

main();
