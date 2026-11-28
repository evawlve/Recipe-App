/**
 * Applebee's (US), items, their default COMPONENTS, the drinks and the Kids Menu tile: the Nutritionix public file that applebees.com/en/nutrition hands off to
 * (the page links /en/nutrition/interactive-menu, which embeds the calculator "Powered by Nutritionix"),
 * one gzipped JSON, https://nix-vue-inm.s3.amazonaws.com/restaurant/applebees/data/menu-latest.json.gz.
 *
 * Rules this adapter applies (mobile repo chain row 5 r2, 2026-11-26):
 *  R1 Provenance: the file is the one Applebee's own interactive menu renders, a first-party hand-off like Chili's.
 *  R2 One source, no sourceDate; generatedAt is the file's own `generatedAt`, date part (else throw).
 *  R3 Keep `isActive === 1 && defaultModifiers.length > 0 && !isCatering`. Category 'Catering (INM Only)' (the
 *     "(Serves 6-8)" platters and "(30)" wing trays) is left out, and so are the 11 builder parents (Fountain Drinks,
 *     Milkshakes, ...: no default modifiers, calculated 0 means "pick a drink", not a 0 kcal food; their drinks are R9). "Menu Items (INM
 *     Only)" (wing flavours, rib sauces, dressings) stays. No category with that name = throw: a rename must fail loudly.
 *  R4 The panel is in the `calculated*` fields ONLY (every base field is 0), each through `fdaRound` (the chain's own
 *     calculator sets useFdaRounding 1). addedSugarG and servingG are null on every row: Applebee's label shows neither.
 *  R5 A "less than" band rounds to null (see lib/fda-round.ts, whose tie rule is a choice and UNVERIFIED).
 *  R6 Key "applebees-" + slugify(cleanName); variant null; aliases empty; NO identical-panel collapse; a duplicate
 *     key throws. The dishes need no atwaterExempt (0 Atwater failures; the rows with protein under 1 g carry protein
 *     null, which the Atwater gate skips); the drinks' exemption and their one SOURCE_ERRORS row are R9.
 *  R7 Spot checks are FIRST-PARTY: read on applebees.com's interactive menu on 2026-11-26, kcal only.
 *  R8 (CHAIN-5b, mobile repo s471) Each kept item's `defaultModifiers` become its parts, in file order, and each
 *     modifier used as a default becomes ONE component: key "applebees-" + slugify(cleanName) (its own namespace: 12
 *     share a slug with an item, e.g. Signature Cole Slaw), removalKeys [lowercase name], portions [] (the McDonald's
 *     shape: no standalone portion is rendered; a base portion and the groups' Light / Extra multipliers are a later
 *     row). A part is { portionLabel null, quantity null, grams = servingWeightGrams (null when 0), isDefault true,
 *     contribution, kcalPublished, without null }. contribution[F] = modifier.nutrition[F] x f, f =
 *     servingWeightGrams / modifier.servingWeight when servingWeight > 0, else servingSize (the INM's own sum: every
 *     item's calculated panel equals fdaRound of its parts' sum, field by field), at 4 dp; addedSugarG null as on the
 *     item. kcalPublished = fdaRound('kcal', unrounded kcal contribution), the value the CUSTOMIZE list shows. A missing
 *     modifier, a quantity other than 1, the same modifier twice in one item, a field that is not a number, or two
 *     modifiers with one key all THROW. Since CHAIN-6b
 *     (mobile repo s472) the part code is lib/nutritionix.ts `defaultParts()`, shared with Taco John's, unchanged.
 *  R9 (CHAIN-5c, mobile repo s472) DRINKS, as the INM landing lists them: every modifier on the top-level tag
 *     "Beverages" or "Alcoholic Beverages" (the tag's own list and every child's; the landing's two drink tiles, 166 and
 *     39 on this file) becomes ONE item: key "applebees-" + slugify(cleanName), variant null (the size stays in the name:
 *     "(To Go)" is the 30 fl oz cup), aliases [], servingG null, parts [] (a drink is one food, not a build), panel =
 *     fdaRound of the MODIFIER's base fields at one serving (a modifier has no calculated* twin), addedSugarG null. Every
 *     "Alcoholic Beverages" drink is atwaterExempt 'alcohol' (ethanol energy is not in P/C/F; Chili's rule). The
 *     builder parents' groups hold 147 of the 166; of their other 19, the 9 kids shakes / smoothies / sundaes are R10
 *     and the 10 sampler dips are on no tile and stay out, as does the Limited Time Offers drink list. An inactive
 *     drink is left out; a SOURCE_ERRORS drink is left out, never fixed; a drink whose key is already an item is left
 *     out ONLY when DRINK_IS_ITEM names it (the item, with its parts, stays). A missing tag, a missing modifier, a
 *     field that is not a number, or any other key clash THROWS.
 *  R10 (CHAIN-5d, mobile repo s472) The KIDS MENU tile: every modifier on the top-level tag "Kids Menu" (its own list
 *     equals its children's: Beverages 2, Fruit Smoothies, Shakes & Sundaes 9, Sides 5, so 16 on this file) is an
 *     item by R9's code and R9's rules, after R9's two tiles; none is on the Alcoholic Beverages tile, so none is
 *     exempt. The tile's 9 items are dishes already (R3). Fries, 1% Milk and Broccoli are also default parts
 *     elsewhere, so each is both an item and a component under one key (R8: components are their own namespace).
 *     The Limited Time Offers tile's 8 drinks stay out: 5 of its cocktails fail Atwater and sit on no alcohol tag,
 *     so they need a named exempt list (a later row), and its Make It Spicy is already an R9 item.
 * Nothing imports the menu file.
 */
