const { parseIngredientLine } = require('../src/lib/parse/ingredient-line');
const fs = require('fs');

const tests = [
  '100% Whey Protein Powder',
  '2% Milk',
  '1 cup 2% milk',
  '1 cup milk',
  'Canola Oil',
  'Black Pepper',
];

const results: string[] = [];
for (const t of tests) {
  const result = parseIngredientLine(t);
  results.push(`"${t}" => qty=${result?.qty}, unit=${result?.unit}, name="${result?.name}"`);
}

fs.writeFileSync('tmp/test-percent-results.txt', results.join('\n'));
console.log('Written to tmp/test-percent-results.txt');
