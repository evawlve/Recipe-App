import { ParsedIngredient } from '../parse/ingredient-line';
import { resolveGramsFromParsed } from './resolve-grams';
import { gramsFromVolume } from '../units/unit-graph';
import { resolveDensityGml } from '../units/density';
import { logger } from '../logger';

export type AmountInput = {
  qty: number;
  unit?: 'g' | 'oz' | 'lb' | 'ml' | 'tsp' | 'tbsp' | 'cup' | 'floz';
};

export function resolveGramsAdapter(input: {
  parsed?: ParsedIngredient;
  amount?: AmountInput;
  densityGml?: number | null;
  servingOptions?: Array<{ label: string; grams: number }>;
}): number | null {
  const { parsed, amount, densityGml, servingOptions = [] } = input;

  // If parsed present and parsed.unit is mass/volume → call existing grams logic
  if (parsed && parsed.unit && (parsed.unit === 'g' || parsed.unit === 'oz' || parsed.unit === 'lb' || 
      parsed.unit === 'ml' || parsed.unit === 'tsp' || parsed.unit === 'tbsp' || parsed.unit === 'cup' || parsed.unit === 'floz')) {
    
    const qtyEff = parsed.qty * parsed.multiplier;
    const density = resolveDensityGml(densityGml, null);
    
    try {
      if (parsed.unit === 'g' || parsed.unit === 'oz' || parsed.unit === 'lb') {
        // Mass units - direct conversion
        const massGrams: Record<string, number> = {
          'g': 1,
          'oz': 28.349523125,
          'lb': 453.59237
        };
        return qtyEff * massGrams[parsed.unit];
      } else {
        // Volume units - use density
        return gramsFromVolume(qtyEff, parsed.unit as any, density);
      }
    } catch (error) {
      logger.info('mapping_v2', {
        feature: 'mapping_v2',
        step: 'grams_adapter_null',
        ingredient: parsed.name,
        error: 'conversion_failed'
      });
      return null;
    }
  }

  // If parsed present and count/unknown → call resolveGramsFromParsed
  if (parsed) {
    const result = resolveGramsFromParsed(parsed, servingOptions);
    
    if (result === null) {
      logger.info('mapping_v2', {
        feature: 'mapping_v2',
        step: 'grams_adapter_fallback',
        reason: 'no_count_match',
        ingredient: parsed.name
      });
    }
    
    return result;
  }

  // If no parsed but amount provided → convert via existing grams logic
  if (amount && amount.unit) {
    const density = resolveDensityGml(densityGml, null);
    
    try {
      if (amount.unit === 'g' || amount.unit === 'oz' || amount.unit === 'lb') {
        // Mass units - direct conversion
        const massGrams: Record<string, number> = {
          'g': 1,
          'oz': 28.349523125,
          'lb': 453.59237
        };
        return amount.qty * massGrams[amount.unit];
      } else {
        // Volume units - use density
        return gramsFromVolume(amount.qty, amount.unit, density);
      }
    } catch (error) {
      logger.info('mapping_v2', {
        feature: 'mapping_v2',
        step: 'grams_adapter_null',
        ingredient: 'amount_input',
        error: 'conversion_failed'
      });
      return null;
    }
  }

  // Otherwise return null
  logger.info('mapping_v2', {
    feature: 'mapping_v2',
    step: 'grams_adapter_null',
    ingredient: 'no_valid_input'
  });
  
  return null;
}