import type { ChainItem, Panel } from '../../../src/lib/chains/snapshot';
import type { ChainAdapter } from '../lib/adapter';
import { fdaRound } from '../lib/fda-round';
import { NIX_FIELDS, defaultParts } from '../lib/nutritionix';
import type { NixLink, NixModifier } from '../lib/nutritionix';
import { decodeEntities, panelOf, slugify } from '../lib/text';

const SOURCE = 'menu';
const CATERING = 'Catering (INM Only)';
const DRINK_TAGS = ['Beverages', 'Alcoholic Beverages', 'Kids Menu']; // R9's two drink tiles, then R10's Kids Menu tile
const ALCOHOL_TAG = 'Alcoholic Beverages';
// Left out, never "fixed": a published panel that contradicts itself.
const SOURCE_ERRORS: Record<string, string> = {
  "Owen's Nitro Infused Espresso": '30 kcal published against 60 from its own carbs (15 g) and no sugar alcohol listed',
};
// A drink that is also a kept item: the item, with its parts, stays. Any clash NOT named here throws.
const DRINK_IS_ITEM: Record<string, string> = {
  'Oreo Cookie Shake': 'the Desserts item (840 kcal, 4 parts); the Milkshakes row differs from it only in sugar, 72 g vs 71 g',
};
const WHERE = 'https://www.applebees.com/en/nutrition/interactive-menu';

type NixItem = {
  id: number | string;
  name: string;
  isActive: number;
  categoryId: number | string;
  defaultModifiers?: NixLink[];
  nutrition?: Record<string, number | null>;
};
type NixTag = { name: string; modifiers?: Array<number | string>; children?: NixTag[] };
type NixFile = {
  generatedAt?: string;
  categories?: Array<{ id: number | string; name: string }>;
  items?: NixItem[];
  modifiers?: Array<NixModifier & { isActive?: number }>;
  tags?: NixTag[];
};

function cleanName(raw: string): string {
  return decodeEntities(raw).replace(/[®™]/g, '').replace(/\s+/g, ' ').trim();
}

/** The modifier ids a top-level tag lists, its own and every child's, first-seen order, no repeats. */
function tagModifierIds(tags: NixTag[] | undefined, name: string): string[] {
  const tag = (tags ?? []).find((t) => decodeEntities(t.name).trim() === name);
  if (!tag) throw new Error(`applebees-us: no tag named "${name}"`);
  const ids = new Set<string>();
  const addAll = (t: NixTag) => {
    for (const id of t.modifiers ?? []) ids.add(String(id));
    for (const c of t.children ?? []) addAll(c);
  };
  addAll(tag);
  return [...ids];
}

function readFile(body: string): NixFile {
  let data: NixFile;
  try {
    data = JSON.parse(body) as NixFile;
  } catch (e) {
    throw new Error(`applebees-us: body is not JSON (${(e as Error).message})`);
  }
  if (!data || !Array.isArray(data.items)) throw new Error('applebees-us: no items array');
  if (!Array.isArray(data.categories)) throw new Error('applebees-us: no categories array');
  return data;
}

