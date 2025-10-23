"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeImpactPreview = computeImpactPreview;
const score_v2_1 = require("./score-v2");
const perServing_1 = require("./perServing");
function computeImpactPreview({ currentTotals, foodPer100, servingGrams, goal }) {
    const add = (0, perServing_1.perServingFrom100)(foodPer100, servingGrams);
    const next = {
        calories: (currentTotals.calories || 0) + add.calories,
        protein: (currentTotals.protein || 0) + add.protein,
        carbs: (currentTotals.carbs || 0) + add.carbs,
        fat: (currentTotals.fat || 0) + add.fat,
        fiber: (currentTotals.fiber ?? 0) + add.fiber,
        sugar: (currentTotals.sugar ?? 0) + add.sugar,
    };
    const prevScore = (0, score_v2_1.scoreV2)(currentTotals, goal).value;
    const nextScore = (0, score_v2_1.scoreV2)(next, goal).value;
    return { perServing: add, deltas: add, nextTotals: next, prevScore, nextScore, deltaScore: nextScore - prevScore };
}
