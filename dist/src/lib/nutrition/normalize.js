"use strict";
/**
 * Robust nutrition normalizer for USDA/brand foods
 * Converts per-serving data to per-100g with proper density calculations
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEBUG = void 0;
exports.kjToKcal = kjToKcal;
exports.servingToGrams = servingToGrams;
exports.sanitizePer100g = sanitizePer100g;
exports.toPer100g = toPer100g;
exports.extractCategoryHint = extractCategoryHint;
exports.validatePer100g = validatePer100g;
// Debug flag for detailed logging
exports.DEBUG = process.env.NUTRITION_DEBUG === "1";
// Helper function for debug logging
function debugLog(message, data) {
    if (exports.DEBUG) {
        console.log(`🔍 [NORMALIZE] ${message}`, data ? JSON.stringify(data, null, 2) : '');
    }
}
function kjToKcal(kj) {
    return Math.round(kj / 4.184);
}
const DENSITY = {
    tsp: { oil: 4.5, water: 4.9, starch: 2.6 },
    tbsp: { oil: 13.6, water: 14.7, starch: 7.8 },
    cup: { oil: 216, water: 240, flour: 120, sugar: 200, rice: 185, oats: 90, starch: 125 },
};
// choose grams from serving info
function servingToGrams(raw) {
    debugLog(`Converting serving to grams`, {
        name: raw.name,
        brand: raw.brand,
        servingSize: raw.servingSize,
        servingSizeUnit: raw.servingSizeUnit,
        gramWeight: raw.gramWeight,
        categoryHint: raw.categoryHint
    });
    if (raw.gramWeight && raw.gramWeight > 0) {
        debugLog(`Using provided gramWeight: ${raw.gramWeight}g`);
        return raw.gramWeight;
    }
    const unit = (raw.servingSizeUnit || "").toLowerCase().trim();
    const n = raw.servingSize ?? null;
    if (!n || n <= 0) {
        debugLog(`SKIP: Invalid serving size (${n}) or unit (${unit})`);
        return null;
    }
    if (unit === "g" || unit === "gram" || unit === "grams") {
        debugLog(`Already in grams: ${n}g`);
        return n;
    }
    if (unit === "ml") {
        debugLog(`ML unit, treating as grams: ${n}g`);
        return n; // water-like default
    }
    // household measures via density table
    const cat = (raw.categoryHint || "").toLowerCase();
    debugLog(`Category hint: "${cat}"`);
    function pick(table) {
        if (!table)
            return null;
        if (cat.includes("oil") || cat.includes("olive oil"))
            return table.oil ?? null;
        if (cat.includes("water") || cat.includes("milk") || cat.includes("liquid"))
            return table.water ?? null;
        if (cat.includes("flour"))
            return table.flour ?? null;
        if (cat.includes("sugar"))
            return table.sugar ?? null;
        if (cat.includes("rice"))
            return table.rice ?? null;
        if (cat.includes("oat"))
            return table.oats ?? null;
        if (cat.includes("starch"))
            return table.starch ?? null;
        return null;
    }
    if (unit === "tsp") {
        const g = pick(DENSITY.tsp);
        const result = g ? n * g : null;
        debugLog(`TSP conversion: ${n} tsp × ${g} g/tsp = ${result}g`);
        return result;
    }
    if (unit === "tbsp") {
        const g = pick(DENSITY.tbsp);
        const result = g ? n * g : null;
        debugLog(`TBSP conversion: ${n} tbsp × ${g} g/tbsp = ${result}g`);
        return result;
    }
    if (unit === "cup") {
        const g = pick(DENSITY.cup);
        const result = g ? n * g : null;
        debugLog(`CUP conversion: ${n} cup × ${g} g/cup = ${result}g`);
        return result;
    }
    // unknown unit => no guess
    debugLog(`SKIP: Unknown unit "${unit}" - no density conversion available`);
    return null;
}
function sanitizePer100g(n, raw) {
    debugLog(`BEFORE sanitization`, n);
    const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
    let { calories, proteinG, carbsG, fatG, fiberG, sugarG } = n;
    proteinG = clamp(proteinG || 0, 0, 100);
    carbsG = clamp(carbsG || 0, 0, 100);
    fatG = clamp(fatG || 0, 0, 100);
    fiberG = clamp(fiberG || 0, 0, 100);
    sugarG = clamp(sugarG || 0, 0, 100);
    if (fiberG > carbsG) {
        debugLog(`Fiber (${fiberG}g) > Carbs (${carbsG}g), adjusting fiber to ${carbsG}g`);
        fiberG = carbsG;
    }
    calories = clamp(calories || 0, 0, 900);
    const kcalFromMacros = 4 * proteinG + 4 * carbsG + 9 * fatG;
    const delta = Math.abs(kcalFromMacros - calories) / Math.max(1, calories);
    let sanitized = false;
    debugLog(`Energy reconciliation: calories=${calories}, macros=${kcalFromMacros}, delta=${(delta * 100).toFixed(1)}%`);
    if (delta > 0.15) {
        // adjust carbs to reconcile energy (keep P/F stable)
        const targetCarbs = clamp((calories - (4 * proteinG + 9 * fatG)) / 4, 0, 100);
        debugLog(`Energy mismatch >15%, adjusting carbs from ${carbsG}g to ${targetCarbs}g`);
        carbsG = targetCarbs;
        if (fiberG > carbsG) {
            debugLog(`Fiber (${fiberG}g) > adjusted carbs (${carbsG}g), adjusting fiber to ${carbsG}g`);
            fiberG = carbsG;
        }
        sanitized = true;
    }
    const result = { calories, proteinG, carbsG, fatG, fiberG, sugarG };
    debugLog(`AFTER sanitization (sanitized: ${sanitized})`, result);
    // 1) Drop all-zero rows (only if truly all zeros)
    const allZero = (x) => !x || x === 0;
    if (allZero(result.calories) && allZero(result.proteinG) && allZero(result.carbsG) && allZero(result.fatG) && allZero(result.fiberG) && allZero(result.sugarG)) {
        debugLog('SKIP: all-zero nutrition');
        return { n: result, sanitized: true }; // Mark as sanitized to indicate it should be filtered
    }
    // 2) Oil sanity (fat ≈ 100g → calories ~ 860–900 per 100g)
    if ((raw?.categoryHint?.toLowerCase().includes('oil')) || result.fatG >= 99) {
        const kcalFromFat = 9 * result.fatG;
        let kcal = Math.max(860, Math.min(900, Math.round(kcalFromFat)));
        // keep P/F, adjust carbs to reconcile energy if needed
        const targetCarbs = Math.max(0, Math.min(100, (kcal - (4 * result.proteinG + 9 * result.fatG)) / 4));
        result.calories = kcal;
        result.carbsG = targetCarbs;
        result.fiberG = Math.min(result.fiberG, targetCarbs);
        debugLog(`Oil sanity applied: ${kcal} kcal from ${result.fatG}g fat, carbs adjusted to ${targetCarbs}g`);
        sanitized = true;
    }
    return { n: result, sanitized };
}
// core: normalize per serving -> per 100g
function toPer100g(raw) {
    debugLog(`=== NORMALIZING FOOD ===`, {
        name: raw.name,
        brand: raw.brand,
        energyKcal: raw.energyKcal,
        energyKj: raw.energyKj,
        proteinG: raw.proteinG,
        carbsG: raw.carbsG,
        fatG: raw.fatG,
        fiberG: raw.fiberG,
        sugarG: raw.sugarG,
        servingSize: raw.servingSize,
        servingSizeUnit: raw.servingSizeUnit,
        gramWeight: raw.gramWeight,
        categoryHint: raw.categoryHint
    });
    // pick kcal
    let kcal = raw.energyKcal ?? null;
    if (kcal == null && raw.energyKj != null) {
        kcal = kjToKcal(raw.energyKj);
        debugLog(`Converted kJ to kcal: ${raw.energyKj} kJ → ${kcal} kcal`);
    }
    if (kcal == null && raw.proteinG == null && raw.carbsG == null && raw.fatG == null) {
        debugLog(`SKIP: No energy or macro data available`);
        return null;
    }
    const grams = servingToGrams(raw);
    debugLog(`Derived gram weight: ${grams}g`);
    // if we already have per 100g (grams == 100 or provider flagged), fast-path:
    if (grams && Math.abs(grams - 100) < 0.5) {
        debugLog(`Already per-100g (${grams}g), using direct values`);
        const out = {
            calories: kcal ?? (4 * (raw.proteinG || 0) + 4 * (raw.carbsG || 0) + 9 * (raw.fatG || 0)),
            proteinG: raw.proteinG || 0,
            carbsG: raw.carbsG || 0,
            fatG: raw.fatG || 0,
            fiberG: raw.fiberG || 0,
            sugarG: raw.sugarG || 0,
        };
        return sanitizePer100g(out, raw).n;
    }
    if (!grams || grams <= 0) {
        debugLog(`SKIP: No gram weight (${grams}g) - cannot normalize safely`);
        return null; // cannot normalize safely
    }
    const scale = 100 / grams;
    debugLog(`Scaling factor: 100g / ${grams}g = ${scale.toFixed(3)}`);
    const out = {
        calories: Math.round((kcal ?? (4 * (raw.proteinG || 0) + 4 * (raw.carbsG || 0) + 9 * (raw.fatG || 0))) * scale),
        proteinG: (raw.proteinG || 0) * scale,
        carbsG: (raw.carbsG || 0) * scale,
        fatG: (raw.fatG || 0) * scale,
        fiberG: (raw.fiberG || 0) * scale,
        sugarG: (raw.sugarG || 0) * scale,
    };
    debugLog(`Scaled values before sanitization`, out);
    const sanitized = sanitizePer100g(out, raw);
    // Filter out all-zero rows
    if (sanitized.sanitized && sanitized.n.calories === 0 && sanitized.n.proteinG === 0 && sanitized.n.carbsG === 0 && sanitized.n.fatG === 0) {
        debugLog('SKIP: all-zero nutrition after sanitization');
        return null;
    }
    return sanitized.n;
}
/**
 * Extract category hint from food name/description
 */
