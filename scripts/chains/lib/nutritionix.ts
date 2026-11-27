/**
 * The Nutritionix INM file's default modifiers as ITEM PARTS, shared by every Nutritionix adapter (Applebee's since
 * CHAIN-5b, lifted here unchanged for Taco John's in CHAIN-6b; mobile repo s471 / s472).
 *
 * Each kept item's `defaultModifiers` become its parts, in file order, and each modifier used as a default becomes ONE
 * component: key `<prefix>` + slugify(clean name), removalKeys [lowercase name], portions [] (the McDonald's shape: no
 * standalone portion is rendered). A part is { portionLabel null, quantity null, grams = servingWeightGrams (null when
 * 0), isDefault true, contribution, kcalPublished, without null }. contribution[F] = modifier.nutrition[F] x f,
 * f = servingWeightGrams / modifier.servingWeight when servingWeight > 0, else servingSize (the INM's own sum), at 4 dp;
 * addedSugarG null. kcalPublished = fdaRound('kcal', the UNROUNDED kcal contribution), the value the CUSTOMIZE list
 * shows. A missing modifier, a quantity other than 1, the same modifier twice in one item, a field that is not a
 * number, no serving factor, or two modifiers with one key all THROW. Modifier `isActive` is not read.
 */
import type { ChainComponent, ItemPart, Panel } from '../../../src/lib/chains/snapshot';
import { fdaRound } from './fda-round';
import type { FdaRule } from './fda-round';
import { panelOf, slugify } from './text';

// [item field, modifier field, panel field, rounding rule]
export const NIX_FIELDS: Array<[string, string, keyof Panel, FdaRule]> = [
  ['calculatedCalories', 'calories', 'kcal', 'kcal'],
  ['calculatedTotalFat', 'totalFat', 'fatG', 'fat'],
  ['calculatedSaturatedFat', 'saturatedFat', 'satFatG', 'fat'],
  ['calculatedTransFat', 'transFat', 'transFatG', 'fat'],
  ['calculatedCholesterol', 'cholesterol', 'cholesterolMg', 'chol'],
  ['calculatedSodium', 'sodium', 'sodiumMg', 'sodium'],
  ['calculatedTotalCarb', 'totalCarb', 'carbsG', 'gram'],
  ['calculatedFiber', 'fiber', 'fiberG', 'gram'],
  ['calculatedSugars', 'sugars', 'sugarG', 'gram'],
  ['calculatedProtein', 'protein', 'proteinG', 'gram'],
];
const BASIS = 'modifier panel x servingWeightGrams / modifier servingWeight (else x servingSize), 4 dp';

export type NixLink = { id: number | string; quantity?: number; servingSize?: number; servingWeightGrams?: number };
export type NixModifier = { id: number | string; name: string; nutrition?: Record<string, number | null> };

const dp4 = (v: number): number => Math.round(v * 1e4) / 1e4;

/** One default modifier inside one item: the part, from the INM's own sum. */
function partOf(chain: string, itemName: string, link: NixLink, mod: NixModifier, componentKey: string): ItemPart {
  if (link.quantity !== 1) throw new Error(`${chain}: ${itemName} default ${mod.name} has quantity ${link.quantity}, not 1`);
  const sw = mod.nutrition?.servingWeight;
  const grams = link.servingWeightGrams;
  const f = typeof sw === 'number' && sw > 0 && typeof grams === 'number' ? grams / sw : link.servingSize;
  if (typeof f !== 'number' || !Number.isFinite(f) || f <= 0) throw new Error(`${chain}: ${itemName} default ${mod.name} has no serving factor`);
  const values: Partial<Panel> = { addedSugarG: null };
  let kcal = 0;
  for (const [, mf, field] of NIX_FIELDS) {
    const v = mod.nutrition?.[mf];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${chain}: modifier ${mod.name} ${mf} is not a number`);
    if (field === 'kcal') kcal = v * f;
    values[field] = dp4(v * f);
  }
  return {
    componentKey,
    portionLabel: null,
    quantity: null,
    grams: typeof grams === 'number' && grams > 0 ? dp4(grams) : null,
    isDefault: true,
    kcalPublished: fdaRound('kcal', kcal),
    contribution: panelOf(values),
    contributionBasis: BASIS,
    without: null,
  };
}

/**
 * The default modifiers of one file, as parts and components. `parts()` is called once per kept item, in file order;
 * `components()` returns every component made so far, in first-use order.
 */
export function defaultParts(chain: string, prefix: string, modifiers: NixModifier[] | undefined, clean: (raw: string) => string) {
  const mods = new Map<string, NixModifier>();
  for (const m of modifiers ?? []) mods.set(String(m.id), m);
  const components = new Map<string, ChainComponent>();
  const componentOf = new Map<string, string>(); // component key -> modifier id
  return {
    parts(itemName: string, links: NixLink[]): ItemPart[] {
      const parts: ItemPart[] = [];
      const seen = new Set<string>();
      for (const link of links) {
        const id = String(link.id);
        const mod = mods.get(id);
        if (!mod) throw new Error(`${chain}: ${itemName} default modifier ${id} is not in modifiers`);
        if (seen.has(id)) throw new Error(`${chain}: ${itemName} lists default modifier ${id} twice`);
        seen.add(id);
        const modName = clean(mod.name);
        const ck = `${prefix}${slugify(modName)}`;
        const owner = componentOf.get(ck);
        if (owner !== undefined && owner !== id) throw new Error(`${chain}: component ${ck} appears twice (modifiers ${owner} and ${id})`);
        if (owner === undefined) {
          componentOf.set(ck, id);
          components.set(ck, { key: ck, name: modName, removalKeys: [modName.toLowerCase()], portions: [] });
        }
        parts.push(partOf(chain, itemName, link, mod, ck));
      }
      return parts;
    },
    components(): ChainComponent[] {
      return [...components.values()];
    },
  };
}
