"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.perServingFrom100 = perServingFrom100;
function perServingFrom100(p, grams) {
    const f = grams / 100;
    return {
        calories: p.kcal100 * f,
        protein: p.protein100 * f,
        carbs: p.carbs100 * f,
        fat: p.fat100 * f,
        fiber: (p.fiber100 ?? 0) * f,
        sugar: (p.sugar100 ?? 0) * f,
    };
}
