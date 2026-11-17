/**
 * Chick-fil-A (US): one page, https://www.chick-fil-a.com/nutrition-allergens, whose WordPress interactivity JSON
 * (`<script id="wp-script-module-data-@wordpress/interactivity">`) holds the whole nutrition table at
 * `state["nutrition-allergens-table-store"].tableData.nutrition[]`: 18 menus, each `items[]` of
 * `{ title, link, fields[], sub_items[] }` (a size or cheese choice is a sub-item with its own panel and link).
 * Pre-digest and refute (2026-11-17, mobile repo chain row 2 write-off): 418 rows in 18 menus, 0 Atwater failures,
 * every row carries all ten published fields; added sugar is not published.
 *
 * Rules this adapter applies:
 *  - The seven component menus (sauces, dressings, buns, proteins, toppings) become components with one "1 serving"
 *    portion; every other menu becomes items. Left out: the Trays menu (60 party trays) and any row over
 *    BULK_SERVING_G (Catering Coffee, 2,722 g). Catering rows that are one serving (a chilled sub, a bottled tea) stay;
 *    the 30 that repeat a regular row collapse into it.
 *  - An item's key is its `link`'s last path segment (titles repeat: three Coffee titles are each a parent and a
 *    different-sized child). A row with no link keys on its slugged title. The same key twice is kept once when the
 *    two rows are identical, and is an error when they are not. Rows under DIFFERENT keys that are identical in name,
 *    serving and panel (a cookie listed under Treats and Kid's Meals) collapse to the smallest key.
 *  - Known, not fixed here: same-named coffee sizes (Iced Coffee x3, Cream Cold Brew x2, Frosted Coffee x2) carry
 *    different panels and no machine-readable size, so `variant` is null; "Kid's Meal" rows are the entree's panel
 *    only, as the chain publishes them ("nutrition per entree only").
 *  - No source date: the page prints none (its `og:updated_time` dates the page, not the numbers), so freshness
 *    falls back to the fetch date.
 *  - No item -> component links: Chick-fil-A publishes none. Its "w/ No Cheese" rows are kept as their own items.
 */
import type { ChainComponent, ChainItem, Panel } from '../../../src/lib/chains/snapshot';
import type { ChainAdapter } from '../lib/adapter';
import { decodeEntities, num, panelOf, slugify } from '../lib/text';

type Field = { label: string; value: string | number };
type Row = { title: string; link: string; fields: Field[]; sub_items?: Row[] };
type Menu = { menu: string; items: Row[] };

const SOURCE = 'nutrition';
const COMPONENT_MENUS = new Set(['Dipping Sauces', 'Dressings', 'Buns', 'Proteins', 'Salad Toppings', 'Sandwich Toppings', 'Soup Toppings']);
const SKIPPED_MENUS = new Set(['Trays']);
const BULK_SERVING_G = 2000;

const LABELS: Record<string, keyof Panel> = {
  Calories: 'kcal', 'Fat (g)': 'fatG', 'Sat. Fat (g)': 'satFatG', 'Trans Fat (g)': 'transFatG',
  'Cholesterol (mg)': 'cholesterolMg', 'Sodium (mg)': 'sodiumMg', 'Carbohydrates (g)': 'carbsG',
  'Fiber (g)': 'fiberG', 'Sugar (g)': 'sugarG', 'Protein (g)': 'proteinG',
};

