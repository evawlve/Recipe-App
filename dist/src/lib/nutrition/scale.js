"use strict";
/**
 * Scaling utilities for nutrition data
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.scalePer100g = scalePer100g;
/**
 * Scale per-100g nutrition data to a specific gram amount
 */
function scalePer100g(per100, grams) {
    const f = grams / 100;
    return {
        calories: Math.round(per100.calories * f),
        proteinG: +(per100.proteinG * f).toFixed(1),
        carbsG: +(per100.carbsG * f).toFixed(1),
        fatG: +(per100.fatG * f).toFixed(1),
        fiberG: +(per100.fiberG * f).toFixed(1),
        sugarG: +(per100.sugarG * f).toFixed(1),
    };
}
