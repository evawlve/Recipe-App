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
export const FATSECRET_CACHE_AI_MODEL = process.env.FATSECRET_CACHE_AI_MODEL ?? 'mistralai/mistral-nemo';
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

// FatSecret retrieval lane (Phase 1): fs candidates compete in rerank on cache
// miss; picked foods persist locally. Kill-switch default OFF.
export const FATSECRET_RETRIEVAL_ENABLED = getFlag('FATSECRET_RETRIEVAL_ENABLED', false);
export const FATSECRET_LANE_TIMEOUT_MS = Number.parseInt(process.env.FATSECRET_LANE_TIMEOUT_MS ?? '800', 10);
export const FATSECRET_LANE_MAX_RESULTS = Number.parseInt(process.env.FATSECRET_LANE_MAX_RESULTS ?? '8', 10);

/**
 * How many NON-WINNING FatSecret hits a single query may write to our own cache.
 *
 * The lane asks FatSecret for FATSECRET_LANE_MAX_RESULTS (8) candidates and used to
 * persist every one of them. Measured 2026-07-28: 23,814 `FatSecretFood` rows exist and
 * only 564 back a `FoodMapping` — 97.6% of what we store is speculative sediment for a
 * food no user ever chose. Retaining the food a user actually asked for is defensible;
 * retaining seven extra copies of a third party's database per query is a different
 * thing, and we are mid-attribution-audit with them.
 *
 * The WINNER is always persisted regardless of this cap — `FoodMapping.fsId` is a foreign
 * key to `FatSecretFood.fsId`, so dropping the winner's parent row silently loses the
 * mapping (that exact failure cost warm batch 01 31.4% of its saves). See
 * `ensureFatSecretParentPersisted`. This value caps only the speculative extras, so the
 * true per-query ceiling is this + 1.
 *
 * **Default 0 — we persist only foods that actually won a mapping.** This knob is new and
 * UNCOMMITTED; it has never shipped at any value. It was written at 2 while one objection
 * stood — that the runners-up might be needed later to back a user override — and Diego
 * closed that on 2026-07-28: the runners-up are for override, and the FatSecret API is being
 * wired in for search itself, so the override picker queries FatSecret rather than reading
 * our cache.
 *
 * Do NOT restate that as "the candidates already travel in the parse response". They do not.
 * `/api/nlp/parse` returns exactly ONE winner per line with no alternates field
 * (`app/api/nlp/parse/route.ts` item literal; documented in api-contract.md under "One winner
 * per line — there are no alternates"). `searchFatSecretLane` returning 8 candidates is an
 * INTERNAL rerank pool, not a wire payload — an easy conflation, and it was made here. The
 * override feature therefore needs a candidate source built either way, which is precisely
 * why speculatively storing rows against it buys nothing.
 *
 * `ensureFatSecretParentPersisted` refetches a single record on demand if an override picks
 * one we never stored. Raise this only if you have a measured reason.
 */
export const FATSECRET_PERSIST_RUNNERS_UP = Math.max(
  0,
  Number.parseInt(process.env.FATSECRET_PERSIST_RUNNERS_UP ?? '0', 10) || 0,
);
export const FATSECRET_REFRESH_DAYS = Number.parseInt(process.env.FATSECRET_REFRESH_DAYS ?? '30', 10);
export const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL ?? 'https://api.openai.com/v1';

// OpenRouter configuration for cheap-first LLM fallback (Jan 2026)
export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? '';
export const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
export const CHEAP_AI_MODEL_PRIMARY = process.env.CHEAP_AI_MODEL_PRIMARY ?? 'openai/gpt-4o-mini';
export const CHEAP_AI_MODEL_FALLBACK = process.env.CHEAP_AI_MODEL_FALLBACK ?? 'google/gemini-2.5-flash';
export const STRUCTURED_LLM_TIMEOUT_MS = Number.parseInt(process.env.STRUCTURED_LLM_TIMEOUT_MS ?? '15000', 10);
export const STRUCTURED_LLM_MAX_RETRIES = Number.parseInt(process.env.STRUCTURED_LLM_MAX_RETRIES ?? '3', 10);

