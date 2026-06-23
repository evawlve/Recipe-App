/**
 * Ultra-simple test - just log critical info
 */

import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { buildSearchExpressions } from '../src/lib/fatsecret/map-ingredient';

// Test 1: "90 lean ground beef"
console.log('Test 1: 90 lean ground beef');
const parsed1 = parseIngredientLine('16oz 90 lean ground beef');
const expressions1 = buildSearchExpressions(parsed1, '90 lean ground beef');
console.log('Expressions:', JSON.stringify(expressions1.slice(0, 5)));
const has90 = expressions1.some(e => e.includes('90'));
console.log('Contains "90"?', has90);
console.log('');

// Test 2: "rice vinegar"
console.log('Test 2: rice vinegar');
const parsed2 = parseIngredientLine('2 tbsp rice vinegar');
const expressions2 = buildSearchExpressions(parsed2, 'rice vinegar');
console.log('Expressions:', JSON.stringify(expressions2.slice(0, 5)));
const hasVinegarOnly = expressions2.includes('vinegar');
console.log('Has generic "vinegar" fallback?', hasVinegarOnly);
console.log('');

// Test 3: "93% lean ground beef"
console.log('Test 3: 93% lean ground beef');
const parsed3 = parseIngredientLine('1 lb 93% lean ground beef');
const expressions3 = buildSearchExpressions(parsed3, '93% lean ground beef');
console.log('Expressions:', JSON.stringify(expressions3.slice(0, 5)));
const has93 = expressions3.some(e => e.includes('93'));
console.log('Contains "93"?', has93);
console.log('');

// Summary
console.log('SUMMARY:');
console.log('  90 lean preserved:', has90 ? 'YES ✓' : 'NO ✗');
console.log('  93% preserved:', has93 ? 'YES ✓' : 'NO ✗');
console.log('  Rice vinegar protected:', !hasVinegarOnly ? 'YES ✓' : 'NO ✗');
