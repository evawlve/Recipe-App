export function getEnvFlag(name: string, defaultValue = false): boolean {
  const value = process.env[name];
  if (!value) return defaultValue;
  return value === "1" || value === "true";
}

export function isEnabled(flag: boolean) {
  return flag === true;
}

// Legacy flags (using direct env access for backward compatibility)
export const FOOD_MAPPING_V2 = process.env.FOOD_MAPPING_V2 === "1" || process.env.FOOD_MAPPING_V2 === "true";
export const USDA_BULK_IMPORT_ENABLED = !!process.env.USDA_BULK_IMPORT_ENABLED;
export const HEALTH_SCORE_V2 = !!process.env.HEALTH_SCORE_V2;

/**
 * Feature flag: Enable Portion V2 resolution
 * Controls new portion resolution logic using PortionOverride tables
 * Default: false (use old logic)
 * When true: Use new 5-tier fallback system (implemented in Sprint 3)
 */
export const ENABLE_PORTION_V2 = getEnvFlag("ENABLE_PORTION_V2", false);

/**
 * Feature flag: Enable branded food search via FDC API
 * Controls FDC API branded food search
 * Default: false (don't search branded foods)
 * When true: Allow searching branded foods via FDC API
 */
export const ENABLE_BRANDED_SEARCH = getEnvFlag("ENABLE_BRANDED_SEARCH", false);