const adapter: ChainAdapter = {
  chain: 'applebees-us',
  chainName: "Applebee's",
  country: 'US',
  route: 'nutritionix',
  sources: [{ id: SOURCE, kind: 'nutritionix', url: 'https://nix-vue-inm.s3.amazonaws.com/restaurant/applebees/data/menu-latest.json.gz', landingUrl: 'https://www.applebees.com/en/nutrition', file: 'menu-latest.json' }],
  generatedAt(_id, body) {
    const g = readFile(body).generatedAt;
    if (typeof g !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(g)) throw new Error(`applebees-us: generatedAt "${g}" is not a date`);
    return g.slice(0, 10);
  },
  parse(bodies) {
    const data = readFile(bodies[SOURCE]);
    const catNames = new Map<string, string>();
    for (const c of data.categories ?? []) catNames.set(String(c.id), decodeEntities(c.name).trim());
    if (![...catNames.values()].includes(CATERING)) throw new Error(`applebees-us: no category named "${CATERING}"`);
    const book = defaultParts('applebees-us', 'applebees-', data.modifiers, cleanName);
    const items = new Map<string, ChainItem>();
    for (const i of data.items ?? []) {
      const catName = catNames.get(String(i.categoryId));
      const isCatering = catName === CATERING;
      if (!(i.isActive === 1 && (i.defaultModifiers ?? []).length > 0 && !isCatering)) continue;
      const name = cleanName(i.name);
      const values: Partial<Panel> = { addedSugarG: null };
      for (const [f, , field, rule] of NIX_FIELDS) {
        const v = i.nutrition?.[f];
        values[field] = typeof v === 'number' ? fdaRound(rule, v) : null;
      }
      const key = `applebees-${slugify(name)}`;
      if (items.has(key)) throw new Error(`applebees-us: item ${key} appears twice`);
      const parts = book.parts(name, i.defaultModifiers ?? []);
      items.set(key, { key, name, aliases: [], variant: null, servingG: null, panel: panelOf(values), sourceId: SOURCE, parts });
    }
    const mods = new Map<string, NixModifier & { isActive?: number }>();
    for (const m of data.modifiers ?? []) mods.set(String(m.id), m);
    const alcohol = new Set(tagModifierIds(data.tags, ALCOHOL_TAG));
    for (const tag of DRINK_TAGS) {
      for (const id of tagModifierIds(data.tags, tag)) {
        const m = mods.get(id);
        if (!m) throw new Error(`applebees-us: drink ${id} on tag "${tag}" is not in modifiers`);
        const name = cleanName(m.name);
        if (m.isActive !== 1 || SOURCE_ERRORS[name]) continue;
        const key = `applebees-${slugify(name)}`;
        if (items.has(key)) {
          if (DRINK_IS_ITEM[name]) continue;
          throw new Error(`applebees-us: item ${key} appears twice`);
        }
        const values: Partial<Panel> = { addedSugarG: null };
        for (const [, mf, field, rule] of NIX_FIELDS) {
          const v = m.nutrition?.[mf];
          if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`applebees-us: drink ${name} ${mf} is not a number`);
          values[field] = fdaRound(rule, v);
        }
        const drink: ChainItem = { key, name, aliases: [], variant: null, servingG: null, panel: panelOf(values), sourceId: SOURCE, parts: [] };
        if (alcohol.has(id)) drink.atwaterExempt = 'alcohol';
        items.set(key, drink);
      }
    }
    return { items: [...items.values()], components: book.components() };
  },
  // Observed 2026-11-26 on applebees.com's own interactive menu list; kcal only, item alone.
  spotChecks: [
    ['bacon-cheeseburger-wonton-tacos', 720],
    ['cheesy-chicken-skillet', 1330],
    ['signature-cole-slaw', 130],
    ['bourbon-street-chicken-and-sausage-penne', 1410],
    ['bourbon-street-shrimp-and-sausage-penne', 1290],
    ['classic-broccoli-alfredo-with-grilled-chicken', 1440],
  ].map(([k, kcal]) => ({
    id: `${k}-menu`, itemKey: `applebees-${k}`, removeComponentKeys: [], addParts: [],
    observed: panelOf({ kcal: kcal as number }), observedAt: '2026-11-26', where: WHERE,
  })),
};

export default adapter;
