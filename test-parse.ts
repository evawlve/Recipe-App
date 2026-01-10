import { parseIngredientLine } from './src/lib/parse/ingredient-line';

const result = parseIngredientLine('2 egg whites, stirred until fluffy');
console.log('Result:', JSON.stringify(result, null, 2));
console.log('');
console.log('name:', result?.name);
console.log('unitHint:', result?.unitHint);
console.log('prepPhrases:', result?.prepPhrases);
