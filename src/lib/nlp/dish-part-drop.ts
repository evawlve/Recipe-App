/**
 * dish-part-drop.ts - a homemade dish named together with its parts bills the dish, not the dish AND every part.
 *
 * MECHANISM. "a burrito bowl i made with brown rice, black beans, chicken and salsa" / "a homemade pizza
 * with pepperoni and mushrooms": the segmenter emits the dish AND each named ingredient as its own item,
 * so the dish (whose nutrition already contains its parts) is billed once and every part is billed again.
 * Diego's ruling (Option A, 2026-10-17): the dish is billed, the named parts are not.
 *
 * TRIGGER. The dish item is followed in the line by `made with` / `i made with`, or (when the line says
 * `homemade` / `home made` / `i made a ...`) by `with` / `on <bread>`. A blend-class dish (smoothie,
 * pancakes, french toast) takes only the `made with` form.
 *
 * DEFAULT-KEEP POSTURE. An item after the marker is dropped only when it is a BARE KNOWN PART of the dish's
 * class (a filling, a protein, a bread, a sauce, ... per class table). Anything else stays and keeps its
 * bill: a named filling (`cilantro lime rice`), a separate food (`a coke`), a side. A determiner- or
 * number-led later item ends the list (it is a new food), as does a side-like item (chips, soup, a drink).
 * An AMOUNT of a known part (a number or fraction, or a/an before a unit or fraction word; never a container like bowl / side / can) continues
 * the list instead (S240, MGR 18:44Z, Option A's letter), unless an additive word (also / along with / as well as / plus) sits in the gap or it restates an earlier kept item.
 * A quantity-only clause (`two slices`) is never a part - the fold attaches it afterwards.
 * A clause word (then / later / a meal name) in the gap BEFORE an item ends the list - a new clause, not a part (S202 cloud-35 F1);
 * words after an item, and a clause word right after from/since/over, never count.
 * A provenance phrase runs from from/since/over to the next joiner, step word, sentence boundary or comma piece, and no word inside it counts (S240, cloud-36 C12).
 *
 * PASS ORDER. Runs AFTER dropNegatedParts and BEFORE foldTrailingQuantityClauses (drop, dish, fold, fill):
 * with the parts gone the fold can attach `two slices` to the dish. The SegmentationCache keeps the
 * undropped split.
 *
 * Pure; never mutates its input.
 */

import { words, tokenizeWithPieces } from './trailing-quantity-fold';

export interface DishPartDrop {
  /** Index in the ORIGINAL input array. */
  index: number;
  rawText: string;
  /** The rawText of the dish item the part belongs to. */
  dish: string;
}

interface Item {
  rawText: string;
  normalizedForm?: string;
  brand?: string;
}

type DishClass = 'handheld' | 'burrito' | 'pizza' | 'omelet' | 'friedrice' | 'bowl' | 'blend';

const HEAD1: Record<string, DishClass> = {
  sandwich: 'handheld', sandwiches: 'handheld', burger: 'handheld', burgers: 'handheld', sub: 'handheld',
  subs: 'handheld', hoagie: 'handheld', panini: 'handheld', melt: 'handheld', wrap: 'handheld',
  wraps: 'handheld', taco: 'handheld', tacos: 'handheld', burrito: 'burrito', burritos: 'burrito',
  quesadilla: 'handheld', quesadillas: 'handheld', pizza: 'pizza', pizzas: 'pizza', omelette: 'omelet',
  omelet: 'omelet', omelettes: 'omelet', omelets: 'omelet', smoothie: 'blend', smoothies: 'blend',
  pancake: 'blend', pancakes: 'blend',
};
const HEAD2: Record<string, DishClass> = {
  'fried rice': 'friedrice', 'french toast': 'blend', 'burrito bowl': 'bowl', 'grain bowl': 'bowl',
  'poke bowl': 'bowl', 'rice bowl': 'bowl', 'buddha bowl': 'bowl', 'power bowl': 'bowl', 'acai bowl': 'bowl',
  'protein pancake': 'blend',
};
const MADE_ONLY = new Set<DishClass>(['blend']);

