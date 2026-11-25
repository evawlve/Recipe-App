/**
 * Slim Chickens (US): one server-rendered page, https://www.slimchickens.com/nutritional-and-allergen-info/. Each
 * category is `<section><h2>NAME</h2><ul><li><h3>ITEM</h3><p>Serving size: X | Serving size (g): N | Calories: N | ...</p>`.
 * Pre-digest and refute (2026-11-17/25, mobile repo chain row 3): 173 rows in 11 sections; added sugar is not published.
 *
 * Rules this adapter applies:
 *  - The "Sauces & Dressings" section becomes components with ONE portion (its label is the row's serving string); every
 *    other section becomes items. The 2 `<li>` that publish only a calorie range (no panel) are skipped. Left out: any
 *    row over BULK_SERVING_G (catering-scale drinks and sides, 10 rows) and the SOURCE_ERRORS below.
 *  - A key is "slim-chickens-" + slugify(cleaned name). Cleaned = entities decoded, marks removed, whitespace collapsed.
 *    A size is a CLOSED list: a Drinks name ending " – <N>oz" or " – 1 gallon" (EN DASH U+2013); it leaves the name,
 *    appends "-<size>" to the key and becomes the variant size=<12oz|1-gallon>. Nothing else is a size.
 *  - The same key twice is kept once when the rows are identical and is an error when they are not. Identical rows
 *    under two keys collapse to the smallest key.
 *  - No source date (the page prints none), so freshness falls back to the fetch date. servingG is chain-stated.
 */
import type { ChainComponent, ChainItem, Panel } from '../../../src/lib/chains/snapshot';
import type { ChainAdapter } from '../lib/adapter';
import { cellText, num, panelOf, slugify } from '../lib/text';

const SOURCE = 'nutrition';
const COMPONENT_SECTION = 'Sauces & Dressings';
const BULK_SERVING_G = 2000;
// Left out, never "fixed": a published panel that contradicts itself.
const SOURCE_ERRORS: Record<string, string> = {
  'Honey Jalapeno Pimento Sandwich': 'carbs 114 g with 49 g protein and 37 g fat is 985 kcal against the published 720',
};

const LABELS: Record<string, keyof Panel> = {
  Calories: 'kcal', 'Total Fat (g)': 'fatG', 'Saturated Fat (g)': 'satFatG', 'Trans Fat (g)': 'transFatG',
  'Cholesterol (mg)': 'cholesterolMg', 'Sodium (mg)': 'sodiumMg', 'Total Carbs (g)': 'carbsG',
  'Dietary Fiber (g)': 'fiberG', 'Sugar (g)': 'sugarG', 'Protein (g)': 'proteinG',
};

function cleanName(raw: string): string {
  return cellText(raw).replace(/[®™]/g, '').replace(/\s+/g, ' ').trim();
}

export type SlimRow ={ section: string; name: string; serving: string | null; grams: number | null; panel: Panel };

export function readRows(html: string): SlimRow[] {
  const rows: SlimRow[] = [];
  const sections = [...html.matchAll(/<section>([\s\S]*?)<\/section>/g)];
  if (sections.length === 0) throw new Error('slim-chickens-us: no <section> found');
  for (const s of sections) {
    const h2 = s[1].match(/<h2>([\s\S]*?)<\/h2>/);
    if (!h2) continue;
    const section = cellText(h2[1]);
    for (const li of s[1].matchAll(/<li><h3>([\s\S]*?)<\/h3>([\s\S]*?)<\/li>/g)) {
      const p = li[2].match(/<p>([\s\S]*?)<\/p>/);
      if (!p) continue;
      const pairs = new Map<string, string>();
      for (const part of cellText(p[1]).split(' | ')) {
        const at = part.indexOf(': ');
        if (at > 0) pairs.set(part.slice(0, at), part.slice(at + 2));
      }
      if (!pairs.has('Calories')) continue; // a calorie range only, no panel
      const values: Partial<Panel> = {};
      for (const [label, field] of Object.entries(LABELS)) values[field] = num(pairs.get(label) ?? null);
      rows.push({ section, name: cleanName(li[1]), serving: pairs.get('Serving size') ?? null, grams: num(pairs.get('Serving size (g)') ?? null), panel: panelOf(values) });
    }
  }
  return rows;
}

