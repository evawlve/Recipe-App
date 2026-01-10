import 'dotenv/config';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';

// Test parsing the simplified term
const inputs = [
    "0.25 cup nonfat Italian dressing",  // Original
    "Fat-Free Italian Dressing",          // Simplified
    "italian dressing",                    // More simplified
];

for (const input of inputs) {
    const parsed = parseIngredientLine(input);
    console.log(`\n"${input}":`);
    console.log(`  qty: ${parsed?.qty ?? 'null'}`);
    console.log(`  unit: ${parsed?.unit ?? 'null'}`);
    console.log(`  name: ${parsed?.name ?? 'null'}`);
}
