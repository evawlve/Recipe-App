import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalize-gate';

// The actual function is hydrateAndSelectServing
import { hydrateAndSelectServing } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function test() {
  const line = '8 lettuce';
  const parsed = parseIngredientLine(line)!;
  const normalized = await normalizeIngredientName(parsed.name || line);
  const candidates = await gatherCandidates(line, parsed, normalized, { skipCache: true });
  console.log("Candidates:", candidates.length);
  // @ts-ignore
  const hydrated = await hydrateAndSelectServing(line, parsed, 1, candidates[0]);
  console.dir(hydrated);
}

test().catch(console.error).finally(()=>process.exit(0));
