/**
 * Jest gate: a test may never reach a live LLM provider.
 *
 * WHY THIS FILE EXISTS
 * Five mapper modules — `ai-parse`, `ai-normalize`, `ai-simplify`, `ai-rerank`,
 * `ai-search-refine` — do `import 'dotenv/config'` at module scope (re-derive:
 * `grep -rln "^import 'dotenv/config'" src/lib/` -> 5, measured 2026-08-02). So a
 * jest process that imports any part of the mapper chain loads the developer's real
 * `.env` and comes up holding working production credentials.
 *
 * MEASURED 2026-08-02 on clean master: ten runs of
 * `src/lib/mapping/__tests__/fs-cache-nutrition-validation.test.ts` made 129
 * successful `openrouter / openai/gpt-4o-mini` round trips, 810-3163 ms each. Two or
 * three of those landed inside a single `it()` against jest's 5000 ms default, so all
 * ten runs failed with a different set of tests timing out each time.
 *
 * CI IS NOT A CHECK ON THIS. CI has no key, so `getProviderChain()` returns [] there
 * and CI has always been green. The defect only fires on a developer machine with a
 * populated `.env`, which is also the only place the calls are billable.
 *
 * WHY `setupFiles` AND NOT `setupFilesAfterEnv`
 * Every provider credential is captured into a module-scope `const` at import time —
 * `OPENROUTER_API_KEY` / `OLLAMA_*` in `src/lib/mapping/config.ts`, `OPENAI_API_KEY`
 * in `getProviderChain()`'s own module and in each direct-fetch module. Once those
 * modules are imported the value is frozen, so the blanking has to happen before the
 * first import. `setupFiles` runs before the test framework and before the test file
 * is loaded; `setupFilesAfterEnv` runs after, i.e. too late.
 *
 * WHY THIS ASSIGNS '' AND MUST NEVER `delete`
 * dotenv (17.2.3) writes a key only when
 * `Object.prototype.hasOwnProperty.call(processEnv, key)` is false and `override` is
 * unset — see `node_modules/dotenv/lib/main.js`. Assigning '' creates the property,
 * so the later `import 'dotenv/config'` is a no-op for that key. `delete
 * process.env.X` would remove the property and hand dotenv permission to put the real
 * key straight back, which is the same gate that looks identical and does nothing.
 *
 * The invariant is asserted by `src/lib/ai/__tests__/no-live-llm-egress.test.ts`,
 * which loads `dotenv/config` itself and then requires the chain to still be empty.
 */

// ---------------------------------------------------------------------------
// 1. Credential-gated providers.
// `getProviderChain()` in src/lib/ai/structured-client.ts pushes an OpenRouter or
// OpenAI entry only when the corresponding key is truthy, so '' removes both from
// every chain. OPENAI_API_KEY additionally disarms the four modules that bypass
// callStructuredLlm() and fetch `${OPENAI_API_BASE_URL}/chat/completions` directly:
// aiRerankCandidates() in src/lib/mapping/ai-rerank.ts, the refine call in
// src/lib/mapping/ai-search-refine.ts, src/lib/mapping/ai-synonym-generator.ts, and
// src/lib/ai/simple-serving-estimator.ts — each returns early on a falsy key.
// ---------------------------------------------------------------------------
process.env.OPENROUTER_API_KEY = '';
process.env.OPENAI_API_KEY = '';

// ---------------------------------------------------------------------------
// 2. The provider that needs no credential.
// `OLLAMA_ENABLED = getFlag('OLLAMA_ENABLED', true)` in src/lib/mapping/config.ts
// DEFAULTS TO TRUE, and the Ollama branch of `getProviderChain()` supplies the
// literal string 'ollama' as its apiKey. Blanking the keys above therefore does not
// stop it: `purpose: 'parse'` and `forceProvider: 'ollama'` would still dial
// http://localhost:11434/v1 on any machine running Ollama, with a 60 s timeout.
// This machine happens to carry OLLAMA_ENABLED=false in `.env`, which is exactly why
// the flag has to be set here rather than relied upon.
// ---------------------------------------------------------------------------
process.env.OLLAMA_ENABLED = 'false';

// ---------------------------------------------------------------------------
// 3. Base URLs — defence in depth, not the primary gate.
// Sections 1 and 2 are enumerations of today's provider list; a provider added later
// without a key guard would walk straight past them. Every LLM request in this repo
// is built as `${<one of these>}/chat/completions`, so pointing them at a closed port
// converts that class of leak from a silent live call into an immediate
// ECONNREFUSED naming this gate. `??` in config.ts falls back only on null/undefined,
// so an explicitly assigned value survives. Port 1 is reserved and never listening:
// no DNS, no hang.
// ---------------------------------------------------------------------------
const BLACKHOLE = 'http://127.0.0.1:1/jest-no-llm-gate';
process.env.OPENROUTER_BASE_URL = BLACKHOLE;
process.env.OPENAI_API_BASE_URL = BLACKHOLE;
process.env.OLLAMA_BASE_URL = BLACKHOLE;

// Deliberately NOT provided: an escape hatch such as JEST_ALLOW_LIVE_LLM. No test in
// this repo asserts real provider behaviour (re-derive: `grep -rln
// "OPENROUTER_API_KEY\|OPENAI_API_KEY\|OLLAMA" --include="*.test.ts" src scripts` ->
// no matches, measured 2026-08-02). A test that genuinely needs LLM behaviour should
// stub `callStructuredLlm` — the single chokepoint — the way
// src/lib/mapping/__tests__/fs-cache-nutrition-validation.test.ts does.