const FILL = [
  'cheese', 'cheddar', 'swiss', 'mozzarella', 'provolone', 'jack', 'feta', 'parmesan', 'lettuce', 'tomato',
  'tomatoes', 'onion', 'onions', 'pickle', 'pickles', 'avocado', 'guacamole', 'guac', 'mayo', 'mayonnaise',
  'mustard', 'ketchup', 'sauce', 'salsa', 'pesto', 'peppers', 'pepper', 'jalapenos', 'jalapeno', 'spinach',
  'mushrooms', 'mushroom', 'olives', 'sour cream',
];
/** Protein part words. Also read by extra-portion.ts (S240). */
export const PROT = [
  'chicken', 'beef', 'turkey', 'ham', 'bacon', 'steak', 'pork', 'sausage', 'pepperoni', 'patty', 'patties',
  'egg', 'eggs', 'tuna', 'salmon', 'shrimp', 'tofu', 'carnitas', 'chorizo', 'fish',
];
const PART: Record<DishClass, Set<string>> = {
  handheld: new Set([
    ...FILL, ...PROT, 'bun', 'buns', 'bread', 'sourdough', 'rye', 'brioche', 'ciabatta', 'roll', 'tortilla',
    'tortillas', 'muffin', 'croissant', 'pita',
  ]),
  burrito: new Set([...FILL, ...PROT, 'tortilla', 'tortillas', 'rice', 'beans']),
  pizza: new Set([...FILL, ...PROT, 'crust', 'dough', 'pineapple', 'basil', 'sauce']),
  omelet: new Set([...FILL, ...PROT.filter(x => !['bacon', 'sausage'].includes(x))]),
  friedrice: new Set([
    'egg', 'eggs', 'peas', 'carrots', 'carrot', 'rice', 'chicken', 'shrimp', 'pork', 'beef', 'onions', 'onion',
    'scallions', 'vegetables', 'veggies', 'soy sauce', 'sauce', 'corn', 'tofu',
  ]),
  bowl: new Set([
    ...FILL, ...PROT, 'rice', 'quinoa', 'beans', 'corn', 'chickpeas', 'cucumber', 'veggies', 'vegetables',
    'granola', 'berries', 'banana', 'strawberries', 'blueberries', 'edamame', 'seaweed', 'kale',
  ]),
  blend: new Set([
    'flour', 'whey', 'protein', 'powder', 'egg', 'eggs', 'banana', 'bananas', 'milk', 'berries', 'strawberries',
    'blueberries', 'spinach', 'peanut butter', 'oats', 'yogurt', 'brioche', 'bread', 'ice', 'honey', 'chia',
    'seeds', 'kale', 'mango', 'almond milk', 'oat milk',
  ]),
};

const QTY_ONLY =
  /^(about |maybe |like |around )?(one|two|three|four|five|six|a|an|half|\d+(\.\d+)?)( a)?\s+(slices?|pieces?|cups?|bowls?|servings?|of them|halves|cup)$/i;
const BREAD = new Set([
  'bun', 'buns', 'bread', 'sourdough', 'rye', 'toast', 'muffin', 'bagel', 'roll', 'tortilla', 'tortillas',
  'croissant', 'ciabatta', 'brioche', 'pita', 'wheat', 'white', 'crust', 'naan', 'biscuit',
]);
const DET = new Set(['a', 'an', 'the', 'some', 'my']);
// S202 (cloud-35 F1): words that open a NEW clause - a time step or a meal. NOT was / had / ate
// (`with what i had left: rice and beans` is still the dish's own list).
const CLAUSE = new Set([
  'then', 'later', 'after', 'afterwards', 'afterward', 'followed', 'breakfast', 'lunch', 'dinner', 'brunch', 'snack',
  'supper', 'dessert', 'tonight', 'yesterday', 'morning',
]);
// A clause word right after one of these is a part's provenance (`chicken from dinner`), not a new clause.
const PROVENANCE = new Set(['from', 'since', 'over']);
const JOINERS = new Set(['and', 'or', 'plus', 'with']);
const STEP = new Set(['then', 'later', 'after', 'afterwards', 'afterward', 'followed']);
const LEAD_STOP = new Set(['a', 'an', 'the', 'some', 'my', 'one', 'two', 'three', 'four', 'five', 'six', 'half']);
const MODS = new Set([
  'grilled', 'shredded', 'diced', 'sliced', 'chopped', 'fried', 'crispy', 'fresh', 'roasted', 'sauteed', 'melted',
  'ground', 'black', 'pinto', 'refried', 'brown', 'white', 'american', 'swiss', 'cheddar', 'pepper', 'monterey',
  'sour', 'hot', 'green', 'red', 'baby', 'cherry', 'sausage', 'pulled', 'smoked', 'deli', 'caramelized', 'pickled',
  'vanilla', 'whole', 'skim', 'almond', 'oat', 'frozen', 'mixed', 'extra', 'brioche', 'potato', 'sesame', 'wheat',
  'sourdough', 'english', 'ciabatta', 'pretzel', 'flour', 'corn',
]);
const MEASURE_LEAD =
  /^(a|an|one|two|three)?\s*(slices?|strips?|dollops?|drizzles?|sprinkles?|spoonfuls?|pinch(es)?|dash(es)?|handful|scoops?|tbsp|tsp|tablespoons?|teaspoons?)\s+of\s+/i;
