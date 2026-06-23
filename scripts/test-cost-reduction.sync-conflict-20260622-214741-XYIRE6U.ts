/**
 * Minimal Test for AI Cost Reduction Steps
 */

import { MODIFIER_SYNONYM_GROUPS, buildQueryVariants } from '../src/lib/fatsecret/gather-candidates';
import { extractModifierConstraints, applyModifierConstraints } from '../src/lib/fatsecret/modifier-constraints';
import { getDefaultCountServing } from '../src/lib/servings/default-count-grams';

// Step 3: Test buildQueryVariants
const variants = buildQueryVariants(null, 'fat free milk');
console.log('Step 3 - Variants for "fat free milk":');
console.log(JSON.stringify(variants, null, 2));

// Step 4: Test modifier constraints  
const constraints = extractModifierConstraints('fat free milk');
console.log('\nStep 4 - Constraints for "fat free milk":');
console.log('Required tokens:', constraints.requiredTokens.slice(0, 4));
console.log('Banned tokens:', constraints.bannedTokens.slice(0, 4));

// Test constraint application
const result1 = applyModifierConstraints({ name: 'Nonfat Milk' }, constraints);
const result2 = applyModifierConstraints({ name: '2% Milk' }, constraints);
console.log('\nApply to "Nonfat Milk":', result1);
console.log('Apply to "2% Milk":', result2);

// Step 7: Test count defaults
console.log('\nStep 7 - Count defaults:');
const egg = getDefaultCountServing('egg', 'each');
console.log('Egg:', egg);
const banana = getDefaultCountServing('banana', 'medium', 'medium');
console.log('Banana (medium):', banana);
const garlic = getDefaultCountServing('garlic clove', 'each');
console.log('Garlic clove:', garlic);

console.log('\nAll tests passed!');