function extractCategoryHint(name, brand) {
    const text = `${name} ${brand || ''}`.toLowerCase();
    if (/oil|olive|avocado|canola|sunflower|sesame|vegetable oil|palm oil|coconut oil/i.test(text))
        return "oil";
    if (/milk|water|broth|stock|juice/i.test(text))
        return "liquid";
    if (/flour|almond flour|coconut flour/i.test(text))
        return "flour";
    if (/sugar|granulated sugar|brown sugar/i.test(text))
        return "sugar";
    if (/rice|white rice|brown rice/i.test(text))
        return "rice";
    if (/oat|rolled oats|steel cut oats/i.test(text))
        return "oats";
    if (/starch|corn starch|potato starch/i.test(text))
        return "starch";
    return null;
}
/**
 * Validate per-100g values for sanity
 */
function validatePer100g(per100g) {
    // Oil sanity check
    if (per100g.fatG > 90) {
        if (per100g.calories < 800 || per100g.calories > 900) {
            return { valid: false, reason: "Oil calories out of range" };
        }
    }
    // General sanity
    if (per100g.calories > 900) {
        return { valid: false, reason: "Calories too high (>900 per 100g)" };
    }
    if (per100g.proteinG + per100g.carbsG + per100g.fatG > 100) {
        return { valid: false, reason: "Macros sum > 100g" };
    }
    return { valid: true };
}