const SIZE_SUFFIX = /\s+–\s+(\d+oz|1 gallon)$/;

const adapter: ChainAdapter = {
  chain: 'slim-chickens-us',
  chainName: 'Slim Chickens',
  country: 'US',
  route: 'html-table',
  sources: [{ id: SOURCE, kind: 'html-table', url: 'https://www.slimchickens.com/nutritional-and-allergen-info/', landingUrl: null, file: 'nutritional-and-allergen-info.html' }],
  parse(bodies) {
    const items = new Map<string, ChainItem>();
    const components = new Map<string, ChainComponent>();
    for (const row of readRows(bodies[SOURCE])) {
      if (SOURCE_ERRORS[row.name]) continue;
      if (row.grams !== null && row.grams > BULK_SERVING_G) continue;
      if (row.section === COMPONENT_SECTION) {
        if (!row.serving) throw new Error(`slim-chickens-us: component ${row.name} has no serving size`);
        const key = `slim-chickens-${slugify(row.name)}`;
        const c: ChainComponent = { key, name: row.name, removalKeys: [row.name.toLowerCase()], portions: [{ label: row.serving, grams: row.grams, panel: row.panel, sourceId: SOURCE }] };
        const prev = components.get(key);
        if (prev && JSON.stringify(prev) !== JSON.stringify(c)) throw new Error(`slim-chickens-us: component ${key} appears twice with different rows`);
        components.set(key, c);
        continue;
      }
      let name = row.name;
      let key = `slim-chickens-${slugify(name)}`;
      let variant: string | null = null;
      const size = row.section === 'Drinks' ? name.match(SIZE_SUFFIX) : null;
      if (size) {
        name = name.replace(SIZE_SUFFIX, '');
        const label = size[1].replace(' ', '-');
        key = `slim-chickens-${slugify(name)}-${label}`;
        variant = `size=${label}`;
      }
      const it: ChainItem = { key, name, aliases: [], variant, servingG: row.grams, panel: row.panel, sourceId: SOURCE, parts: [] };
      const prev = items.get(key);
      if (prev && JSON.stringify(prev) !== JSON.stringify(it)) throw new Error(`slim-chickens-us: item ${key} appears twice with different rows`);
      items.set(key, it);
    }
    // Identical rows listed under two keys collapse to the smallest key.
    const byContent = new Map<string, ChainItem>();
    for (const it of [...items.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
      const sig = JSON.stringify([it.name, it.servingG, it.panel]);
      if (!byContent.has(sig)) byContent.set(sig, it);
    }
    return { items: [...byContent.values()], components: [...components.values()] };
  },
  // Observed 2026-11-17 on the chain's own menu page (a different URL from the table); kcal only, item alone.
  spotChecks: [
    { id: 'crispy-chicken-sandwich-menu', itemKey: 'slim-chickens-crispy-chicken-sandwich', removeComponentKeys: [], addParts: [],
      observed: panelOf({ kcal: 590 }), observedAt: '2026-11-17', where: 'https://www.slimchickens.com/menu/craft-sandwiches-and-wraps/' },
    { id: 'cayenne-ranch-chicken-sandwich-menu', itemKey: 'slim-chickens-cayenne-ranch-chicken-sandwich', removeComponentKeys: [], addParts: [],
      observed: panelOf({ kcal: 650 }), observedAt: '2026-11-17', where: 'https://www.slimchickens.com/menu/craft-sandwiches-and-wraps/' },
    { id: 'chicken-club-sandwich-menu', itemKey: 'slim-chickens-chicken-club-sandwich', removeComponentKeys: [], addParts: [],
      observed: panelOf({ kcal: 740 }), observedAt: '2026-11-17', where: 'https://www.slimchickens.com/menu/craft-sandwiches-and-wraps/' },
  ],
};

export default adapter;
