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
export const FATSECRET_CACHE_MAX_AGE_MINUTES = Number.parseInt(
  process.env.FATSECRET_CACHE_MAX_AGE_MINUTES ?? '720',
  10,
);
export const FATSECRET_CACHE_SYNC_BATCH_SIZE = Number.parseInt(
  process.env.FATSECRET_CACHE_SYNC_BATCH_SIZE ?? '100',
  10,
);
export const FATSECRET_CACHE_DENSITY_AI_ENDPOINT =
  process.env.FATSECRET_CACHE_DENSITY_AI_ENDPOINT ?? '';
export const FATSECRET_CACHE_AI_MODEL = process.env.FATSECRET_CACHE_AI_MODEL ?? 'google/gemma-2-9b-it:free';
export const FATSECRET_CACHE_AI_CONFIDENCE_MIN = Number.parseFloat(
  process.env.FATSECRET_CACHE_AI_CONFIDENCE_MIN ?? '0.6',
);
// Lower threshold for on-demand serving backfills (e.g., "1 packet" → estimate grams)
// User can see and override the gram amount, so we can be more lenient here
export const FATSECRET_CACHE_AI_BACKFILL_CONFIDENCE_MIN = Number.parseFloat(
  process.env.FATSECRET_CACHE_AI_BACKFILL_CONFIDENCE_MIN ?? '0.35',
);
export const FATSECRET_CACHE_AI_MIN_DENSITY = Number.parseFloat(
  process.env.FATSECRET_CACHE_AI_MIN_DENSITY ?? '0.05',
);
export const FATSECRET_CACHE_AI_MAX_DENSITY = Number.parseFloat(
  process.env.FATSECRET_CACHE_AI_MAX_DENSITY ?? '5',
);
export const FATSECRET_CACHE_AI_ENABLED = getFlag('FATSECRET_CACHE_AI_ENABLED', true);
export const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL ?? 'https://api.openai.com/v1';

// OpenRouter configuration for cheap-first LLM fallback (Jan 2026)
export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? '';
export const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
export const CHEAP_AI_MODEL_PRIMARY = process.env.CHEAP_AI_MODEL_PRIMARY ?? 'qwen/qwen-turbo';
export const CHEAP_AI_MODEL_FALLBACK = process.env.CHEAP_AI_MODEL_FALLBACK ?? 'mistralai/mistral-nemo';
export const STRUCTURED_LLM_TIMEOUT_MS = Number.parseInt(process.env.STRUCTURED_LLM_TIMEOUT_MS ?? '15000', 10);
export const STRUCTURED_LLM_MAX_RETRIES = Number.parseInt(process.env.STRUCTURED_LLM_MAX_RETRIES ?? '3', 10);

// Local LLM configuration (Jan 2026 - RTX 3090 cost reduction)
export const OLLAMA_ENABLED = getFlag('OLLAMA_ENABLED', true);
export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1';
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';
export const OLLAMA_TIMEOUT_MS = Number.parseInt(process.env.OLLAMA_TIMEOUT_MS ?? '60000', 10);

// AI Nutrition Backfill configuration
export const AI_NUTRITION_BACKFILL_ENABLED = getFlag('AI_NUTRITION_BACKFILL_ENABLED', true);
export const NUTRITION_AI_MODEL = process.env.NUTRITION_AI_MODEL ?? 'google/gemini-2.0-flash-lite';
export const AI_NUTRITION_MAX_PER_BATCH = Number.parseInt(process.env.AI_NUTRITION_MAX_PER_BATCH ?? '20', 10);

export type FatSecretRegion = 'US' | 'GLOBAL';
const rawRegion = process.env.FATSECRET_REGION?.toUpperCase();
export const FATSECRET_REGION: FatSecretRegion = rawRegion === 'GLOBAL' ? 'GLOBAL' : 'US';

export type FatSecretCacheMode = 'legacy' | 'shadow' | 'dual' | 'primary';
const CACHE_MODES: FatSecretCacheMode[] = ['legacy', 'shadow', 'dual', 'primary'];
const rawCacheMode = (process.env.FATSECRET_CACHE_MODE ?? 'legacy').toLowerCase();
export const FATSECRET_CACHE_MODE: FatSecretCacheMode = CACHE_MODES.includes(
  rawCacheMode as FatSecretCacheMode,
)
  ? (rawCacheMode as FatSecretCacheMode)
  : 'legacy';

export const FATSECRET_CACHE_MODE_HELPERS = {
  isLegacy: FATSECRET_CACHE_MODE === 'legacy',
  isShadow: FATSECRET_CACHE_MODE === 'shadow',
  isDual: FATSECRET_CACHE_MODE === 'dual',
  isPrimary: FATSECRET_CACHE_MODE === 'primary',
  shouldServeCache: FATSECRET_CACHE_MODE === 'dual' || FATSECRET_CACHE_MODE === 'primary',
};

// Blocked IDs (Bad Data)
export const BAD_FOOD_IDS = new Set([
  '35976', // STRAWBERRY (TONY'S) - 113g carbs
]);
