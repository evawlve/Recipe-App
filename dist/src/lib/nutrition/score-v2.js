"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scoreV2 = scoreV2;
const GOAL_TARGETS = {
    general: { p_pct: 25, c_pct: 45, f_pct: 30 },
    weight_loss: { p_pct: 35, c_pct: 35, f_pct: 30 },
    muscle_gain: { p_pct: 30, c_pct: 45, f_pct: 25 },
    maintenance: { p_pct: 25, c_pct: 50, f_pct: 25 },
};
function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function pct(part, total) { return total > 0 ? (part / total) * 100 : 0; }
function to100(x) { return Math.round(100 * clamp01(x)); }
/**
 * scoreV2:
 * - Protein density: grams per 100 kcal, 0..1 with ~12 g/100kcal saturation
 * - Macro balance: distance to goal macro % mix (calorie-weighted)
 * - Fiber bonus: per 1000 kcal (~20 g/1000 kcal saturates)
 * - Sugar penalty: grams per 100 kcal; >6 g/100 kcal penalized
 */
function scoreV2(inp, goal) {
    const calories = Math.max(0, inp.calories || 0);
    const protein = Math.max(0, inp.protein || 0);
    const carbs = Math.max(0, inp.carbs || 0);
    const fat = Math.max(0, inp.fat || 0);
    const fiber = Math.max(0, inp.fiber ?? 0);
    const sugar = Math.max(0, inp.sugar ?? 0);
    // 1) Protein density per 100 kcal
    const protPer100 = calories > 0 ? (protein / (calories / 100)) : 0;
    const proteinScore = clamp01(protPer100 / 12); // 12g/100 kcal ~ ideal
    // 2) Macro balance vs goal
    const pCal = protein * 4, cCal = carbs * 4, fCal = fat * 9;
    const macroCal = Math.max(1, pCal + cCal + fCal);
    const mix = { p_pct: pct(pCal, macroCal), c_pct: pct(cCal, macroCal), f_pct: pct(fCal, macroCal) };
    const tgt = GOAL_TARGETS[goal];
    const l1dist = Math.abs(mix.p_pct - tgt.p_pct) + Math.abs(mix.c_pct - tgt.c_pct) + Math.abs(mix.f_pct - tgt.f_pct);
    const balanceScore = clamp01(1 - l1dist / 120); // 0 at huge mismatch; ~1 near target
    // 3) Fiber bonus (per 1000 kcal)
    const fiberPer1k = calories > 0 ? (fiber / (calories / 1000)) : 0;
    const fiberScore = clamp01(fiberPer1k / 20); // ~20 g / 1000 kcal = full credit
    // 4) Sugar penalty (per 100 kcal)
    const sugarPer100 = calories > 0 ? (sugar / (calories / 100)) : 0;
    const sugarPenalty = clamp01(Math.max(0, (sugarPer100 - 6) / 10)); // >6 g/100kcal hurts
    // Weighted blend
    const w = { protein: 0.35, balance: 0.35, fiber: 0.15, sugar: 0.15 };
    const raw = (w.protein * proteinScore) + (w.balance * balanceScore) + (w.fiber * fiberScore) + (w.sugar * (1 - sugarPenalty));
    const value = to100(raw);
    const label = value >= 80 ? 'great' : value >= 60 ? 'good' : value >= 40 ? 'ok' : 'poor';
    return {
        value,
        label,
        breakdown: {
            proteinDensity: to100(proteinScore),
            macroBalance: to100(balanceScore),
            fiber: to100(fiberScore),
            sugar: to100(1 - sugarPenalty),
        },
    };
}