// S240 (MGR 18:44Z, Option A's letter): an AMOUNT before a part (`2 eggs`, `a quarter cup of cheese`, `half a cup of rice`).
const AMOUNT_LEAD =
  /^(?:(?:about|maybe|like|around)\s+)?(?:a|an|one|two|three|four|five|six|half|quarter|some|\d+(?:[./]\d+)?)(?:\s+(?:a|an|quarter|half|third|couple|few))?(?:\s+(?:of\s+)?(?:cups?|c|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|grams?|g|lbs?|pounds?|slices?|strips?|pieces?|handfuls?|scoops?|dollops?|spoonfuls?|pinch(?:es)?|dash(?:es)?|cans?|cloves?|bunch(?:es)?|stalks?|leaves|links?|patties|patty))?(?:\s+of)?\s+/i;
const COOK = new Set(['fried', 'crispy', 'roasted', 'grilled', 'smoked', 'pulled']);
const COOK_OK = new Set<DishClass>(['handheld', 'burrito', 'pizza', 'bowl']);
const SIDEISH = new Set([
  'chips', 'fries', 'salad', 'soup', 'coke', 'soda', 'pop', 'beer', 'wine', 'juice', 'coffee', 'tea', 'latte',
  'shake', 'milkshake', 'rings', 'tots', 'wings', 'side', 'sides', 'dessert', 'cookie', 'cookies', 'cake', 'pie',
  'fruit', 'apple', 'orange', 'banana', 'pear', 'grapes', 'yogurt', 'water',
]);

interface Span {
  start: number;
  end: number;
}

function findSpan(toks: string[], w: string[], from: number): Span | null {
  if (!w.length) return null;
  for (let s = from; s + w.length <= toks.length; s++) {
    let ok = true;
    for (let k = 0; k < w.length; k++) {
      if (toks[s + k] !== w[k]) {
        ok = false;
        break;
      }
    }
    if (ok) return { start: s, end: s + w.length };
  }
  return null;
}

function dishClass(it: Item): { cls: DishClass; head: string } | null {
  const w = words(it.normalizedForm || it.rawText);
  const k = w.length - 1;
  if (k < 0) return null;
  if (k > 0 && HEAD2[w[k - 1] + ' ' + w[k]]) return { cls: HEAD2[w[k - 1] + ' ' + w[k]], head: w[k] };
  if (HEAD1[w[k]]) return { cls: HEAD1[w[k]], head: w[k] };
  return null;
}

function isPart(it: Item, cls: DishClass): boolean {
  const raw = it.rawText
    .trim()
    .replace(MEASURE_LEAD, '')
    .replace(AMOUNT_LEAD, '')
    .replace(/^\s*(a|an|the|some|one|two|three|four|five|six|\d+(\.\d+)?)\s+/i, '');
  const w = words(it.normalizedForm && it.normalizedForm.trim() ? it.normalizedForm : raw);
  if (!w.length || w.length > 3) return false;
  const last = w[w.length - 1];
  const last2 = w.length > 1 ? w[w.length - 2] + ' ' + last : '';
  if (PART[cls].has(last2) && w.length <= 3 && (w.length < 3 || MODS.has(w[0]))) return true;
  if (!PART[cls].has(last)) return false;
  if (w.length === 2 && COOK.has(w[0]) && !COOK_OK.has(cls)) return false;
  if (cls === 'blend' && (last === 'egg' || last === 'eggs') && w.length > 1) return false;
  return w.length === 1 || (w.length === 2 && (MODS.has(w[0]) || COOK.has(w[0])));
}

