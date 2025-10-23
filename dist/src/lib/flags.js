"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HEALTH_SCORE_V2 = exports.USDA_BULK_IMPORT_ENABLED = exports.FOOD_MAPPING_V2 = void 0;
exports.isEnabled = isEnabled;
exports.getEnvFlag = getEnvFlag;
exports.FOOD_MAPPING_V2 = process.env.FOOD_MAPPING_V2 === "1" || process.env.FOOD_MAPPING_V2 === "true";
exports.USDA_BULK_IMPORT_ENABLED = !!process.env.USDA_BULK_IMPORT_ENABLED;
exports.HEALTH_SCORE_V2 = !!process.env.HEALTH_SCORE_V2;
function isEnabled(flag) {
    return flag === true;
}
function getEnvFlag(name, defaultValue = false) {
    const value = process.env[name];
    if (!value)
        return defaultValue;
    return value === "1" || value === "true";
}
