/**
 * First Watch (US): one server-rendered page, https://firstwatch.com/nutrition-and-allergens (the apex host: www answers a
 * 301 and the polite fetch refuses redirects). 27 `<table class="nutrition-table nutrition-details-table">`, each with a
 * `<caption id="<table>-caption">`, a header row of column names and one `<tr class="nutrition-data-row">` per item
 * (`<th><h3 class="nutrition-item-name"><a>NAME</a></h3></th>` then one `<td><span class="nutrition-data-number">` per column).
 * Pre-digest and refute (2026-11-17/25, mobile repo chain row 3): 157 rows, no serving size or grams anywhere.
 *
 * Rules this adapter applies:
 *  - Every row is an item; there are 0 components. Columns are mapped by header TEXT, never by position. The 2 seasonal
 *    tables that carry a header and no rows are skipped.
 *  - A key is "first-watch-" + slugify(cleaned name), NOT the row's link (/menu/mimosa links two different drinks).
 *    Cleaned = entities decoded, marks removed, whitespace collapsed. A size is a CLOSED list: a name ending "(Small)" or
 *    "(Large)"; it leaves the name, appends "-small"/"-large" to the key and becomes the variant size=small|large.
 *  - The same key twice is kept once when the rows are identical (the regional tables repeat); when they differ and
 *    exactly one side is from the table captioned id `kids`, that row keys "<key>-kids" with variant menu=kids; any
 *    other difference is an error. Identical rows under two keys collapse to the smallest key.
 *  - Rows in the three tables headed "Boozy" carry atwaterExempt 'alcohol' (alcohol is 7 kcal/g, outside the Atwater check).
 *  - No source date (the page's og:updated_time is 2022 and is not the numbers' date), so freshness falls back to fetch date.
 */
import type { ChainItem, Panel } from '../../../src/lib/chains/snapshot';
import type { ChainAdapter } from '../lib/adapter';
import { cellText, num, panelOf, slugify } from '../lib/text';

const SOURCE = 'nutrition';
// Left out, never "fixed": a published panel that contradicts itself.
const SOURCE_ERRORS: Record<string, string> = {
  'Hot Chocolate': '250 kcal published against 141 kcal from its own protein, carbs and fat',
};

const COLUMNS: Record<string, keyof Panel> = {
  'Calories (cal)': 'kcal', 'Fat (g)': 'fatG', 'Sat. Fat (g)': 'satFatG', 'Trans Fat (g)': 'transFatG',
  'Cholesterol (mg)': 'cholesterolMg', 'Sodium (mg)': 'sodiumMg', 'Carbs (g)': 'carbsG', 'Fiber (g)': 'fiberG',
  'Sugars (g)': 'sugarG', 'Added Sugars (g)': 'addedSugarG', 'Protein (g)': 'proteinG',
};

function cleanName(raw: string): string {
  return cellText(raw).replace(/[®™]/g, '').replace(/\s+/g, ' ').trim();
}

export type FwRow ={ table: string; heading: string; kids: boolean; name: string; panel: Panel };

export function readRows(html: string): FwRow[] {
  const rows: FwRow[] = [];
  const tables = [...html.matchAll(/<table[^>]*nutrition-details-table[^>]*>([\s\S]*?)<\/table>/g)];
  if (tables.length === 0) throw new Error('first-watch-us: no nutrition table found');
  for (const t of tables) {
    const body = t[1];
    const table = (body.match(/<caption[^>]*id="([^"]+)-caption"/) ?? [])[1] ?? '';
    const heading = cellText((body.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) ?? [])[1] ?? '');
    const head = (body.match(/<thead>([\s\S]*?)<\/thead>/) ?? [])[1] ?? '';
    // The first <th> is the section heading; the rest are the data columns, in the order of each row's <td>s.
    const names = [...head.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].slice(1).map((m) => cellText(m[1]));
    for (const tr of body.matchAll(/<tr[^>]*class="nutrition-data-row"[^>]*>([\s\S]*?)<\/tr>/g)) {
      const name = cleanName((tr[1].match(/<h3[^>]*>([\s\S]*?)<\/h3>/) ?? [])[1] ?? '');
      const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => cellText(m[1]));
      if (!name) throw new Error(`first-watch-us: a row in table ${table} has no name`);
      if (cells.length !== names.length) throw new Error(`first-watch-us: ${name} has ${cells.length} cells for ${names.length} columns`);
      const values: Partial<Panel> = {};
      names.forEach((col, i) => {
        const field = COLUMNS[col];
        if (field) values[field] = num(cells[i]);
      });
      rows.push({ table, heading, kids: table === 'kids', name, panel: panelOf(values) });
    }
  }
  return rows;
}

