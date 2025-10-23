"use strict";
/**
 * Unit normalization and conversion utilities
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeUnit = normalizeUnit;
exports.toGramsByUnit = toGramsByUnit;
/**
 * Normalize unit strings to standard forms
 */
function normalizeUnit(u) {
    const unit = u.toLowerCase().trim();
    // Map synonyms to standard forms
    const synonyms = {
        "teaspoon": "tsp",
        "teaspoons": "tsp",
        "tablespoon": "tbsp",
        "tablespoons": "tbsp",
        "tbs": "tbsp",
        "cups": "cup",
        "ounce": "oz",
        "ounces": "oz",
        "pound": "lb",
        "pounds": "lb",
        "gram": "g",
        "grams": "g",
        "milliliter": "ml",
        "millilitre": "ml",
        "milliliters": "ml",
        "millilitres": "ml"
    };
    return synonyms[unit] || unit;
}
/**
 * Convert quantity and unit to grams (for weight units only)
 * Returns null for volume units that need density
 */
function toGramsByUnit(qty, unit) {
    const normalized = normalizeUnit(unit);
    switch (normalized) {
        case "g":
            return qty;
        case "kg":
            return qty * 1000;
        case "mg":
            return qty / 1000;
        case "oz":
            return qty * 28.3495;
        case "lb":
            return qty * 453.592;
        case "ml":
            return qty; // water-like default
        default:
            return null; // Volume units (tsp/tbsp/cup/scoop) need density
    }
}
