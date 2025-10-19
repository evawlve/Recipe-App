export const FOOD_MAPPING_V2 = process.env.FOOD_MAPPING_V2 === "1" || process.env.FOOD_MAPPING_V2 === "true";
export const USDA_BULK_IMPORT_ENABLED = !!process.env.USDA_BULK_IMPORT_ENABLED;
export const HEALTH_SCORE_V2 = !!process.env.HEALTH_SCORE_V2;

export function isEnabled(flag: boolean) {
  return flag === true;
}

export function getEnvFlag(name: string, defaultValue = false): boolean {
  const value = process.env[name];
  if (!value) return defaultValue;
  return value === "1" || value === "true";
}

