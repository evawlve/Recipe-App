import { parseIngredient } from '../src/lib/parse-ingredient';

const input = process.argv[2] || "3 strips yellow peppers";
console.log(JSON.stringify(parseIngredient(input), null, 2));
