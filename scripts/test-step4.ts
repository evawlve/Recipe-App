/**
 * Test Step 4 - Modifier Constraints
 * Verifies constraint extraction and application
 */

import {
    extractModifierConstraints,
    applyModifierConstraints,
    hasModifierConstraints
} from '../src/lib/fatsecret/modifier-constraints';

console.log('Testing Step 4 - Modifier Constraints\n');

let allPassed = true;

// Test 1: Fat-free constraints
console.log('Test 1: Fat-free constraints');
const fatFreeConstraints = extractModifierConstraints('fat free milk');
console.log(`  Has constraints: ${hasModifierConstraints('fat free milk')}`);
console.log(`  Required tokens: ${fatFreeConstraints.requiredTokens.slice(0, 3).join(', ')}...`);
console.log(`  Banned tokens: ${fatFreeConstraints.bannedTokens.slice(0, 3).join(', ')}...`);

// Good candidate - should pass
const goodResult = applyModifierConstraints({ name: 'Nonfat Milk' }, fatFreeConstraints);
const goodPassed = goodResult.penalty === 0 && !goodResult.rejected;
console.log(`  "Nonfat Milk": penalty=${goodResult.penalty}, rejected=${goodResult.rejected} ${goodPassed ? 'PASS' : 'FAIL'}`);
if (!goodPassed) allPassed = false;

// Bad candidate - should be rejected (contains banned token "2%")
const badResult = applyModifierConstraints({ name: '2% Milk' }, fatFreeConstraints);
const badPassed = badResult.rejected === true;
console.log(`  "2% Milk": penalty=${badResult.penalty}, rejected=${badResult.rejected} ${badPassed ? 'PASS' : 'FAIL'}`);
if (!badPassed) allPassed = false;

// Test 2: Unsweetened constraints
console.log('\nTest 2: Unsweetened constraints');
const unsweetenedConstraints = extractModifierConstraints('unsweetened almond milk');

const unsweetGood = applyModifierConstraints({ name: 'Unsweetened Almond Milk' }, unsweetenedConstraints);
const unsweetGoodPassed = unsweetGood.penalty === 0 && !unsweetGood.rejected;
console.log(`  "Unsweetened Almond Milk": penalty=${unsweetGood.penalty}, rejected=${unsweetGood.rejected} ${unsweetGoodPassed ? 'PASS' : 'FAIL'}`);
if (!unsweetGoodPassed) allPassed = false;

const unsweetBad = applyModifierConstraints({ name: 'Vanilla Almond Milk Sweetened' }, unsweetenedConstraints);
const unsweetBadPassed = unsweetBad.rejected === true;
console.log(`  "Vanilla Almond Milk Sweetened": rejected=${unsweetBad.rejected} ${unsweetBadPassed ? 'PASS' : 'FAIL'}`);
if (!unsweetBadPassed) allPassed = false;

// Test 3: No constraints for regular ingredient
console.log('\nTest 3: Regular ingredient (no modifier constraints)');
const noConstraints = hasModifierConstraints('chicken breast');
const noConstPassed = noConstraints === false;
console.log(`  "chicken breast" has constraints: ${noConstraints} ${noConstPassed ? 'PASS' : 'FAIL'}`);
if (!noConstPassed) allPassed = false;

// Test 4: Form modifier (powder)
console.log('\nTest 4: Form modifier (powder)');
const powderConstraints = extractModifierConstraints('garlic powder');
const hasPowderConstraint = powderConstraints.requiredTokens.includes('powder');
console.log(`  "garlic powder" requires "powder": ${hasPowderConstraint} ${hasPowderConstraint ? 'PASS' : 'FAIL'}`);
if (!hasPowderConstraint) allPassed = false;

console.log(`\n${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
process.exit(allPassed ? 0 : 1);
