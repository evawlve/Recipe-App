import { parseIngredientLine } from './src/lib/parse/ingredient-line';
console.log(JSON.stringify(parseIngredientLine("2 cup chicken broth"), null, 2));
console.log(JSON.stringify(parseIngredientLine(" 2 cup chicken broth"), null, 2));
