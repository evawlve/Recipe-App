export type Unit = 'g'|'oz'|'lb'|'ml'|'tsp'|'tbsp'|'cup'|'floz';

const MASS_G: Record<Unit, number> = {
  g: 1, oz: 28.349523125, lb: 453.59237,
  ml: NaN, tsp: NaN, tbsp: NaN, cup: NaN, floz: NaN,
};

const VOL_ML: Record<Unit, number> = {
  ml: 1, tsp: 4.92892159375, tbsp: 14.78676478125, cup: 240, floz: 29.5735295625,
  g: NaN, oz: NaN, lb: NaN,
};

export const isMass   = (u: Unit) => !Number.isNaN(MASS_G[u]);
export const isVolume = (u: Unit) => !Number.isNaN(VOL_ML[u]);

export function convertMass(value: number, from: Unit, to: Unit) {
  if (!isMass(from) || !isMass(to)) throw new Error('mass units required');
  return value * MASS_G[from] / MASS_G[to];
}
export function convertVolume(value: number, from: Unit, to: Unit) {
  if (!isVolume(from) || !isVolume(to)) throw new Error('volume units required');
  return value * VOL_ML[from] / VOL_ML[to];
}

// density = grams per ml
export function gramsFromVolume(vol: number, unit: Unit, densityGml: number) {
  if (!isVolume(unit)) throw new Error('volume unit required');
  const ml = convertVolume(vol, unit, 'ml');
  return ml * densityGml; // grams
}
export function volumeFromGrams(grams: number, unit: Unit, densityGml: number) {
  if (!isVolume(unit)) throw new Error('volume unit required');
  const ml = grams / densityGml;
  return convertVolume(ml, 'ml', unit);
}

