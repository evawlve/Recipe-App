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
    'lb': 'lb', 'lbs': 'lb', 'pound': 'lb', 'pounds': 'lb',
    'kg': 'kg', 'kilogram': 'kg', 'kilograms': 'kg'
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
    'floz': 'floz', 'fl oz': 'floz', 'fluid ounce': 'floz', 'fluid ounces': 'floz',
    'l': 'l', 'liter': 'l', 'liters': 'l',
    'pint': 'pint', 'pints': 'pint',
    'quart': 'quart', 'quarts': 'quart',
    'gallon': 'gallon', 'gallons': 'gallon'
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
    'package': 'package', 'packages': 'package',  // For packaged goods (spinach, etc.)
    'sachet': 'sachet', 'sachets': 'sachet',  // Alternative for packet
    'pouch': 'pouch', 'pouches': 'pouch',
    'stick': 'stick', 'sticks': 'stick',  // For butter, gum, etc.
    'container': 'container', 'containers': 'container',
    'envelope': 'envelope', 'envelopes': 'envelope',  // For gelatin, yeast packets
    'serving': 'serving', 'servings': 'serving',  // Generic serving unit
    'box': 'box', 'boxes': 'box',
    'bag': 'bag', 'bags': 'bag',
    'sleeve': 'sleeve', 'sleeves': 'sleeve',  // For crackers, cookies
    'tub': 'tub', 'tubs': 'tub',  // For yogurt, spreads
    'carton': 'carton', 'cartons': 'carton',  // For eggs, milk
    'jar': 'jar', 'jars': 'jar',
    'bottle': 'bottle', 'bottles': 'bottle',
    'tray': 'tray', 'trays': 'tray',
    // Size descriptors for whole produce (triggers AI backfill for realistic weights)
    'small': 'small', 'medium': 'medium', 'large': 'large', 'whole': 'whole',
    // Produce-specific units (bunch, head, stalk, etc.)
    'bunch': 'bunch', 'bunches': 'bunch',  // For spinach, kale, herbs, grapes
    'head': 'head', 'heads': 'head',  // For lettuce, cabbage, garlic
    'stalk': 'stalk', 'stalks': 'stalk',  // For celery, lemongrass
    'sprig': 'sprig', 'sprigs': 'sprig',  // For herbs (thyme, rosemary)
    'clove': 'clove', 'cloves': 'clove',  // For garlic
    'leaf': 'leaf', 'leaves': 'leaf',  // For herbs, bay leaves
    'ear': 'ear', 'ears': 'ear',  // For corn
    'rib': 'rib', 'ribs': 'rib',  // For celery ribs
    'bulb': 'bulb', 'bulbs': 'bulb',  // For fennel, garlic
    'crown': 'crown', 'crowns': 'crown',  // For broccoli
    'floret': 'floret', 'florets': 'floret',  // For broccoli, cauliflower
    'strip': 'strip', 'strips': 'strip', // For bell peppers, bacon
    'spray': 'spray', 'sprays': 'spray', // For cooking spray, oil sprays
    'squirt': 'squirt', 'squirts': 'squirt',
    'breast': 'breast', 'breasts': 'breast', // For chicken breast
    'thigh': 'thigh', 'thighs': 'thigh', // For chicken thigh
    // Portion units (Cluster A pt2 Defect 4, Jul 2026): previously unrecognized,
    // so "1 handful almonds" parsed as a unitless count of "handful almonds"
    // and billed ONE almond's seed weight. As count units they route to the
    // ambiguous-serving estimator, which has portion floors for them.
    'handful': 'handful', 'handfuls': 'handful',
    'bowl': 'bowl', 'bowls': 'bowl',
    'plate': 'plate', 'plates': 'plate',
  };

  if (countUnits[token]) {
    return { kind: 'count', unit: countUnits[token] };
  }

  // Small volume units (pinch, dash, drop, second, etc.)
  const smallVolumeUnits: Record<string, string> = {
    'pinch': 'pinch', 'pinches': 'pinch',
    'dash': 'dash', 'dashes': 'dash',
    // Micro liquid units
    'drop': 'drop', 'drops': 'drop',     // 1 drop ≈ 0.05ml (e.g., drops of tabasco, liquid stevia)
    // Cooking spray duration — "0.4 second spray" is ~0.25ml of oil
    'second': 'second', 'seconds': 'second',
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
  'dash': 0.6,
  'drop': 0.05,    // 1 drop (medicine dropper / sauce) ≈ 0.05ml
  'second': 0.25,  // 1 second of cooking spray ≈ 0.25ml → ~0.23g oil
  'l': 1000,
  'pint': 473.176,
  'quart': 946.353,
  'gallon': 3785.41
};

const MASS_IN_G: Record<string, number> = {
  'g': 1,
  'oz': 28.35,
  'lb': 453.6,
  'kg': 1000
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
