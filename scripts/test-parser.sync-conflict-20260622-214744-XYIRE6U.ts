import { parseIngredientLine } from '../src/lib/parse/ingredient-line';

const tests = ['egg', 'eggs', 'butter', '1 egg', '2 tbsp butter', '2 tbsps salted butter', '1 cup flour', 'salt', 'scallions', '3 scallions'];

for (const t of tests) {
    const r = parseIngredientLine(t);
    console.log(`"${t}" -> ${r ? `qty=${r.qty}, unit=${r.unit || 'null'}, name="${r.name}"` : 'null'}`);
}
