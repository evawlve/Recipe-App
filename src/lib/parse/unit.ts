/**
 * Normalize unit tokens to standard categories
 */

export type NormalizedUnit =
  | { kind: 'mass'; unit: string }
  | { kind: 'volume'; unit: string }
  | { kind: 'count'; unit: string }
  | { kind: 'multiplier'; factor: number }
  | { kind: 'unknown'; raw: string };

export function normalizeUnitToken(tok: string): NormalizedUnit {
  const token = tok.toLowerCase().trim();

  // Mass units
  const massUnits: Record<string, string> = {
    'g': 'g', 'gram': 'g', 'grams': 'g',
    'oz': 'oz', 'ounce': 'oz', 'ounces': 'oz',
    'lb': 'lb', 'lbs': 'lb', 'pound': 'lb', 'pounds': 'lb'
  };

  if (massUnits[token]) {
    return { kind: 'mass', unit: massUnits[token] };
  }

  // Volume units
  const volumeUnits: Record<string, string> = {
    'tsp': 'tsp', 'tsps': 'tsp', 'teaspoon': 'tsp', 'teaspoons': 'tsp',
    'tbsp': 'tbsp', 'tbsps': 'tbsp', 'tablespoon': 'tbsp', 'tablespoons': 'tbsp',
    'cup': 'cup', 'cups': 'cup',
    'ml': 'ml', 'milliliter': 'ml', 'milliliters': 'ml',
    'floz': 'floz', 'fl oz': 'floz', 'fluid ounce': 'floz', 'fluid ounces': 'floz'
  };

  if (volumeUnits[token]) {
    return { kind: 'volume', unit: volumeUnits[token] };
  }

  // Count units (food-specific)
  const countUnits: Record<string, string> = {
    'piece': 'piece', 'pieces': 'piece',
    'bar': 'bar', 'bars': 'bar',
    'scoop': 'scoop', 'scoops': 'scoop',
    'slice': 'slice', 'slices': 'slice',
    'egg': 'egg', 'eggs': 'egg',
    'can': 'can', 'cans': 'can',
    'block': 'block', 'blocks': 'block', // For tofu, cheese blocks, etc.
    'cube': 'cube', 'cubes': 'cube',
    'packet': 'packet', 'packets': 'packet',  // For sweeteners, seasonings, etc.
    'sachet': 'sachet', 'sachets': 'sachet',  // Alternative for packet
    'pouch': 'pouch', 'pouches': 'pouch',
    'stick': 'stick', 'sticks': 'stick',  // For butter, gum, etc.
    'container': 'container', 'containers': 'container',
    'envelope': 'envelope', 'envelopes': 'envelope',  // For gelatin, yeast packets
    'serving': 'serving', 'servings': 'serving'  // Generic serving unit
  };

  if (countUnits[token]) {
    return { kind: 'count', unit: countUnits[token] };
  }

  // Small volume units (pinch, dash, etc.)
  const smallVolumeUnits: Record<string, string> = {
    'pinch': 'pinch', 'pinches': 'pinch',
    'dash': 'dash', 'dashes': 'dash'
  };

  if (smallVolumeUnits[token]) {
    return { kind: 'volume', unit: smallVolumeUnits[token] };
  }

  // Multipliers
  const multipliers: Record<string, number> = {
    'half': 0.5,
    'quarter': 0.25,
    'third': 1 / 3,
    '½': 0.5,
    '¼': 0.25,
    '⅓': 1 / 3
  };

  if (multipliers[token]) {
    return { kind: 'multiplier', factor: multipliers[token] };
  }

  // Unknown unit
  return { kind: 'unknown', raw: token };
}

// Simple conversion factors relative to a base unit (ml for volume, g for mass)
const VOLUME_IN_ML: Record<string, number> = {
  'ml': 1,
  'tsp': 4.92,
  'tbsp': 14.79,
  'floz': 29.57,
  'cup': 240, // Standard US cup for simplicity in this context
  'pinch': 0.3,
  'dash': 0.6
};

const MASS_IN_G: Record<string, number> = {
  'g': 1,
  'oz': 28.35,
  'lb': 453.6
};

export function convertUnit(qty: number, fromUnit: string, toUnit: string): number | null {
  const normFrom = normalizeUnitToken(fromUnit);
  const normTo = normalizeUnitToken(toUnit);

  if (normFrom.kind !== normTo.kind) return null;

  if (normFrom.kind === 'volume' && normTo.kind === 'volume') {
    const fromFactor = VOLUME_IN_ML[normFrom.unit];
    const toFactor = VOLUME_IN_ML[normTo.unit];
    if (fromFactor && toFactor) {
      return qty * (fromFactor / toFactor);
    }
  }

  if (normFrom.kind === 'mass' && normTo.kind === 'mass') {
    const fromFactor = MASS_IN_G[normFrom.unit];
    const toFactor = MASS_IN_G[normTo.unit];
    if (fromFactor && toFactor) {
      return qty * (fromFactor / toFactor);
    }
  }

  return null;
}