export function readMenus(html: string): Menu[] {
  const m = html.match(/<script[^>]*id="wp-script-module-data-@wordpress\/interactivity"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('chick-fil-a-us: interactivity JSON not found');
  const state = (JSON.parse(m[1]) as { state: Record<string, { tableData?: { nutrition?: Menu[] } }> }).state;
  const menus = state['nutrition-allergens-table-store']?.tableData?.nutrition;
  if (!Array.isArray(menus) || menus.length === 0) throw new Error('chick-fil-a-us: tableData.nutrition is empty');
  return menus;
}

function rowPanel(row: Row): { panel: Panel; grams: number | null } {
  const values: Partial<Panel> = {};
  let grams: number | null = null;
  for (const f of row.fields) {
    if (f.label === 'Serving Size') grams = typeof f.value === 'string' && /^\d+(\.\d+)?g$/.test(f.value) ? Number(f.value.slice(0, -1)) : null;
    const field = LABELS[f.label];
    if (field) values[field] = num(f.value);
  }
  return { panel: panelOf(values), grams };
}

function cleanName(title: string): string {
  return decodeEntities(title).replace(/[®™]/g, '').replace(/\s+/g, ' ').trim();
}

function keyOf(row: Row): string {
  const seg = row.link ? row.link.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() ?? '' : '';
  return seg && !seg.startsWith('load-dot-com') ? slugify(seg) : slugify(cleanName(row.title));
}

function flatten(rows: Row[]): Row[] {
  return rows.flatMap((r) => [r, ...flatten(r.sub_items ?? [])]);
}

const adapter: ChainAdapter = {
  chain: 'chick-fil-a-us',
  chainName: 'Chick-fil-A',
  country: 'US',
  route: 'html-json',
  sources: [{ id: SOURCE, kind: 'html-json', url: 'https://www.chick-fil-a.com/nutrition-allergens', landingUrl: null, file: 'nutrition-allergens.html' }],
  parse(bodies) {
    const items = new Map<string, ChainItem>();
    const components = new Map<string, ChainComponent>();
    for (const menu of readMenus(bodies[SOURCE])) {
      if (SKIPPED_MENUS.has(menu.menu)) continue;
      for (const row of flatten(menu.items)) {
        const key = keyOf(row);
        const name = cleanName(row.title);
        const { panel, grams } = rowPanel(row);
        if (grams !== null && grams > BULK_SERVING_G) continue;
        if (COMPONENT_MENUS.has(menu.menu)) {
          const c: ChainComponent = { key, name, removalKeys: [name.toLowerCase()], portions: [{ label: '1 serving', grams, panel, sourceId: SOURCE }] };
          const prev = components.get(key);
          if (prev && JSON.stringify(prev) !== JSON.stringify(c)) throw new Error(`chick-fil-a-us: component ${key} appears twice with different rows`);
          components.set(key, c);
        } else {
          const it: ChainItem = { key, name, aliases: [], variant: null, servingG: grams, panel, sourceId: SOURCE, parts: [] };
          const prev = items.get(key);
          if (prev && JSON.stringify(prev) !== JSON.stringify(it)) throw new Error(`chick-fil-a-us: item ${key} appears twice with different rows`);
          items.set(key, it);
        }
      }
    }
    // Identical rows listed under two keys collapse to the smallest key.
    const byContent = new Map<string, ChainItem>();
    for (const it of [...items.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
      const sig = JSON.stringify([it.name, it.servingG, it.panel]);
      if (!byContent.has(sig)) byContent.set(sig, it);
    }
    return { items: [...byContent.values()], components: [...components.values()] };
  },
  // Observed 2026-11-17 on the chain's own item pages (a different URL from the table, same CMS; no calculator exists).
  spotChecks: [
    { id: 'chicken-sandwich-page', itemKey: 'chick-fil-a-chicken-sandwich', removeComponentKeys: [], addParts: [],
      observed: panelOf({ kcal: 420, fatG: 16, satFatG: 3.5, transFatG: 0, cholesterolMg: 70, sodiumMg: 1470, carbsG: 41 }),
      observedAt: '2026-11-17', where: 'https://www.chick-fil-a.com/menu/entrees/chick-fil-a-chicken-sandwich' },
    { id: 'deluxe-sandwich-page', itemKey: 'chick-fil-a-deluxe-sandwich', removeComponentKeys: [], addParts: [],
      observed: panelOf({ kcal: 490, fatG: 21, satFatG: 6, transFatG: 0, cholesterolMg: 85, sodiumMg: 1710, carbsG: 43 }),
      observedAt: '2026-11-17', where: 'https://www.chick-fil-a.com/menu/entrees/chick-fil-a-deluxe-sandwich' },
    { id: 'waffle-fries-page', itemKey: 'chick-fil-a-waffle-potato-fries', removeComponentKeys: [], addParts: [],
      observed: panelOf({ kcal: 420, fatG: 24, satFatG: 4, transFatG: 0, cholesterolMg: 0, sodiumMg: 240, carbsG: 45 }),
      observedAt: '2026-11-17', where: 'https://www.chick-fil-a.com/menu/sides/chick-fil-a-waffle-potato-fries' },
  ],
};

export default adapter;
