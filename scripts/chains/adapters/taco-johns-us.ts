/**
 * Taco John's (US), items and their default COMPONENTS: the Nutritionix public file behind Taco John's nutrition calculator
 * (www.tacojohns.com/nutrition/ answers 301 to tacojohns.com/nutrition-calculator/), one gzipped JSON,
 * https://nix-vue-inm.s3.amazonaws.com/restaurant/taco-johns/data/menu-latest.json.gz.
 *
 * Rules this adapter applies (mobile repo chain row 6, 2026-11-26):
 *  R1 Provenance: the file is the one Taco John's own calculator renders (D1 names Taco John's among the Nutritionix chains).
 *  R2 One source, no sourceDate; generatedAt is the file's own `generatedAt`, date part (else throw).
 *  R3 Keep `isActive === 1 && defaultModifiers.length > 0 && !isPreview`. The four categories flagged `previewOnly: 1`
 *     ("Preview Only - Burritos / Tacos / Favorites / Breakfast": protein-swap variants such as "Crispy Taco, Chicken")
 *     are left out; a category whose `previewOnly` is not 0 or 1 throws, so a renamed flag fails loudly. Drinks, sides,
 *     sauces and Kid's Meals stay: each is an item with its own published panel. There are no builder parents.
 *  R4 The panel is in the `calculated*` fields ONLY (every base field is 0), each through `fdaRound` (the chain's own
 *     calculator sets useFdaRounding 1). addedSugarG and servingG are null on every row: the label shows neither.
 *  R5 A "less than" band rounds to null; exact ties go to the even multiple (lib/fda-round.ts; UNVERIFIED rule).
 *  R6 Key "taco-johns-" + slugify(cleanName); variant null; aliases empty; NO identical-panel collapse; a duplicate
 *     key throws. No atwaterExempt and no SOURCE_ERRORS (0 Atwater failures on this file).
 *  R7 Spot checks, kcal only (see the brief for where they were observed).
 *  R8 (CHAIN-6b, mobile repo s472) Each kept item's `defaultModifiers` become its parts and each modifier used as a
 *     default becomes ONE component, key "taco-johns-" + slugify(cleanName) (its own namespace: 13 share a slug with an
 *     item), through lib/nutritionix.ts `defaultParts()`, the code Applebee's ships (CHAIN-5b), unchanged: its header
 *     holds the formula, the 4 dp contributions, kcalPublished and the throws. On this file one cell of 1,350 does not
 *     close exactly: Tropicana Orange Juice, whose file kcal 165.0001 labels 170 while its one part, 165.0000 at 4 dp,
 *     sums to the tie 165 (160); no single precision closes both it and the four drinks' x.5 ties. Its kcalPublished
 *     is 170. The preview-only protein variants stay left out (R3); the groups' Light / Extra multipliers are later.
 * Nothing imports the menu file.
 */
import type { ChainItem, Panel } from '../../../src/lib/chains/snapshot';
import type { ChainAdapter } from '../lib/adapter';
import { fdaRound } from '../lib/fda-round';
import { NIX_FIELDS, defaultParts } from '../lib/nutritionix';
import type { NixLink, NixModifier } from '../lib/nutritionix';
import { decodeEntities, panelOf, slugify } from '../lib/text';

const SOURCE = 'menu';
const WHERE = 'https://tacojohns.com/nutrition-calculator/';

type NixItem = {
  id: number | string;
  name: string;
  isActive: number;
  categoryId: number | string;
  defaultModifiers?: NixLink[];
  nutrition?: Record<string, number | null>;
};
type NixCategory = { id: number | string; name: string; previewOnly?: unknown };
type NixFile = { generatedAt?: string; categories?: NixCategory[]; items?: NixItem[]; modifiers?: NixModifier[] };

function cleanName(raw: string): string {
  return decodeEntities(raw).replace(/[®™]/g, '').replace(/\s+/g, ' ').trim();
}

function readFile(body: string): NixFile {
  let data: NixFile;
  try {
    data = JSON.parse(body) as NixFile;
  } catch (e) {
    throw new Error(`taco-johns-us: body is not JSON (${(e as Error).message})`);
  }
  if (!data || !Array.isArray(data.items)) throw new Error('taco-johns-us: no items array');
  if (!Array.isArray(data.categories)) throw new Error('taco-johns-us: no categories array');
  return data;
}

const adapter: ChainAdapter = {
  chain: 'taco-johns-us',
  chainName: "Taco John's",
  country: 'US',
  route: 'nutritionix',
  sources: [{ id: SOURCE, kind: 'nutritionix', url: 'https://nix-vue-inm.s3.amazonaws.com/restaurant/taco-johns/data/menu-latest.json.gz', landingUrl: 'https://tacojohns.com/nutrition-calculator/', file: 'menu-latest.json' }],
  generatedAt(_id, body) {
    const g = readFile(body).generatedAt;
    if (typeof g !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(g)) throw new Error(`taco-johns-us: generatedAt "${g}" is not a date`);
    return g.slice(0, 10);
  },
  parse(bodies) {
    const data = readFile(bodies[SOURCE]);
    const preview = new Map<string, boolean>();
    for (const c of data.categories ?? []) {
      if (c.previewOnly !== 0 && c.previewOnly !== 1) throw new Error(`taco-johns-us: category "${c.name}" has previewOnly ${String(c.previewOnly)}`);
      preview.set(String(c.id), c.previewOnly === 1);
    }
    const book = defaultParts('taco-johns-us', 'taco-johns-', data.modifiers, cleanName);
    const items = new Map<string, ChainItem>();
    for (const i of data.items ?? []) {
      const isPreview = preview.get(String(i.categoryId)) === true;
      if (!(i.isActive === 1 && (i.defaultModifiers ?? []).length > 0 && !isPreview)) continue;
      const name = cleanName(i.name);
      const values: Partial<Panel> = { addedSugarG: null };
      for (const [f, , field, rule] of NIX_FIELDS) {
        const v = i.nutrition?.[f];
        values[field] = typeof v === 'number' ? fdaRound(rule, v) : null;
      }
      const key = `taco-johns-${slugify(name)}`;
      if (items.has(key)) throw new Error(`taco-johns-us: item ${key} appears twice`);
      const parts = book.parts(name, i.defaultModifiers ?? []);
      items.set(key, { key, name, aliases: [], variant: null, servingG: null, panel: panelOf(values), sourceId: SOURCE, parts });
    }
    return { items: [...items.values()], components: book.components() };
  },
  spotChecks: [
    ['meat-and-potato-burrito', 510],
    ['crispy-taco', 150],
    ['super-nachos', 800],
    ['potato-oles-medium', 650],
    ['boss-burrito', 770],
    ['churro', 220],
  ].map(([k, kcal]) => ({
    id: `${k}-menu`, itemKey: `taco-johns-${k}`, removeComponentKeys: [], addParts: [],
    observed: panelOf({ kcal: kcal as number }), observedAt: '2026-11-26', where: WHERE,
  })),
};

export default adapter;
