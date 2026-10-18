/**
 * self-correction.ts - a spoken self-correction bills the corrected value, not both.
 *
 * MECHANISM. "four pancakes, wait no, three pancakes" / "a large pizza but i only had two slices": the
 * segmenter emits the first reading AND the correction as separate items, so the line bills both (seven
 * pancakes). Diego's ruling (the narrowed cut, 2026-10-17): the correction wins, but a DIFFERENT food after a
 * correction word replaces the previous item ONLY after `make that` / `make it` / `scratch that` / `wait no` /
 * `no wait` / a lone `no` comma piece. A weaker word (`actually`, `sorry`, `i mean`, `more like`) corrects a
 * quantity, restates the same food or swaps a part, but never swaps one food for another.
 * The weak markers also include `no i mean`, `oh wait i mean`, `wait i mean`, `oh wait`, `i meant` and `correction`:
 * `no i mean` left the `no` as an impure gap word (so both values billed), and `correction` was absent.
 *
 * KINDS (each correction names the ORIGINAL index of the item it acted on).
 * - qty: a quantity-only item after the marker ("a bagel, actually make that two") rewrites the previous item's
 *   number ("2 bagel"); the quantity item goes.
 * - qty-on-qty: the previous item is itself quantity-only ("two of them" then "three") - its number is rebuilt.
 * - restate-qty: the same head noun again with a quantity ("pizza ... actually 2 slices of pizza").
 * - restate-replace: the same head noun again with other words - the earlier item goes.
 * - part: j's head noun (or its on / with / in phrase) sits in an earlier item's modifier phrase - the phrase is
 *   replaced ("a latte with whole milk, make it oat milk").
 * - swap: a different food after an explicit replacement marker - the earlier item goes.
 * - trailing: the marker follows the last item ("two eggs, three eggs, actually").
 *
 * GUARDS. The gap between the two items must be a pure marker gap (no leftover words, no addition word such as
 * also / too / plus / another / extra / forgot / again / more, no `and`); a negated j ("no pickles") is left to
 * the negated-part drop (row 3); a size-word j ("make it a double") is never a replacer unless quantity-only;
 * a dish that carries an on / with / in phrase is never swapped away; a determiner-led earlier item needs a
 * determiner-led (or branded) correction; the earlier item's brand carries to the correction only for a
 * restaurant chain (isRestaurantChain(), the brand fill's gate), so "a coke -> a pepsi" is not Coca-Cola.
 *
 * PASS ORDER. Runs FIRST (correction, drop, dish, drink, fold, fill): a corrected quantity must exist before
 * the trailing-quantity fold reads it, and a restated item must be gone before the dish and drink passes count
 * parts. The SegmentationCache keeps the uncorrected split.
 *
 * An addition is not a correction: an ADD word or `as well` the segmenter stripped out of j (`a ham sandwich too`) still
 * keeps j, and in the trailing block two items joined by `and` in one comma piece are two foods.
 *
 * Pure; never mutates its input (items are copied before any write).
 */

import { isRestaurantChain } from './restaurant-brand-fill';
import {
  parseClause,
  sameWord,
  tokenizeWithPieces,
  words,
  type Clause,
  type Tok,
} from './trailing-quantity-fold';
import { parseIngredientLine } from '@/lib/parse/ingredient-line';

export interface SelfCorrection {
  kind: 'qty' | 'qty-on-qty' | 'restate-qty' | 'restate-replace' | 'part' | 'swap' | 'trailing';
  /** Index in the ORIGINAL input array of the item the correction acted on. */
  index: number;
  /** That item's rawText before the correction. */
  before: string;
  /** Its rawText after the correction ('' when the item was dropped). */
  after: string;
}

interface Item {
  rawText: string;
  normalizedForm?: string;
  brand?: string;
}

const TAILOF_WORDS = new Set(['them', 'those', 'these', 'it', 'that']);
const HEAD_STOP = new Set(['with', 'and', 'in', 'on', 'over', 'topped', 'plus']);
const PREPS = new Set(['on', 'with', 'in']);
const STRONG = [
  'wait no', 'no wait', 'scratch that', 'make that', 'make it', 'i mean', 'well actually', 'actually', 'sorry',
  'more like', 'but i only had', 'i only had',
  'no i mean', 'oh wait i mean', 'wait i mean', 'oh wait', 'i meant', 'correction',
].map(m => m.split(' '));
const SWAP_OK = new Set(['wait no', 'no wait', 'scratch that', 'make that', 'make it', '<no>']);
const ADD = new Set(['also', 'too', 'plus', 'another', 'extra', 'forgot', 'again', 'more']);
const SIZE_J = new Set([
  'double', 'triple', 'single', 'large', 'small', 'medium', 'big', 'regular', 'one', 'another', 'refill', 'grande',
  'venti', 'tall',
]);
const NEGSTART = [['no'], ['without'], ['minus'], ['except'], ['hold', 'the'], ['skip', 'the']];
const FILLER = new Set(['and', 'oh', 'um', 'uh', 'ok', 'okay', 'well']);

