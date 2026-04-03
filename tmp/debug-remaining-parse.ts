const { parseIngredientLine } = require('../src/lib/parse/ingredient-line');
const fs = require('fs');

const tests = [
  '4  sprays butter cooking spray',
  'Butter Spray',
  'Palm Sugar',
  'Tortilla Chips',
  '1 cup sour cream',
  '1 tbsp fried shallots',
  '1 serving 1 packet sucralose sweetener',
];

const results: string[] = [];
for (const t of tests) {
  const result = parseIngredientLine(t);
  results.push(`"${t}" => qty=${result?.qty}, unit=${result?.unit}, name="${result?.name}", mult=${result?.multiplier}`);
}

fs.writeFileSync('tmp/debug-remaining.txt', results.join('\n'));
console.log('Done');
