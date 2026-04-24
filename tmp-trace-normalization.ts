import * as fs from 'fs';
import { parseIngredientLine } from './src/lib/parse/ingredient-line';
import { normalizeIngredientName } from './src/lib/fatsecret/normalization-rules';
import { hasCoreTokenMismatch, isCategoryMismatch, isMultiIngredientMismatch, hasCriticalModifierMismatch, isReplacementMismatch } from './src/lib/fatsecret/filter-candidates';

async function test() {
    const cases = [
        { q: "2 large eggs", f: "EGGS", b: undefined },
        { q: "1 medium onion", f: "raw onions", b: undefined },
        { q: "1 dash pepper", f: "pepper black spices", b: undefined }
    ];

    const results = [];
    for (const c of cases) {
        let r: any = { query: c.q, foodName: c.f };
        const parsed = parseIngredientLine(c.q);
        const baseName = parsed?.name?.trim() || c.q;
        const norm = normalizeIngredientName(baseName).cleaned || baseName;
        
        r.norm = norm;
        r.earlyCoreTokenMismatch = hasCoreTokenMismatch(norm, c.f, c.b);
        r.isCategoryMismatch = isCategoryMismatch(norm, c.f, c.b);
        r.isMultiIngredientMismatch = isMultiIngredientMismatch(norm, c.f);
        r.hasCriticalModifierMismatch = hasCriticalModifierMismatch(c.q, c.f, 'cache');
        r.isReplacementMismatch = isReplacementMismatch(c.q, c.f, c.b);
        
        results.push(r);
    }
    fs.writeFileSync('tmp-trace-filters.json', JSON.stringify(results, null, 2));
}

test().catch(console.error);
