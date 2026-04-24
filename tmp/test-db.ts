import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalize-gate';

async function test() {
  const line = "1 tsp garlic salt";
  const parsed = parseIngredientLine(line);
  if (!parsed) return;
  const normalizedName = await normalizeIngredientName(parsed.ingredientItem);
  const c = await gatherCandidates(line, parsed, normalizedName, { skipCache: true, requireCount: false, isBareQuery: false });
  console.log('Candidates length:', c?.length);
  c?.slice(0,5).forEach(x => {
    console.log(x.name, x.brand);
  });
}

test().catch(console.error).finally(() => process.exit(0));
