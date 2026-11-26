/**
 * Chili's (US): the Nutritionix public file that chilis.com/nutrition hands off to (restaurant.nutritionix.com/chilis),
 * one gzipped JSON, https://nix-vue-inm.s3.amazonaws.com/restaurant/chilis/data/menu-latest.json.gz. Pre-digest and
 * refute (2026-11-25, mobile repo chain row 4): 358 items, 357 active; the panel is in the BASE fields and every
 * `calculated*` twin is 0 (Applebee's is the reverse), so this adapter reads base fields only, never calculated*.
 *
 * Rules this adapter applies:
 *  - Only `isActive === 1` items. The file has no components: sauces and sides are their own items, as published.
 *  - Rule Z: Nutritionix writes an unpublished field as 0. A field that is 0 on EVERY active item is unpublished and
 *    becomes null on every row (today addedSugars and servingWeight); any other 0 is a published label value.
 *  - A key is "chilis-" + slugify(cleaned name). Cleaned = entities decoded, marks removed, whitespace collapsed. Sizes
 *    stay in the name, variant null. NO identical-panel collapse: identical panels are often different foods (and one
 *    food under two menu names), so every published name keeps its own row. The same key twice is an error.
 *  - Items in the "Alcohol" tag or any of its children are atwaterExempt 'alcohol' (ethanol energy is not in P/C/F).
 *  - SOURCE_ERRORS are left out, never fixed.
 *  - sourceDate null; generatedAt is the file's own `generatedAt`, date part.
 */
import type { ChainItem, Panel } from '../../../src/lib/chains/snapshot';
import type { ChainAdapter } from '../lib/adapter';
import { decodeEntities, num, panelOf, slugify } from '../lib/text';

const SOURCE = 'menu';
const ALCOHOL_TAG = 'Alcohol';
// Left out, never "fixed": a published panel that contradicts itself.
const SOURCE_ERRORS: Record<string, string> = {
  'Sub Black Bean Patty': '180 kcal published against 218 from its own protein, carbs and fat',
};

const FIELDS: Record<string, keyof Panel> = {
  calories: 'kcal', protein: 'proteinG', totalCarb: 'carbsG', totalFat: 'fatG', saturatedFat: 'satFatG',
  transFat: 'transFatG', cholesterol: 'cholesterolMg', sodium: 'sodiumMg', fiber: 'fiberG', sugars: 'sugarG',
  addedSugars: 'addedSugarG',
};

type NixItem = { id: number | string; name: string; isActive: number; nutrition?: Record<string, number | null> };
type NixTag = { name: string; items?: Array<number | string>; children?: NixTag[] };
type NixFile = { generatedAt?: string; items?: NixItem[]; tags?: NixTag[] };

function cleanName(raw: string): string {
  return decodeEntities(raw).replace(/[®™]/g, '').replace(/\s+/g, ' ').trim();
}

function readFile(body: string): NixFile {
  let data: NixFile;
  try {
    data = JSON.parse(body) as NixFile;
  } catch (e) {
    throw new Error(`chilis-us: body is not JSON (${(e as Error).message})`);
  }
  if (!data || !Array.isArray(data.items)) throw new Error('chilis-us: no items array');
  return data;
}

function alcoholIds(tags: NixTag[]): Set<string> {
  const ids = new Set<string>();
  const addAll = (t: NixTag) => {
    for (const id of t.items ?? []) ids.add(String(id));
    for (const c of t.children ?? []) addAll(c);
  };
  for (const t of tags) if (decodeEntities(t.name).trim() === ALCOHOL_TAG) addAll(t);
  return ids;
}

const adapter: ChainAdapter = {
  chain: 'chilis-us',
  chainName: "Chili's",
  country: 'US',
  route: 'nutritionix',
  sources: [{ id: SOURCE, kind: 'nutritionix', url: 'https://nix-vue-inm.s3.amazonaws.com/restaurant/chilis/data/menu-latest.json.gz', landingUrl: 'https://www.chilis.com/nutrition', file: 'menu-latest.json' }],
  generatedAt(_id, body) {
    const g = readFile(body).generatedAt;
    if (typeof g !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(g)) throw new Error(`chilis-us: generatedAt "${g}" is not a date`);
    return g.slice(0, 10);
  },
  parse(bodies) {
    const data = readFile(bodies[SOURCE]);
    const active = (data.items ?? []).filter((i) => i.isActive === 1);
    // Rule Z: a base field that is 0 (or absent) on every active item is unpublished.
    const published = new Set<string>();
    for (const i of active) for (const f of [...Object.keys(FIELDS), 'servingWeight']) if ((i.nutrition?.[f] ?? 0) !== 0) published.add(f);
    const alcohol = alcoholIds(data.tags ?? []);
    const items = new Map<string, ChainItem>();
    for (const i of active) {
      const name = cleanName(i.name);
      if (SOURCE_ERRORS[name]) continue;
      const values: Partial<Panel> = {};
      for (const [f, field] of Object.entries(FIELDS)) values[field] = published.has(f) ? num(i.nutrition?.[f] ?? null) : null;
      const sw = published.has('servingWeight') ? num(i.nutrition?.servingWeight ?? null) : null;
      const key = `chilis-${slugify(name)}`;
      if (items.has(key)) throw new Error(`chilis-us: item ${key} appears twice`);
      const it: ChainItem = { key, name, aliases: [], variant: null, servingG: sw, panel: panelOf(values), sourceId: SOURCE, parts: [] };
      if (alcohol.has(String(i.id))) it.atwaterExempt = 'alcohol';
      items.set(key, it);
    }
    return { items: [...items.values()], components: [] };
  },
  // Observed 2026-11-25 on the chain's own rendered menu page (https://www.chilis.com/menu); kcal only, item alone.
  spotChecks: [
    { id: 'big-crispy-chicken-sandwich-menu', itemKey: 'chilis-big-crispy-chicken-sandwich', removeComponentKeys: [], addParts: [],
      observed: panelOf({ kcal: 880 }), observedAt: '2026-11-25', where: 'https://www.chilis.com/menu' },
    { id: 'bacon-cheeseburger-menu', itemKey: 'chilis-bacon-cheeseburger', removeComponentKeys: [], addParts: [],
      observed: panelOf({ kcal: 1130 }), observedAt: '2026-11-25', where: 'https://www.chilis.com/menu' },
    { id: 'margarita-grilled-chicken-menu', itemKey: 'chilis-margarita-grilled-chicken', removeComponentKeys: [], addParts: [],
      observed: panelOf({ kcal: 640 }), observedAt: '2026-11-25', where: 'https://www.chilis.com/menu' },
  ],
};

export default adapter;
