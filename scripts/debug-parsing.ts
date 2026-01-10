import { parseIngredientLine } from '../src/lib/parse/ingredient-line';

const tests = [
    '30 ml olive oil',
    '1 cup flour',
    '2 tbsp butter',
    '100g sugar',
    '30ml milk',  // No space
    'olive oil',  // No qty, no unit
];

for (const t of tests) {
    const p = parseIngredientLine(t);
    console.log(`"${t}"`);
    console.log(`  qty=${p?.qty ?? 'null'}, unit="${p?.unit ?? 'null'}", name="${p?.name ?? 'null'}"`);
    console.log('');
}