const fmt = (v: number): string => (v === 0.5 ? '1/2' : String(v));

function headOf(item: Item): string | null {
  const src = item.normalizedForm && item.normalizedForm.trim()
    ? item.normalizedForm
    : item.rawText.replace(/^\s*(the|a|an|some)\s+/i, '');
  const ph: string[] = [];
  for (const w of words(src.split(/[,;]/)[0])) {
    if (HEAD_STOP.has(w)) break;
    ph.push(w);
  }
  return ph.length ? ph[ph.length - 1] : null;
}

function spansOf(toks: Tok[], items: Item[]): Array<{ start: number; end: number } | null> {
  const spans: Array<{ start: number; end: number } | null> = [];
  let cursor = 0;
  for (const it of items) {
    const w = words(it.rawText);
    let f: { start: number; end: number } | null = null;
    if (w.length) {
      for (let s = cursor; s + w.length <= toks.length; s++) {
        let ok = true;
        for (let k = 0; k < w.length; k++) {
          if (toks[s + k].w !== w[k]) {
            ok = false;
            break;
          }
        }
        if (ok) {
          f = { start: s, end: s + w.length };
          break;
        }
      }
    }
    spans.push(f);
    if (f) cursor = f.end;
  }
  return spans;
}

/** An item's food minus its own leading quantity and article. */
function foodMinusQty(raw: string): string {
  const c = parseClause(words(raw));
  if (c && c.food.length) return c.food.join(' ');
  try {
    const p = parseIngredientLine(raw.replace(/^\s*(a|an)\s+(?=\d)/i, ''));
    if (p && p.name) return p.name.replace(/^\s*(a|an|the|some)\s+/i, '');
  } catch {
    // fall through to the plain strip
  }
  return raw.replace(/^\s*(a|an|the|some)\s+/i, '');
}

const rewriteQ = (c: Clause, food: string): string =>
  c.unit ? `${fmt(c.value)} ${c.unit} of ${food}` : `${fmt(c.value)} ${food}`;

function markersIn(gap: Tok[], list: string[][]): { found: string[]; covered: Set<number> } {
  const found: string[] = [];
  const covered = new Set<number>();
  for (const m of list) {
    for (let s = 0; s + m.length <= gap.length; s++) {
      if (m.every((w, k) => gap[s + k].w === w)) {
        found.push(m.join(' '));
        for (let k = 0; k < m.length; k++) covered.add(s + k);
      }
    }
  }
  // a comma piece that is exactly `no`
  const byPiece = new Map<number, number[]>();
  gap.forEach((t, k) => {
    const a = byPiece.get(t.piece) ?? [];
    a.push(k);
    byPiece.set(t.piece, a);
  });
  for (const [, ks] of byPiece) {
    if (ks.length === 1 && gap[ks[0]].w === 'no') {
      found.push('<no>');
      covered.add(ks[0]);
    }
  }
  return { found, covered };
}

