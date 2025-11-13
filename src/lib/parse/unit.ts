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
    'lb': 'lb', 'pound': 'lb', 'pounds': 'lb'
  };

  if (massUnits[token]) {
    return { kind: 'mass', unit: massUnits[token] };
  }

  // Volume units
  const volumeUnits: Record<string, string> = {
    'tsp': 'tsp', 'teaspoon': 'tsp', 'teaspoons': 'tsp',
    'tbsp': 'tbsp', 'tablespoon': 'tbsp', 'tablespoons': 'tbsp',
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
    'block': 'block', 'blocks': 'block' // For tofu, cheese blocks, etc.
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
    'third': 1/3,
    '½': 0.5,
    '¼': 0.25,
    '⅓': 1/3
  };

  if (multipliers[token]) {
    return { kind: 'multiplier', factor: multipliers[token] };
  }

  // Unknown unit
  return { kind: 'unknown', raw: token };
}
