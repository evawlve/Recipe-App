/**
 * Client-facing provenance whitelist.
 *
 * Attribution is a legal obligation, not a display detail: FatSecret data must carry their
 * licensed Web Badge and nothing else may, Open Food Facts requires ODbL credit, USDA gets a
 * courtesy credit. Every string this backend puts in a `source` field is therefore a claim
 * about who supplied the data, and the mobile client renders a licensed mark directly off it.
 *
 * The legacy `Food` table predates all of that and stores whatever its importers wrote — the
 * live box holds `template` and `verified`, and nothing constrains it. Two routes passed that
 * column straight to the client with no whitelist (`/api/foods/search` and `/api/foods/[id]`,
 * both in their `FATSECRET_CACHE_MODE === 'legacy'` path). That mode is not what the box runs
 * today, but it is the **default** (`mapping/config.ts`), so any fresh deployment that does not
 * set the variable serves the unguarded path.
 *
 * An unrecognised value returns `null` — "we make no provider claim" — rather than being
 * floored to a named provider. `null` is deliberate: flooring to `ai_estimated` would assert
 * AI origin for a row that may well be a real imported food, which is the same class of lie in
 * the opposite direction. Every consumer already treats a missing source as "render nothing".
 */

/** The only values a client may receive. Mirrors the mobile `food_log_items` CHECK. */
export const CLIENT_SOURCES = ['fatsecret', 'fdc', 'openfoodfacts', 'ai_estimated'] as const;
export type ClientSource = (typeof CLIENT_SOURCES)[number];

/**
 * Spellings the corpus lanes legitimately emit for the same provider.
 *
 * **Null-prototype on purpose.** As a normal object literal, `ALIASES[raw]` resolves up
 * `Object.prototype`, and `?? null` does not catch a truthy inherited value:
 * `toClientSource('constructor')` returned the `Object` FUNCTION and
 * `toClientSource('__proto__')` returned `Object.prototype`. Both escaped `CLIENT_SOURCES`
 * — one vanishes from the JSON payload, the other serialises as `"source": {}`, which is a
 * type violation for a client that does `source.toLowerCase()`. `.toLowerCase()` masked how
 * broad this was (`toString` becomes `tostring` and misses), leaving exactly the two keys
 * that are already lowercase. `Object.create(null)` removes the class outright.
 */
const ALIASES: Record<string, ClientSource> = Object.assign(Object.create(null), {
  fatsecret: 'fatsecret',
  fdc: 'fdc',
  usda: 'fdc',
  openfoodfacts: 'openfoodfacts',
  off: 'openfoodfacts',
  ai_estimated: 'ai_estimated',
  ai_generated: 'ai_estimated',
});

/**
 * The legacy wire spellings `/api/foods/search`'s corpus lane has always emitted.
 *
 * `runLocalSearch` sends `off`/`usda` rather than the canonical `openfoodfacts`/`fdc`, and
 * every mobile search call site passes `local=true`, so this — not the legacy `Food` branch —
 * is the path the app actually reads. It built its `source` inline as
 * `c.source === 'openfoodfacts' ? 'off' : c.source === 'fdc' ? 'usda' : c.source`, whose
 * final arm is a RAW PASSTHROUGH of an unconstrained corpus column.
 *
 * Nothing has gone wrong yet only because the mobile client re-normalises everything it
 * receives (`toDbSource` / `SourceAttribution` both accept either spelling and default to
 * "no claim"). That is the client defending itself from the server, not the server keeping
 * its contract. This keeps the historical spellings — changing them is a wire change for
 * every consumer — while closing the passthrough.
 */
export type WireSource = 'fatsecret' | 'off' | 'usda' | 'ai_estimated';

const CLIENT_TO_WIRE: Record<ClientSource, WireSource> = {
  fatsecret: 'fatsecret',
  openfoodfacts: 'off',
  fdc: 'usda',
  ai_estimated: 'ai_estimated',
};

/**
 * Normalise a stored value into the legacy wire spelling, or `null` for no provider claim.
 * Same whitelist as {@link toClientSource} — only the output spelling differs.
 */
export function toWireSource(raw: unknown): WireSource | null {
  const client = toClientSource(raw);
  return client === null ? null : CLIENT_TO_WIRE[client];
}

/**
 * Normalise an arbitrary stored value into a client-safe provenance claim.
 *
 * Returns `null` for anything unrecognised, including `template` / `verified` / `history` /
 * `cache` / `fatsecret-cache` and any non-string. Note `fatsecret-cache` maps to `null`, NOT
 * to `fatsecret`: that label came from a branch reading `AiGeneratedFood`, whose rows are LLM
 * estimates with zero FatSecret content.
 */
export function toClientSource(raw: unknown): ClientSource | null {
  if (typeof raw !== 'string') return null;
  return ALIASES[raw.toLowerCase().trim()] ?? null;
}
