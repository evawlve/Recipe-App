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
    // Look for serving option whose label contains the unit keyword (case-insensitive)
    const matchingOption = servingOptions.find(option => 
      option.label.toLowerCase().includes(parsed.unit!.toLowerCase())
    );

    if (matchingOption) {
      return qtyEff * matchingOption.grams;
    }
  }

  // Fallback to first serving option if available
  if (servingOptions[0]) {
    return qtyEff * servingOptions[0].grams;
  }

  return null;
}
