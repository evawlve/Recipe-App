/**
 * Quick validation that the fixes work for the reported issues
 */

import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { buildSearchExpressions } from '../src/lib/fatsecret/map-ingredient';

console.log('VALIDATING AUTOMAPPER FIXES\n');
console.log('='.repeat(80));

// Test Case 1: 90 lean ground beef
console.log('\n✓ Test 1: "16oz 90 lean ground beef"');
const test1 = buildSearchExpressions(parseIngredientLine('16oz 90 lean ground beef'), '16oz 90 lean ground beef');
console.log(`  Search expressions: ${JSON.stringify(test1.slice(0, 3))}`);
const has90 = test1.some(e => e.includes('90'));
console.log(`  ${has90 ? '✅ PASS' : '❌ FAIL'}: Leanness "90" is ${has90 ? 'preserved' : 'LOST'}`);

// Test Case 2: rice vinegar
console.log('\n✓ Test 2: "rice vinegar"');
const test2 = buildSearchExpressions(parseIngredientLine('2 tbsp rice vinegar'), 'rice vinegar');
console.log(`  Search expressions: ${JSON.stringify(test2)}`);
const hasVinegarOnly = test2.includes('vinegar');
console.log(`  ${!hasVinegarOnly ? '✅ PASS' : '❌ FAIL'}: ${!hasVinegarOnly ? 'No generic "vinegar" fallback' : 'Generic "vinegar" found (BAD)'}`);

// Test Case 3: 93% lean
console.log('\n✓ Test 3: "1 lb 93% lean ground beef"');
const test3 = buildSearchExpressions(parseIngredientLine('1 lb 93% lean ground beef'), '93% lean ground beef');
console.log(`  Search expressions: ${JSON.stringify(test3.slice(0, 3))}`);
const has93 = test3.some(e => e.includes('93'));
console.log(`  ${has93 ? '✅ PASS' : '❌ FAIL'}: Percentage "93%" is ${has93 ? 'preserved' : 'LOST'}`);

// Bonus: Verify non-compound ingredients still work
console.log('\n✓ Bonus Test: "all-purpose flour" (should still simplify to "flour")');
const testBonus = buildSearchExpressions(parseIngredientLine('2 cups all-purpose flour'), 'all-purpose flour');
console.log(`  Search expressions: ${JSON.stringify(testBonus.slice(0, 5))}`);
const hasFlour = testBonus.includes('flour');
console.log(`  ${hasFlour ? '✅ PASS' : '⚠️  WARNING'}: ${hasFlour ? 'Generic "flour" fallback present (good)' : 'No "flour" fallback'}`);

console.log('\n' + '='.repeat(80));
console.log('VALIDATION COMPLETE');
console.log('='.repeat(80));