// Local LLM configuration (Jan 2026 - RTX 3090 cost reduction)
export const OLLAMA_ENABLED = getFlag('OLLAMA_ENABLED', true);
export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1';
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';
export const OLLAMA_TIMEOUT_MS = Number.parseInt(process.env.OLLAMA_TIMEOUT_MS ?? '60000', 10);

// AI Nutrition Backfill configuration
export const AI_NUTRITION_BACKFILL_ENABLED = getFlag('AI_NUTRITION_BACKFILL_ENABLED', true);
export const NUTRITION_AI_MODEL = process.env.NUTRITION_AI_MODEL ?? 'mistralai/mistral-nemo';
/**
 * Budget SIZE a batch/warm run asks for (see `createAiNutritionBudget`). This is
 * no longer a process ceiling — the run owns one budget object and passes it to
 * every query, so the bound is per RUN and dies with the run.
 */
export const AI_NUTRITION_MAX_PER_BATCH = Number.parseInt(process.env.AI_NUTRITION_MAX_PER_BATCH ?? '20', 10);
/**
 * Budget size for ONE live /api/nlp/parse request. Much smaller than a batch
 * allowance: a 20-item meal must not be able to fire dozens of LLM calls. Set
 * to 0 to fail the live path closed. There is deliberately NO process-level
 * backstop constant — that is the latching mechanism this replaced.
 */
export const AI_NUTRITION_MAX_PER_REQUEST = Number.parseInt(process.env.AI_NUTRITION_MAX_PER_REQUEST ?? '3', 10);

/**
 * HYDRATION allowance — a SECOND, separate budget, spent only by
 * `buildOffResult()` when an OFF record's own per-100g panel fails the Atwater
 * gate and the only way to bill the line is an AI estimate.
 *
 * Why it is not the last-resort budget above. The two spends have opposite
 * failure modes:
 *
 *   - LAST RESORT (`AI_NUTRITION_MAX_*`) is spent when NOTHING matched. Refusing
 *     it degrades a line that had no answer anyway, so a tight bound is right.
 *   - HYDRATION is spent on a candidate that ALREADY WON retrieval. Refusing it
 *     makes `buildOffResult()` return null, which DELETES that candidate — the
 *     pipeline then bills a different record, and that different record is what
 *     gets written as a sticky FoodMapping row. Sharing one pool therefore made
 *     cache IDENTITY depend on how many last-resort calls the other items of the
 *     same /api/nlp/parse request happened to fire first (the route maps items
 *     with `Promise.all`, so the interleaving is not even stable run to run).
 *
 * Sized generously on purpose: hydration is bounded by candidate count, and
 * `requestAiNutrition()` checks its cache BEFORE the budget, so repeat names in
 * a run cost nothing. MEASURED 2026-08-01 (live DB): `AiGeneratedFood` holds
 * 149 rows TOTAL across both spends since 2026-07-16 — roughly 9 new distinct
 * names/day, so these ceilings are unreachable in normal operation and exist
 * only to bound a pathological run.
 *   ssh owner@192.168.1.133 'docker exec mealspire-db psql -U postgres -d mealspire \
 *     -c "SELECT count(*), min(\"createdAt\")::date FROM \"AiGeneratedFood\";"'
 *
 * Set to 0 to fail the hydration path closed (OFF records with an unusable
 * panel then drop, as they did before AI backfill existed).
 */
export const AI_NUTRITION_HYDRATION_MAX_PER_REQUEST =
    Number.parseInt(process.env.AI_NUTRITION_HYDRATION_MAX_PER_REQUEST ?? '20', 10);
/** Hydration allowance a batch/warm RUN asks for. See the per-request constant above. */
export const AI_NUTRITION_HYDRATION_MAX_PER_BATCH =
    Number.parseInt(process.env.AI_NUTRITION_HYDRATION_MAX_PER_BATCH ?? '200', 10);

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

// Search Configuration — Typesense is the sole engine (Postgres is the
// in-code fallback when it's unreachable)
export const TYPESENSE_HOST = process.env.TYPESENSE_HOST ?? 'http://localhost:8108';
export const TYPESENSE_API_KEY = process.env.TYPESENSE_API_KEY ?? 'xyzapikey';


