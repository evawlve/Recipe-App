/**
 * Applebee's (US), items and their default COMPONENTS: the Nutritionix public file that applebees.com/en/nutrition hands off to
 * (the page links /en/nutrition/interactive-menu, which embeds the calculator "Powered by Nutritionix"),
 * one gzipped JSON, https://nix-vue-inm.s3.amazonaws.com/restaurant/applebees/data/menu-latest.json.gz.
 *
 * Rules this adapter applies (mobile repo chain row 5 r2, 2026-11-26):
 *  R1 Provenance: the file is the one Applebee's own interactive menu renders, a first-party hand-off like Chili's.
 *  R2 One source, no sourceDate; generatedAt is the file's own `generatedAt`, date part (else throw).
 *  R3 Keep `isActive === 1 && defaultModifiers.length > 0 && !isCatering`. Category 'Catering (INM Only)' (the
 *     "(Serves 6-8)" platters and "(30)" wing trays) is left out, and so are the 11 builder parents (Fountain Drinks,
 *     Milkshakes, ...: no default modifiers, calculated 0 means "pick a drink", not a 0 kcal food). "Menu Items (INM
 *     Only)" (wing flavours, rib sauces, dressings) stays. No category with that name = throw: a rename must fail loudly.
 *  R4 The panel is in the `calculated*` fields ONLY (every base field is 0), each through `fdaRound` (the chain's own
 *     calculator sets useFdaRounding 1). addedSugarG and servingG are null on every row: Applebee's label shows neither.
 *  R5 A "less than" band rounds to null (see lib/fda-round.ts, whose tie rule is a choice and UNVERIFIED).
 *  R6 Key "applebees-" + slugify(cleanName); variant null; aliases empty; NO identical-panel collapse; a duplicate
 *     key throws. No atwaterExempt and no SOURCE_ERRORS (0 Atwater failures on this file; the rows with protein under
 *     1 g carry protein null, which the Atwater gate skips).
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
 *     modifiers with one key all THROW. The builder parents' drinks are still left out (a later row). Since CHAIN-6b
 *     (mobile repo s472) the part code is lib/nutritionix.ts `defaultParts()`, shared with Taco John's, unchanged.
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
const WHERE = 'https://www.applebees.com/en/nutrition/interactive-menu';

type NixItem = {
  id: number | string;
  name: string;
  isActive: number;
  categoryId: number | string;
  defaultModifiers?: NixLink[];
  nutrition?: Record<string, number | null>;
};
type NixFile = {
  generatedAt?: string;
  categories?: Array<{ id: number | string; name: string }>;
  items?: NixItem[];
  modifiers?: NixModifier[];
};

function cleanName(raw: string): string {
  return decodeEntities(raw).replace(/[®™]/g, '').replace(/\s+/g, ' ').trim();
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