const SIZE_SUFFIX = /\s*\((Small|Large)\)$/;

type Entry = { it: ChainItem; kids: boolean };

const adapter: ChainAdapter = {
  chain: 'first-watch-us',
  chainName: 'First Watch',
  country: 'US',
  route: 'html-table',
  sources: [{ id: SOURCE, kind: 'html-table', url: 'https://firstwatch.com/nutrition-and-allergens', landingUrl: null, file: 'nutrition-and-allergens.html' }],
  parse(bodies) {
    const byKey = new Map<string, Entry[]>();
    for (const row of readRows(bodies[SOURCE])) {
      if (SOURCE_ERRORS[row.name]) continue;
      let name = row.name;
      let key = `first-watch-${slugify(name)}`;
      let variant: string | null = null;
      const size = name.match(SIZE_SUFFIX);
      if (size) {
        const label = size[1].toLowerCase();
        name = name.replace(SIZE_SUFFIX, '');
        key = `first-watch-${slugify(name)}-${label}`;
        variant = `size=${label}`;
      }
      const it: ChainItem = { key, name, aliases: [], variant, servingG: null, panel: row.panel, sourceId: SOURCE, parts: [] };
      if (row.heading === 'Boozy') it.atwaterExempt = 'alcohol';
      byKey.set(key, [...(byKey.get(key) ?? []), { it, kids: row.kids }]);
    }
    const items = new Map<string, ChainItem>();
    for (const [key, entries] of byKey) {
      const sigs = new Set(entries.map((e) => JSON.stringify(e.it)));
      if (sigs.size === 1) {
        items.set(key, entries[0].it);
        continue;
      }
      const kids = new Set(entries.filter((e) => e.kids).map((e) => JSON.stringify(e.it)));
      const rest = new Set(entries.filter((e) => !e.kids).map((e) => JSON.stringify(e.it)));
      if (kids.size !== 1 || rest.size !== 1) throw new Error(`first-watch-us: item ${key} appears twice with different rows`);
      items.set(key, entries.find((e) => !e.kids)!.it);
      const kidsItem = entries.find((e) => e.kids)!.it;
      const sizeVariant = kidsItem.variant;
      items.set(`${key}-kids`, { ...kidsItem, key: `${key}-kids`, variant: sizeVariant ? `menu=kids;${sizeVariant}` : 'menu=kids' });
    }
    // Identical rows listed under two keys collapse to the smallest key.
    const byContent = new Map<string, ChainItem>();
    for (const it of [...items.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
      const sig = JSON.stringify([it.name, it.servingG, it.panel]);
      if (!byContent.has(sig)) byContent.set(sig, it);
    }
    return { items: [...byContent.values()], components: [] };
  },
  // Observed 2026-11-17 on each item's own page (a different URL from the table, same CMS); kcal only, item alone.
  spotChecks: [
    { id: 'truffle-bacon-brie-hash-page', itemKey: 'first-watch-truffle-bacon-and-brie-hash', removeComponentKeys: [], addParts: [],
      observed: panelOf({ kcal: 1150 }), observedAt: '2026-11-17', where: 'https://firstwatch.com/menu/truffle-bacon-brie-hash' },
    { id: 'chickichanga-page', itemKey: 'first-watch-chickichanga', removeComponentKeys: [], addParts: [],
      observed: panelOf({ kcal: 1150 }), observedAt: '2026-11-17', where: 'https://firstwatch.com/menu/chickichanga' },
    { id: 'traditional-breakfast-page', itemKey: 'first-watch-the-traditional-breakfast', removeComponentKeys: [], addParts: [],
      observed: panelOf({ kcal: 1000 }), observedAt: '2026-11-17', where: 'https://firstwatch.com/menu/the-traditional' },
  ],
};

export default adapter;
