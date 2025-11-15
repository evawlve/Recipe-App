const FLAG_TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function getFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw == null) return defaultValue;
  return FLAG_TRUE_VALUES.has(raw.toLowerCase());
}

export const FATSECRET_ENABLED = getFlag('ENABLE_FATSECRET', true);
export const FATSECRET_MIN_CONFIDENCE = Number.parseFloat(process.env.FATSECRET_MIN_CONFIDENCE ?? '0.6');
export const FATSECRET_TIMEOUT_MS = Number.parseInt(process.env.FATSECRET_TIMEOUT_MS ?? '2500', 10);
export const FATSECRET_CLIENT_ID = process.env.FATSECRET_CLIENT_ID ?? '';
export const FATSECRET_CLIENT_SECRET = process.env.FATSECRET_CLIENT_SECRET ?? '';
export const FATSECRET_SCOPE = process.env.FATSECRET_SCOPE ?? 'premier';
export const FATSECRET_BARCODE_REGION = (process.env.FATSECRET_BARCODE_REGION ?? 'US').trim().toUpperCase();
export const FATSECRET_STRICT_MODE = getFlag('FATSECRET_STRICT_MODE', true); // Default: strict (only use if confidence >= minConfidence)

export type FatSecretRegion = 'US' | 'GLOBAL';
const rawRegion = process.env.FATSECRET_REGION?.toUpperCase();
export const FATSECRET_REGION: FatSecretRegion = rawRegion === 'GLOBAL' ? 'GLOBAL' : 'US';
