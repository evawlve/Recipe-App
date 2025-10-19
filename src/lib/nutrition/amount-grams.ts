/**
 * Enhanced logic for resolving grams from user amounts
 * Handles weight units, volume units with density, and provider portions
 */

import { normalizeUnit, toGramsByUnit } from './units';
import { gramsForMeasure } from './serving';

export type ProviderPortion = { 
  unit: string; 
  gramWeight: number; 
}; // optional from API

export function resolveGramsForAmount(opts: {
  qty: number;
  unit: string;              // user-entered (e.g., "tbsp")
  categoryHint?: string;     // "flour","starch","oil","liquid", etc.
  providerPortions?: ProviderPortion[]; // optional; portions from USDA/OFF for THIS food
}): number | null {
  const qty = Math.max(0, opts.qty || 0);
  if (!qty) return null;

  // 1) normalize unit
  const u = normalizeUnit(opts.unit); // from src/lib/nutrition/units.ts

  // 2) weight units → direct convert
  const weightG = toGramsByUnit(qty, u);
  if (weightG != null) return weightG;

  // 3) volume units → prefer density table by category
  const densG = gramsForMeasure(u, opts.categoryHint || "");
  if (densG != null) return qty * densG;

  // 4) final fallback: provider portions, but ONLY if unit matches (e.g., "tbsp")
  if (opts.providerPortions && ["tsp","tbsp","cup","scoop"].includes(u)) {
    const match = opts.providerPortions.find(p => normalizeUnit(p.unit) === u && p.gramWeight > 0);
    if (match) return qty * match.gramWeight;
  }

  // 5) unknown → hide per-amount
  return null;
}
