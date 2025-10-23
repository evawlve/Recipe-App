"use strict";
/**
 * Enhanced logic for resolving grams from user amounts
 * Handles weight units, volume units with density, and provider portions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveGramsForAmount = resolveGramsForAmount;
const units_1 = require("./units");
const serving_1 = require("./serving");
function resolveGramsForAmount(opts) {
    const qty = Math.max(0, opts.qty || 0);
    if (!qty)
        return null;
    // 1) normalize unit
    const u = (0, units_1.normalizeUnit)(opts.unit); // from src/lib/nutrition/units.ts
    // 2) weight units → direct convert
    const weightG = (0, units_1.toGramsByUnit)(qty, u);
    if (weightG != null)
        return weightG;
    // 3) volume units → prefer density table by category
    const densG = (0, serving_1.gramsForMeasure)(u, opts.categoryHint || "");
    if (densG != null)
        return qty * densG;
    // 4) final fallback: provider portions, but ONLY if unit matches (e.g., "tbsp")
    if (opts.providerPortions && ["tsp", "tbsp", "cup", "scoop"].includes(u)) {
        const match = opts.providerPortions.find(p => (0, units_1.normalizeUnit)(p.unit) === u && p.gramWeight > 0);
        if (match)
            return qty * match.gramWeight;
    }
    // 5) unknown → hide per-amount
    return null;
}
