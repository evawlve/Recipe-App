/**
 * Prep-modifier extraction for ingredient lines.
 *
 * This module once also generated category-specific "pre-emptive" servings
 * (`generatePreemptiveServings`, `detectFoodCategory`,
 * `CATEGORY_PREEMPTIVE_SERVINGS`). That surface had no callers and is gone;
 * what remains is the modifier vocabulary and its matchers, which
 * `map-ingredient-with-fallback.ts` uses to tell "1 cup chopped onion" from
 * "1 cup onion".
 */

// ============================================================
// Modifier Extraction from Parsed Ingredients
// ============================================================

/**
 * Known prep modifiers that affect serving density.
 * Ordered by specificity (longer phrases first).
 */
export const KNOWN_PREP_MODIFIERS = [
    // Compound modifiers (check first)
    'finely chopped',
    'finely diced',
    'finely minced',
    'coarsely chopped',
    'roughly chopped',
    'thinly sliced',
    'thickly sliced',
    // Single modifiers
    'cubed',
    'diced',
    'sliced',
    'chopped',
    'minced',
    'grated',
    'shredded',
    'mashed',
    'pureed',
    'crushed',
    'julienned',
    'packed',
    'crumbled',
    'torn',
    'halved',
    'quartered',
];

/**
 * Extract prep modifier from an ingredient line or parsed modifiers array.
 * Returns the first matching known modifier.
 */
export function extractPrepModifier(
    rawLine: string,
    parsedModifiers?: string[]
): string | undefined {
    // First check parsed modifiers if available
    if (parsedModifiers && parsedModifiers.length > 0) {
        for (const modifier of parsedModifiers) {
            const lower = modifier.toLowerCase();
            if (KNOWN_PREP_MODIFIERS.includes(lower)) {
                // Simplify compound modifiers to base form
                if (lower.includes('chopped')) return 'chopped';
                if (lower.includes('diced')) return 'diced';
                if (lower.includes('minced')) return 'minced';
                if (lower.includes('sliced')) return 'sliced';
                return lower;
            }
        }
    }

    // Fall back to scanning the raw line
    const lowerLine = rawLine.toLowerCase();
    for (const modifier of KNOWN_PREP_MODIFIERS) {
        if (lowerLine.includes(modifier)) {
            // Simplify compound modifiers to base form
            if (modifier.includes('chopped')) return 'chopped';
            if (modifier.includes('diced')) return 'diced';
            if (modifier.includes('minced')) return 'minced';
            if (modifier.includes('sliced')) return 'sliced';
            return modifier;
        }
    }

    return undefined;
}

/**
 * Check if a serving description already includes the given modifier.
 */
export function servingHasModifier(servingDescription: string, modifier: string): boolean {
    return servingDescription.toLowerCase().includes(modifier.toLowerCase());
}

/**
 * Find a serving that matches both unit and modifier.
 * Returns null if not found.
 */
export function findServingWithModifier<T extends { description?: string | null; measurementDescription?: string | null }>(
    servings: T[],
    unit: string,
    modifier?: string
): T | null {
    const targetLabel = modifier ? `${unit} ${modifier}` : unit;
    const targetLabelAlt = modifier ? `${modifier} ${unit}` : unit;  // Some labels might be "minced tbsp"

    for (const serving of servings) {
        const desc = (serving.description ?? serving.measurementDescription ?? '').toLowerCase();
        if (desc.includes(targetLabel.toLowerCase()) || desc.includes(targetLabelAlt.toLowerCase())) {
            return serving;
        }
    }

    // If no modifier match, try just the unit as fallback
    if (modifier) {
        for (const serving of servings) {
            const desc = (serving.description ?? serving.measurementDescription ?? '').toLowerCase();
            if (desc.includes(unit.toLowerCase()) && !desc.includes(modifier.toLowerCase())) {
                // Found unit without modifier - could be used as fallback
                return null;  // Return null to trigger on-demand backfill
            }
        }
    }

    return null;
}
