const FLAG_TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function getFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw == null) return defaultValue;
  return FLAG_TRUE_VALUES.has(raw.toLowerCase());
}

export const FATSECRET_ENABLED = getFlag('ENABLE_FATSECRET', true);
export const FATSECRET_MIN_CONFIDENCE = Number.parseFloat(process.env.FATSECRET_MIN_CONFIDENCE ?? '0.7');
export const FATSECRET_TIMEOUT_MS = Number.parseInt(process.env.FATSECRET_TIMEOUT_MS ?? '2500', 10);
export const FATSECRET_CLIENT_ID = process.env.FATSECRET_CLIENT_ID ?? '';
export const FATSECRET_CLIENT_SECRET = process.env.FATSECRET_CLIENT_SECRET ?? '';

export type FatSecretRegion = 'US' | 'GLOBAL';
export const FATSECRET_REGION: FatSecretRegion = (process.env.FATSECRET_REGION as FatSecretRegion) || 'US';
