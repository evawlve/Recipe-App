/**
 * Unit Type Classification
 * 
 * Classifies ingredient units into types for proper serving selection.
 * Key insight: The REQUESTED unit type matters, not the food's physical state.
 * "1 cup diced apples" needs volume, "3 slices capocollo" needs count.
 */

export type UnitType = 'count' | 'volume' | 'mass' | 'unknown';

// Count-based units - discrete items
const COUNT_UNITS = new Set([
    // Slices and pieces
    'slice', 'slices', 'piece', 'pieces', 'pc', 'pcs',

    // Individual items
    'item', 'items', 'each', 'ea', 'unit', 'units',

    // Packages and containers
    'packet', 'packets', 'sachet', 'sachets', 'pouch', 'pouches',
    'stick', 'sticks', 'bar', 'bars', 'envelope', 'envelopes',
    'container', 'containers', 'can', 'cans', 'bottle', 'bottles',
    'scoop', 'scoops', 'serving', 'servings',

    // Food-specific counts
    'tortilla', 'tortillas', 'egg', 'eggs', 'bagel', 'bagels',
    'patty', 'patties', 'fillet', 'fillets', 'breast', 'breasts',
    'thigh', 'thighs', 'wing', 'wings', 'drumstick', 'drumsticks',
    'clove', 'cloves', 'stalk', 'stalks', 'leaf', 'leaves', 'sprig', 'sprigs',
    'strip', 'strips', 'wedge', 'wedges', 'cube', 'cubes',

    // Baked goods
    'cookie', 'cookies', 'cracker', 'crackers', 'chip', 'chips',
    'muffin', 'muffins', 'roll', 'rolls', 'bun', 'buns',
    'wafer', 'wafers', 'sheet', 'sheets',

    // Generic counts
    'small', 'medium', 'large', 'whole',

    // Spray/squirt (for cooking spray, oil sprays)
    'spray', 'sprays', 'squirt', 'squirts',
]);

// Volume-based units
const VOLUME_UNITS = new Set([
    'cup', 'cups', 'c',
    'tbsp', 'tablespoon', 'tablespoons', 'tbs',
    'tsp', 'teaspoon', 'teaspoons',
    'ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres',
    'l', 'liter', 'liters', 'litre', 'litres',
    'floz', 'fl oz', 'fluid ounce', 'fluid ounces',
    'pint', 'pints', 'quart', 'quarts', 'gallon', 'gallons',
    'dash', 'dashes', 'pinch', 'pinches',
]);

// Mass-based units
const MASS_UNITS = new Set([
    'g', 'gram', 'grams',
    'kg', 'kilogram', 'kilograms',
    'oz', 'ounce', 'ounces',
    'lb', 'pound', 'pounds',
    'mg', 'milligram', 'milligrams',
]);

/**
 * Classify a unit string into its type
 */
export function classifyUnit(unit: string | null | undefined): UnitType {
    if (!unit) return 'unknown';

    const normalized = unit.toLowerCase().trim();

    if (COUNT_UNITS.has(normalized)) return 'count';
    if (VOLUME_UNITS.has(normalized)) return 'volume';
    if (MASS_UNITS.has(normalized)) return 'mass';

    // Check for common patterns
    if (/^(small|medium|large|x-large|extra.?large)$/i.test(normalized)) {
        return 'count';  // Size descriptors typically mean count
    }

    return 'unknown';
}

/**
 * Get all aliases for a unit (for matching serving descriptions)
 */
export function getUnitAliases(unit: string): string[] {
    const normalized = unit.toLowerCase().trim();

    const aliasMap: Record<string, string[]> = {
        'slice': ['slice', 'slices', 'sliced'],
        'piece': ['piece', 'pieces', 'pc', 'pcs'],
        'cup': ['cup', 'cups', 'c'],
        'tbsp': ['tbsp', 'tablespoon', 'tablespoons', 'tbs'],
        'tsp': ['tsp', 'teaspoon', 'teaspoons'],
        'oz': ['oz', 'ounce', 'ounces'],
        'g': ['g', 'gram', 'grams'],
        'ml': ['ml', 'milliliter', 'milliliters'],
        'item': ['item', 'items', 'each', 'ea'],
        'tortilla': ['tortilla', 'tortillas'],
        'egg': ['egg', 'eggs'],
    };

    // Find which alias group this unit belongs to
    for (const [key, aliases] of Object.entries(aliasMap)) {
        if (key === normalized || aliases.includes(normalized)) {
            return aliases;
        }
    }

    return [normalized];
}

/**
 * Check if a serving description matches a unit type
 */
export function servingMatchesUnitType(
    servingDescription: string,
    unitType: UnitType
): boolean {
    const desc = servingDescription.toLowerCase();

    if (unitType === 'count') {
        // Check for count indicators in description
        for (const countUnit of COUNT_UNITS) {
            if (desc.includes(countUnit)) return true;
        }
        // Also check for numeric count patterns like "1 tortilla", "2 slices"
        if (/^\d+\s+(tortilla|slice|piece|egg|item)/i.test(desc)) return true;
        return false;
    }

    if (unitType === 'volume') {
        for (const volUnit of VOLUME_UNITS) {
            if (desc.includes(volUnit)) return true;
        }
        return false;
    }

    if (unitType === 'mass') {
        for (const massUnit of MASS_UNITS) {
            if (desc.includes(massUnit)) return true;
        }
        // Check for patterns like "100g", "100 g"
        if (/\d+\s*g\b/i.test(desc)) return true;
        return false;
    }

    return false;
}

/**
 * Check if a serving description is a "generic" serving (not specific to any unit type)
 */
export function isGenericServing(servingDescription: string): boolean {
    const desc = servingDescription.toLowerCase().trim();

    // Generic patterns
    const genericPatterns = [
        /^serving$/,
        /^1?\s*serving$/,
        /^standard\s*serving$/,
        /^portion$/,
        /^1?\s*portion$/,
    ];

    return genericPatterns.some(p => p.test(desc));
}
