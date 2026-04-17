import { getDefaultCountServing } from '../src/lib/servings/default-count-grams';
import { hasUnwantedModifier } from '../src/lib/fatsecret/filter-candidates';

// We just copy the function hasModifier here to test hasUnwantedModifier since hasUnwantedModifier is not exported
// Actually, let's just write a script that imports it if possible, but hasUnwantedModifier is not exported.
// Let's just test if the file compiles.
import * as filterCandidates from '../src/lib/fatsecret/filter-candidates';

console.log("Lettuce:", getDefaultCountServing('lettuce', ''));
console.log("Chicken skin:", getDefaultCountServing('chicken skin', ''));

import rules from '../data/fatsecret/normalization-rules.json';
const garlicSaltRule = rules.synonym_rewrites.find((r: any) => r.from === 'garlic salt');
console.log("Garlic salt rule exists:", !!garlicSaltRule);

const omegaRule = rules.synonym_rewrites.find((r: any) => r.from === 'omega blended cooking oil');
console.log("Omega rule exists:", !!omegaRule);