/** An item that is an amount of a known part (`2 eggs`, `a quarter cup of cheese`) - a part of the dish, not a new food. */
// A bare a/an/some is a DETERMINER, not an amount: a determiner-led new food still bills. An amount is a number or fraction, or a/an
// before a fraction or unit word; a container (bowl, plate, side, bag, order, serving, can, glass) is never a part's amount.
const AMOUNT_NUM =
  /^(?:(?:about|maybe|like|around)\s+)?(?:one|two|three|four|five|six|half|quarter|\d+(?:[./]\d+)?|(?:a|an)\s+(?=(?:quarter|half|third|couple|few|cups?|c|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|grams?|g|lbs?|pounds?|slices?|strips?|pieces?|handfuls?|scoops?|dollops?|spoonfuls?|pinch(?:es)?|dash(?:es)?|cans?|cloves?|bunch(?:es)?|stalks?|leaves|links?|patties|patty)\b))\b/i;
const ADDITIVE = new Set(['also', 'along', 'plus', 'additionally']);
const CONTAINER = /\b(cans?|bowls?|plates?|sides?|bags?|orders?|servings?|box(?:es)?|platters?|glass(?:es)?)\b/i;
function amountPart(it: Item, cls: DishClass): boolean {
  const r = it.rawText.trim();
  return AMOUNT_NUM.test(r) && !CONTAINER.test(r) && isPart(it, cls);
}

