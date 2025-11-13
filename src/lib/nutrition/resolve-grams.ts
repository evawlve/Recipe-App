import { ParsedIngredient } from '../parse/ingredient-line';

/**
 * Parse quantity from a label prefix (e.g., "1" → 1, "¼" → 0.25, "1/2" → 0.5)
 */
function parseLabelQuantity(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return 1; // Empty means 1
  
  // Handle fractions
  if (trimmed === '¼') return 0.25;
  if (trimmed === '½') return 0.5;
  if (trimmed === '¾') return 0.75;
  
  // Handle numeric fractions "1/2", "3/4"
  const fractionMatch = trimmed.match(/^(\d+)\/(\d+)$/);
  if (fractionMatch) {
    return parseFloat(fractionMatch[1]) / parseFloat(fractionMatch[2]);
  }
  
  // Handle decimal numbers
  const decimalMatch = trimmed.match(/^(\d+\.?\d*)$/);
  if (decimalMatch) {
    return parseFloat(decimalMatch[1]);
  }
  
  return null;
}

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
    
    // Volume units that should prefer exact matches (from densityGml)
    const volumeUnits = ['cup', 'cups', 'tbsp', 'tablespoon', 'tablespoons', 'tsp', 'teaspoon', 'teaspoons', 'ml', 'milliliter', 'milliliters'];
    const isVolumeUnit = volumeUnits.includes(unitLower);
    
    // For volume units, prefer exact matches (e.g., "1 cup") over partial matches (e.g., "1 cup, diced")
    // This ensures densityGml-generated options are used instead of FoodUnit entries
    if (isVolumeUnit) {
      // First, try to find an exact match (e.g., "1 cup" for unit "cup")
      // Prefer labels that match the parsed quantity AND unit
      const unitBase = unitLower.replace(/s$/, ''); // "cups" -> "cup"
      const qtyEff = parsed.qty * parsed.multiplier;
      
      // Try to match exact quantity first (e.g., qty=1 → "1 cup")
      let exactMatch = servingOptions.find(option => {
        const labelLower = option.label.toLowerCase().trim();
        const endsWithUnit = labelLower.endsWith(unitBase) || labelLower.endsWith(unitLower);
        if (!endsWithUnit) return false;
        
        const beforeUnit = labelLower.slice(0, -unitBase.length).trim();
        if (!beforeUnit) return qtyEff === 1; // "cup" matches qty=1
        
        // Try to parse the quantity from the label
        const labelQty = parseLabelQuantity(beforeUnit);
        if (labelQty !== null) {
          // Match if quantities are close (within 0.1)
          return Math.abs(labelQty - qtyEff) < 0.1;
        }
        
        return false;
      });
      
      // If no exact quantity match, fall back to any valid quantity match
      if (!exactMatch) {
        exactMatch = servingOptions.find(option => {
          const labelLower = option.label.toLowerCase().trim();
          const endsWithUnit = labelLower.endsWith(unitBase) || labelLower.endsWith(unitLower);
          if (!endsWithUnit) return false;
          
          const beforeUnit = labelLower.slice(0, -unitBase.length).trim();
          // Allow: empty, numbers, fractions, "1", "1/2", "2", etc. (no extra words)
          return !beforeUnit || /^(\d+|¼|½|¾|\d+\/\d+|\d+\.\d+)\s*$/.test(beforeUnit);
        });
      }
      
      if (exactMatch) {
        return qtyEff * exactMatch.grams;
      }
      
      // Fallback to partial match (e.g., "1 cup, diced")
      const partialMatch = servingOptions.find(option => {
        const labelLower = option.label.toLowerCase();
        return labelLower.includes(unitLower);
      });
      
      if (partialMatch) {
        return qtyEff * partialMatch.grams;
      }
    } else {
      // For non-volume units, use original logic
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
