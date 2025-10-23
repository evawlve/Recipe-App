"use strict";
/**
 * Normalize unit tokens to standard categories
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeUnitToken = normalizeUnitToken;
function normalizeUnitToken(tok) {
    const token = tok.toLowerCase().trim();
    // Mass units
    const massUnits = {
        'g': 'g', 'gram': 'g', 'grams': 'g',
        'oz': 'oz', 'ounce': 'oz', 'ounces': 'oz',
        'lb': 'lb', 'pound': 'lb', 'pounds': 'lb'
    };
    if (massUnits[token]) {
        return { kind: 'mass', unit: massUnits[token] };
    }
    // Volume units
    const volumeUnits = {
        'tsp': 'tsp', 'teaspoon': 'tsp', 'teaspoons': 'tsp',
        'tbsp': 'tbsp', 'tablespoon': 'tbsp', 'tablespoons': 'tbsp',
        'cup': 'cup', 'cups': 'cup',
        'ml': 'ml', 'milliliter': 'ml', 'milliliters': 'ml',
        'floz': 'floz', 'fl oz': 'floz', 'fluid ounce': 'floz', 'fluid ounces': 'floz'
    };
    if (volumeUnits[token]) {
        return { kind: 'volume', unit: volumeUnits[token] };
    }
    // Count units (food-specific)
    const countUnits = {
        'piece': 'piece', 'pieces': 'piece',
        'bar': 'bar', 'bars': 'bar',
        'scoop': 'scoop', 'scoops': 'scoop',
        'slice': 'slice', 'slices': 'slice',
        'egg': 'egg', 'eggs': 'egg'
    };
    if (countUnits[token]) {
        return { kind: 'count', unit: countUnits[token] };
    }
    // Multipliers
    const multipliers = {
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