export function dropDishParts<T extends Item>(lineKey: string, items: T[]): { items: T[]; drops: DishPartDrop[] } {
  const none = { items: items.slice(), drops: [] as DishPartDrop[] };
  if (items.length < 2) return none;
  const ptoks = tokenizeWithPieces(lineKey);
  const toks = ptoks.map(t => t.w);
  const bounds = sentTokBounds(lineKey);
  const spans: Array<Span | null> = [];
  let cur = 0;
  for (const it of items) {
    const sp = findSpan(toks, words(it.rawText), cur) ?? findSpan(toks, words(it.normalizedForm ?? ''), cur);
    spans.push(sp);
    if (sp) cur = sp.end;
  }
  for (let d = 0; d < items.length; d++) {
    const sp = spans[d];
    if (!sp) continue;
    const dc = dishClass(items[d]);
    if (!dc) continue;
    if (QTY_ONLY.test(items[d].rawText.trim())) continue;
    const e = sp.end;
    let m = -1;
    let kind: 'made' | 'with' = 'made';
    const homemadeAdj =
      toks.slice(Math.max(0, sp.start - 2), sp.end).includes('homemade') ||
      (toks[sp.start - 1] === 'made' && toks[sp.start - 2] === 'home');
    const iMadeBefore =
      (toks[sp.start - 1] === 'made' && toks[sp.start - 2] === 'i') ||
      (toks[sp.start - 2] === 'made' && toks[sp.start - 3] === 'i' && DET.has(toks[sp.start - 1]));
    if (toks[e] === 'made' && toks[e + 1] === 'with') m = e + 2;
    else if (toks[e] === 'i' && toks[e + 1] === 'made' && toks[e + 2] === 'with') m = e + 3;
    else if ((homemadeAdj || iMadeBefore) && toks[e] === 'with' && !(toks[e + 1] === 'a' && toks[e + 2] === 'side')) {
      m = e + 1;
      kind = 'with';
    } else if (
      (homemadeAdj || iMadeBefore) &&
      toks[e] === 'on' &&
      (BREAD.has(toks[e + 1]) || (DET.has(toks[e + 1]) && (BREAD.has(toks[e + 2]) || BREAD.has(toks[e + 3]))))
    ) {
      m = e + 1;
      kind = 'with';
    }
    if (m < 0) continue;
    if (kind === 'with' && MADE_ONLY.has(dc.cls)) continue;
    const dropIdx: number[] = [];
    let seen = 0;
    const okPiece = new Set<number>();
    for (let j = d + 1; j < items.length; j++) {
      const js = spans[j];
      const jt = items[j].rawText.trim();
      const jw = words(jt);
      if (!js) {
        if (jw.length && findSpan(words(items[d].rawText), jw, 0) && /\bwith\b/.test(items[d].rawText)) dropIdx.push(j);
        continue;
      }
      if (js.start < m) continue;
      // S202 (cloud-35 F1): a clause word in the GAP before this item (since the previous
      // item's span, or the marker) ends the list - `…, then for dinner salmon`, `… cheese. later steak`. Words AFTER an item
      // never count, so a trailing meal tag (`… cheese and salsa for breakfast`) keeps base behaviour.
      let gs = m;
      for (let k = d; k < j; k++) if (spans[k] && spans[k]!.end > gs) gs = spans[k]!.end;
      // S240 (cloud-36 C12): a provenance phrase (`from last night's dinner`, `from lunch yesterday`) runs from from/since/over to
      // the next joiner, step word, sentence boundary or comma piece, and no word inside it counts. A clause word outside it (a step
      // word included) still ends the list (`… from lunch. later steak` keeps the steak).
      const g = toks.slice(gs, js.start);
      let inProv = false;
      let clause = false;
      for (let i = 0; i < g.length; i++) {
        const w = g[i];
        const q = gs + i;
        if (inProv && (JOINERS.has(w) || STEP.has(w) || bounds.has(q) || ptoks[q]?.piece !== ptoks[q - 1]?.piece)) inProv = false;
        if (PROVENANCE.has(w)) { inProv = true; continue; }
        if (!inProv && CLAUSE.has(w)) { clause = true; break; }
      }
      if (clause) break;
      // S240 (MGR 18:44Z): an amount part continues the list, except after an ADDITIVE word in the gap (`also`, `along with`,
      // `as well as`, `plus`: a new food, s202 refute-r4 pins) or when it RESTATES an earlier KEPT item's head (`scrambled eggs,
      // cheese, two eggs`: that item's quantity, left for the trailing-quantity fold).
      const additive = g.some(w => ADDITIVE.has(w)) || g.join(' ').includes('as well as');
      const lastw = (it: Item) => { const w = words(it.normalizedForm || it.rawText); return (w[w.length - 1] ?? '').replace(/e?s$/, ''); };
      const restates =
        items.slice(d + 1, j).some((it, i) => spans[d + 1 + i] && !dropIdx.includes(d + 1 + i) && lastw(it) === lastw(items[j]));
      const amt = (it: Item) => !additive && !restates && amountPart(it, dc.cls);
      // A new comma piece whose FIRST lineKey token (after an optional `and`) is a determiner/number ends the list.
      if (ptoks[js.start] && ptoks[m] && ptoks[js.start].piece > ptoks[m].piece) {
        let f = ptoks.findIndex(t => t.piece === ptoks[js.start].piece);
        if (f >= 0 && toks[f] === 'and') f++;
        if (f >= 0 && (LEAD_STOP.has(toks[f]) || /^\d/.test(toks[f] ?? ''))) {
          // The piece's lead belongs to its FIRST item: once that item is an amount part, a later item in the same piece is not
          // ended by the leader's number (`two eggs and peas`).
          const pc = ptoks[js.start].piece;
          if (!okPiece.has(pc)) { if (amt(items[j])) okPiece.add(pc); else break; }
        }
      }
      // ANY later item whose lineKey span starts with a determiner/number ENDS the list, joiner-independent -
      // except the first item after the marker, a part MEASURE (`a slice of cheddar`) and an item right after `on`.
      const detLed = LEAD_STOP.has(toks[js.start]) || /^\d/.test(toks[js.start] ?? '');
      if (detLed && seen > 0 && toks[js.start - 1] !== 'on' && !MEASURE_LEAD.test(toks.slice(js.start, js.end).join(' ')) && !amt(items[j])) break;
      seen++;
      const hs = dc.head.replace(/e?s$/, '');
      if (jw.some(x => x.replace(/e?s$/, '') === hs)) continue;
      if (jw.includes('side') || (toks[js.end] === 'on' && toks[js.end + 1] === 'the' && toks[js.end + 2] === 'side')) continue;
      if (!isPart(items[j], dc.cls)) {
        // A non-part is KEPT; a side-like one ENDS the list, any other lets the scan continue.
        if (words(items[j].normalizedForm || items[j].rawText).some(x => SIDEISH.has(x))) break;
        continue;
      }
      dropIdx.push(j);
    }
    const dropSet = new Set(dropIdx);
    return {
      items: items.filter((_, i) => !dropSet.has(i)),
      drops: dropIdx.map(index => ({ index, rawText: items[index].rawText, dish: items[d].rawText })),
    };
  }
  return none;
}

/** Token indexes that open a new sentence (after `.` / `:` / ` - `, not between digits) in the lineKey. */
function sentTokBounds(lineKey: string): Set<number> {
  const out = new Set<number>();
  const parts = lineKey.split(/(?<!\d)[.:](?!\d)|\s-\s/);
  let n = 0;
  for (let p = 0; p < parts.length; p++) {
    if (p > 0) out.add(n);
    n += tokenizeWithPieces(parts[p]).length;
  }
  return out;
}
