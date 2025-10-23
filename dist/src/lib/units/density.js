"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.categoryDensity = categoryDensity;
exports.resolveDensityGml = resolveDensityGml;
const CATEGORY_DENSITY_GML = {
    oil: 0.91, flour: 0.53, starch: 0.80, whey: 0.50, sugar: 0.85,
    rice: 0.85, oats: 0.36, liquid: 1.00, powder: 0.55, unknown: 1.00,
};
function categoryDensity(categoryId) {
    // plug in your categoryId→Category map; for now assume id === key
    return categoryId ? CATEGORY_DENSITY_GML[categoryId] : undefined;
}
function resolveDensityGml(foodDensity, categoryId) {
    return foodDensity ?? categoryDensity(categoryId) ?? 1.0;
}