export function resolveSelfCorrections<T extends Item>(
  lineKey: string,
  input: T[],
): { items: T[]; corrections: SelfCorrection[] } {
  const items: T[] = input.slice();
  const corrections: SelfCorrection[] = [];
  const n = items.length;
  if (n < 2) return { items, corrections };
  const toks = tokenizeWithPieces(lineKey);
  const spans = spansOf(toks, items);
  const removed = new Set<number>();
  const rew = new Map<number, T>();
  const cur = (k: number): T => rew.get(k) ?? items[k];
  const prevEnd = (j: number): number => {
    for (let k = j - 1; k >= 0; k--) if (spans[k]) return spans[k]!.end;
    return 0;
  };
  const note = (kind: SelfCorrection['kind'], index: number, before: string, after: string): void => {
    corrections.push({ kind, index, before, after });
  };

  for (let j = 1; j < n; j++) {
    let J: Item = items[j];
    let jw = words(J.rawText);
    // gap: previous found span end .. j's span start (j span null -> j's text not in line; use leading tokens)
    const gs = prevEnd(j);
    let ge = spans[j] ? spans[j]!.start : -1;
    if (ge < 0) {
      // j's text is not in the line (the segmenter completed it): longest PREFIX of j found after gs
      for (let L = jw.length - 1; L >= 1 && ge < 0; L--) {
        for (let s = gs; s + L <= toks.length; s++) {
          let ok = true;
          for (let q = 0; q < L; q++) {
            if (toks[s + q].w !== jw[q]) {
              ok = false;
              break;
            }
          }
          if (ok) {
            ge = s;
            break;
          }
        }
      }
      if (ge < 0) continue;
    }
    const gap = toks.slice(gs, ge);
    // a marker the segmenter KEPT at the start of j's rawText counts too
    const lead = jw.map(w => ({ w, piece: -1 }));
    const mkGap = markersIn(gap, STRONG);
    const mkLead = markersIn(lead.slice(0, 3), STRONG);
    let found = mkGap.found.slice();
    const covered = mkGap.covered;
    if (mkLead.found.length && [...mkLead.covered].includes(0)) {
      const cut = Math.max(...mkLead.covered) + 1;
      jw = jw.slice(cut);
      J = { ...J, rawText: jw.join(' ') };
      found = found.concat(mkLead.found.map(f => f + '@j'));
    }
    if (!found.length) continue;
    const residue = gap.filter((_, k) => !covered.has(k)).map(t => t.w).filter(w => !FILLER.has(w));
    if (residue.length) continue;
    if (gap.some((t, q) => ADD.has(t.w) && !covered.has(q)) || jw.some(w => ADD.has(w))) continue;
    // S202 (cloud-35 F3): an addition word the segmenter left OUT of j (`a ham sandwich too`,
    // `... as well`) still makes j an addition.
    if (spans[j]) {
      const pj = toks[spans[j]!.start].piece;
      // S202 (cloud-35 F3): only j's OWN stripped tail - stop at the next item's span or the first joiner.
      let stop = toks.length;
      for (let q = j + 1; q < n; q++) if (spans[q]) { stop = spans[q]!.start; break; }
      for (let q = spans[j]!.end; q < stop; q++) if (['and', 'with', 'or'].includes(toks[q].w)) { stop = q; break; }
      const after = toks.slice(spans[j]!.end, stop).filter(t => t.piece === pj).map(t => t.w);
      const asWell = after.some((w, x) => w === 'as' && after[x + 1] === 'well' && after[x + 2] !== 'as');
      if (after.some(w => ADD.has(w)) || asWell) continue;
    }
    if (gap.some(t => t.w === 'and')) continue;
    if (NEGSTART.some(p => p.every((w, k) => jw[k] === w))) continue;
    if (found.every(f => f === 'rather')) continue;
    const cj = parseClause(jw);
    const hj = headOf(J);
    const hjRaw = headOf({ rawText: J.rawText });
    if (((hj && SIZE_J.has(hj)) || (hjRaw && SIZE_J.has(hjRaw))) && !(cj && cj.food.length === 0)) continue;

    // 1. quantity-only j -> previous live item, which must be alone in its comma piece (row 2's guard)
    if (cj && cj.food.length === 0) {
      let t = j - 1;
      while (t >= 0 && removed.has(t)) t--;
      if (t < 0) continue;
      const st = spans[t];
      const alone = !!st && !items.some(
        (_, k) => k !== t && k !== j && !removed.has(k) && spans[k] && toks[spans[k]!.start].piece === toks[st.start].piece,
      );
      const ct = parseClause(words(cur(t).rawText));
      if (ct && ct.food.length === 0) {
        const tw = words(cur(t).rawText);
        const ofw = tw.length >= 2 && tw[tw.length - 2] === 'of' && TAILOF_WORDS.has(tw[tw.length - 1])
          ? ` of ${tw[tw.length - 1]}`
          : '';
        const u = cj.unit ?? ct.unit;
        const nr0 = `${fmt(cj.value)}${u ? ' ' + u : ''}${ofw}`;
        note('qty-on-qty', t, cur(t).rawText, nr0);
        rew.set(t, { ...cur(t), rawText: nr0 });
        removed.add(j);
        continue;
      }
      if (!alone) continue;
      const nr = rewriteQ(cj, foodMinusQty(cur(t).rawText));
      note('qty', t, cur(t).rawText, nr);
      rew.set(t, { ...cur(t), rawText: nr });
      removed.add(j);
      continue;
    }

    // 2. restatement of ANY earlier live item by head noun
    let k = -1;
    for (let q = j - 1; q >= 0; q--) {
      if (removed.has(q)) continue;
      const hq = headOf(cur(q));
      const hqr = headOf({ rawText: cur(q).rawText });
      if (hq && hj && sameWord(hq, hj) && hqr && hjRaw && sameWord(hqr, hjRaw)) {
        k = q;
        break;
      }
    }
    if (k >= 0) {
      const K = cur(k);
      const kw = words(K.rawText + ' ' + (K.normalizedForm ?? ''));
      if (cj && cj.food.every(f => kw.some(x => sameWord(f, x)))) {
        const nr = rewriteQ(cj, foodMinusQty(K.rawText));
        note('restate-qty', k, K.rawText, nr);
        rew.set(k, { ...K, rawText: nr });
        removed.add(j);
      } else {
        note('restate-replace', k, K.rawText, J.rawText);
        removed.add(k);
        if (J.rawText !== items[j].rawText) items[j] = { ...items[j], rawText: J.rawText };
        if (!J.brand && K.brand && isRestaurantChain(K.brand)) items[j] = { ...items[j], brand: K.brand };
      }
      continue;
    }

    // 3. part substitution: j's head noun (or j's preposition) inside an earlier item's modifier phrase
    let done = false;
    for (let q = j - 1; q >= 0 && !done; q--) {
      if (removed.has(q)) continue;
      const Q = cur(q);
      const qw = words(Q.rawText);
      const p = qw.findIndex((w, x) => x > 0 && PREPS.has(w));
      if (p < 0) continue;
      let e = p + 1;
      while (e < qw.length && !HEAD_STOP.has(qw[e])) e++;
      const phrase = qw.slice(p + 1, e);
      const byPrep = PREPS.has(jw[0]) && jw[0] === qw[p];
      const byHead = !!hj && phrase.some(w => sameWord(w, hj));
      if (!byPrep && !byHead) continue;
      const repl = byPrep ? jw : [qw[p], ...jw];
      const nr = [...qw.slice(0, p), ...repl, ...qw.slice(e)].join(' ');
      const nf = (Q.normalizedForm ?? '').replace(
        new RegExp(`\\b${phrase.join(' ')}\\b`),
        (byPrep ? jw.slice(1) : jw).join(' '),
      );
      note('part', q, Q.rawText, nr);
      rew.set(q, { ...Q, rawText: nr, normalizedForm: nf });
      removed.add(j);
      // a segmenter duplicate of the replaced part between q and j goes too
      for (let d = q + 1; d < j; d++) {
        if (!removed.has(d) && words(items[d].rawText).join(' ') === phrase.join(' ')) removed.add(d);
      }
      done = true;
    }
    if (done) continue;

    // 4. swap: only an explicit replacement marker
    if (!found.some(f => SWAP_OK.has(f.replace('@j', '')))) continue;
    let t = j - 1;
    while (t >= 0 && removed.has(t)) t--;
    if (t < 0) continue;
    {
      const tw2 = words(cur(t).rawText);
      const DET = /^(a|an|the|some|\d|one|two|three|four|five|six|seven|eight|nine|ten)/;
      if (tw2.some((w, x) => x > 0 && PREPS.has(w))) continue;
      if (DET.test(tw2[0] ?? '') && !DET.test(jw[0] ?? '') && !J.brand) continue;
    }
    removed.add(t);
    if (!J.brand && cur(t).brand && isRestaurantChain(cur(t).brand!)) items[j] = { ...items[j], brand: cur(t).brand };
    if (J !== items[j] && J.rawText !== items[j].rawText) items[j] = { ...items[j], rawText: J.rawText };
    note('swap', t, cur(t).rawText, items[j].rawText);
  }

  const L = n - 1;
  const sl = spans[L];
  if (n >= 2 && sl && !removed.has(L)) {
    const tail = toks.slice(sl.end);
    const mk = markersIn(tail, STRONG);
    if (mk.found.length && tail.length === mk.covered.size) {
      const hl = headOf(items[L]);
      const cl = parseClause(words(items[L].rawText));
      for (let k = L - 1; k >= 0; k--) {
        if (removed.has(k)) continue;
        const hk = headOf(cur(k));
        if (hl && hk && sameWord(hl, hk) && cl) {
          // S202 (cloud-35 F3): the main loop's `and` guard — two items joined by `and` in one comma piece
          // are two foods (`a beef taco and 2 chicken tacos, sorry`), not a reading and its correction.
          const sk = spans[k];
          const onePiece = !!sk && toks[sk.start].piece === toks[sl.start].piece;
          // S202 (cloud-35 F3): only an `and` joining k and L directly (no live item between) over two DIFFERENT foods;
          // a null span keeps base, and the same food at a new quantity is still a correction (`two eggs and three eggs, sorry`).
          let between = false;
          for (let q = k + 1; q < L; q++) if (!removed.has(q)) between = true;
          const fk = words(foodMinusQty(cur(k).rawText));
          const fl = words(foodMinusQty(items[L].rawText));
          const sameFood = fk.length === fl.length && fk.every((w, x) => sameWord(w, fl[x]));
          if (sk && onePiece && !between && !sameFood && toks.slice(sk.end, sl.start).some(t => t.w === 'and')) break;
          removed.add(k);
          note('trailing', k, cur(k).rawText, '');
          break;
        }
      }
    }
  }
  const out: T[] = [];
  items.forEach((it, k) => {
    if (!removed.has(k)) out.push(rew.get(k) ?? it);
  });
  return { items: out, corrections };
}
