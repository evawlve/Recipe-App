import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { filterCandidatesByTokens, isCategoryMismatch, isFoodTypeMismatch } from '../src/lib/fatsecret/filter-candidates';

console.log('Test Results:');
console.log('');

// Fix 1: Dimension Pattern Stripping
const parsed1 = parseIngredientLine('1 5" long sweet potato');
const fix1Pass = parsed1?.name === 'long sweet potato';
console.log('Fix 1 (Dimension Stripping):', fix1Pass ? 'PASS' : 'FAIL');
if (!fix1Pass) console.log('  Got:', parsed1?.name, 'Expected: long sweet potato');

// Fix 2: Physical State Guard for Dairy
const mismatch1 = isCategoryMismatch('milk lowfat', 'Lowfat Dry Milk', null);
const fix2Pass = mismatch1 === true;
console.log('Fix 2 (Dry Milk Rejection):', fix2Pass ? 'PASS' : 'FAIL');
if (!fix2Pass) console.log('  Got:', mismatch1, 'Expected: true');

// Fix 3: Juice Token Enforcement
const juiceMismatch = isFoodTypeMismatch('pineapple juice', 'Pineapple', null);
const fix3Pass = juiceMismatch === true;
console.log('Fix 3 (Juice Token):', fix3Pass ? 'PASS' : 'FAIL');
if (!fix3Pass) console.log('  Got:', juiceMismatch, 'Expected: true');

// Full filter test
const candidates = [{ id: '1', name: 'Pineapple', source: 'fatsecret' as const, score: 1.0, rawData: {} }];
const result = filterCandidatesByTokens(candidates, 'pineapple juice', { rawLine: '1.5 cup pineapple juice' });
const fix3bPass = result.filtered.length === 0;
console.log('Fix 3b (Filter Test):', fix3bPass ? 'PASS' : 'FAIL');
if (!fix3bPass) console.log('  Got filtered:', result.filtered.length, 'Expected: 0');

// Fix 4: Tacos vs Nachos
const fix4Pass = isCategoryMismatch('tacos', 'nachos taco bell', null) === true;
console.log('Fix 4 (Tacos vs Nachos):', fix4Pass ? 'PASS' : 'FAIL');

// Fix 5a: Specialty Pasta Guard
const fix5aPass = isCategoryMismatch('linguini', 'Chickpea Pasta', null) === true;
console.log('Fix 5a (Linguini vs Chickpea):', fix5aPass ? 'PASS' : 'FAIL');

// Fix 5b: Specialty Flour Guard
const fix5bPass = isCategoryMismatch('flour', 'Almond Flour', null) === true;
console.log('Fix 5b (Flour vs Almond Flour):', fix5bPass ? 'PASS' : 'FAIL');

// Fix 6: Extra Lean Beef Guard
const fix6Pass = isCategoryMismatch('extra lean ground beef', '85% Lean Ground Beef', null) === true;
console.log('Fix 6 (Extra Lean vs 85%):', fix6Pass ? 'PASS' : 'FAIL');

// Fix 7a: Crushed Tomatoes Guard
const fix7aPass = isCategoryMismatch('crushed tomatoes', 'Fresh Tomatoes', null) === true;
console.log('Fix 7a (Crushed vs Fresh):', fix7aPass ? 'PASS' : 'FAIL');

// Fix 7b: Fresh Tomatoes Guard
const fix7bPass = isCategoryMismatch('tomatoes', 'Crushed Tomatoes', null) === true;
console.log('Fix 7b (Fresh vs Crushed):', fix7bPass ? 'PASS' : 'FAIL');

console.log('');
const allPass = fix1Pass && fix2Pass && fix3Pass && fix3bPass && fix4Pass && fix5aPass && fix5bPass && fix6Pass && fix7aPass && fix7bPass;
console.log('All fixes:', allPass ? 'PASS' : 'SOME FAILED');
