"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isVolume = exports.isMass = void 0;
exports.convertMass = convertMass;
exports.convertVolume = convertVolume;
exports.gramsFromVolume = gramsFromVolume;
exports.volumeFromGrams = volumeFromGrams;
const MASS_G = {
    g: 1, oz: 28.349523125, lb: 453.59237,
    ml: NaN, tsp: NaN, tbsp: NaN, cup: NaN, floz: NaN,
};
const VOL_ML = {
    ml: 1, tsp: 4.92892159375, tbsp: 14.78676478125, cup: 240, floz: 29.5735295625,
    g: NaN, oz: NaN, lb: NaN,
};
const isMass = (u) => !Number.isNaN(MASS_G[u]);
exports.isMass = isMass;
const isVolume = (u) => !Number.isNaN(VOL_ML[u]);
exports.isVolume = isVolume;
function convertMass(value, from, to) {
    if (!(0, exports.isMass)(from) || !(0, exports.isMass)(to))
        throw new Error('mass units required');
    return value * MASS_G[from] / MASS_G[to];
}
function convertVolume(value, from, to) {
    if (!(0, exports.isVolume)(from) || !(0, exports.isVolume)(to))
        throw new Error('volume units required');
    return value * VOL_ML[from] / VOL_ML[to];
}
// density = grams per ml
function gramsFromVolume(vol, unit, densityGml) {
    if (!(0, exports.isVolume)(unit))
        throw new Error('volume unit required');
    const ml = convertVolume(vol, unit, 'ml');
    return ml * densityGml; // grams
}
function volumeFromGrams(grams, unit, densityGml) {
    if (!(0, exports.isVolume)(unit))
        throw new Error('volume unit required');
    const ml = grams / densityGml;
    return convertVolume(ml, 'ml', unit);
}
