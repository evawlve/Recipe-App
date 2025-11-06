import { ParsedIngredient } from '../parse/ingredient-line';

/**
 * Resolve grams from parsed ingredient using serving options
 * Handles count units by matching serving option labels
 */
export function resolveGramsFromParsed(
  parsed: ParsedIngredient, 
  servingOptions: Array<{ label: string; grams: number }>
): number | null {
  if (!parsed || servingOptions.length === 0) return null;

  const qtyEff = parsed.qty * parsed.multiplier;

  // For count units, try to find a matching serving option
  if (parsed.unit) {
    const unitLower = parsed.unit.toLowerCase();
    
    // Treat empty string, "whole", "count", "piece" as synonyms for countable items
    const countUnitAliases = ['whole', 'count', 'piece', 'each', 'unit'];
    const isCountUnit = countUnitAliases.includes(unitLower);
    
    // Look for exact or partial matches in serving option labels
    const matchingOption = servingOptions.find(option => {
      const labelLower = option.label.toLowerCase();
      
      // For count units, match labels like "1 large", "1 egg", "1 piece", etc.
      if (isCountUnit) {
        return /\b(large|medium|small|egg|piece|whole|each|unit|serving)\b/.test(labelLower);
      }
      
      // Otherwise, match the unit keyword in the label
      return labelLower.includes(unitLower);
    });

    if (matchingOption) {
      return qtyEff * matchingOption.grams;
    }
  }

  // If no unit or no match found, try to find a sensible default
  // Prefer options with "large", "medium", or "egg" in the label over generic "100 g"
  const countOption = servingOptions.find(option => 
    /\b(large|medium|small|egg|piece|whole|each)\b/i.test(option.label)
  );
  
  if (countOption) {
    return qtyEff * countOption.grams;
  }

  // Fallback to first serving option if available
  if (servingOptions[0]) {
    return qtyEff * servingOptions[0].grams;
  }

  return null;
}
