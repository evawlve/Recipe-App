"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.kcalBandForQuery = kcalBandForQuery;
exports.plausibilityScore = plausibilityScore;
function kcalBandForQuery(q) {
    const s = q.toLowerCase();
    if (/(olive|avocado|canola).*oil/.test(s) || /\boil\b/.test(s))
        return { min: 860, max: 900 };
    if (/corn starch|starch/.test(s))
        return { min: 280, max: 420 };
    if (/whey|protein powder|isolate|concentrate/.test(s))
        return { min: 330, max: 450 };
    if (/nonfat milk|fat free milk|skim milk/.test(s))
        return { min: 30, max: 45 };
    return { min: 10, max: 900 }; // default loose band
}
function plausibilityScore(kcal100, band) {
    if (!band)
        return 0.5;
    if (kcal100 < band.min || kcal100 > band.max)
        return 0.0;
    const mid = (band.min + band.max) / 2;
    const span = (band.max - band.min) / 2;
    return Math.max(0, 1 - Math.abs(kcal100 - mid) / span); // closer to mid => higher
}
