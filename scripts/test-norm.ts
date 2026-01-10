import { normalizeIngredientName, clearRulesCache } from '../src/lib/fatsecret/normalization-rules';

// Clear cache to pick up fresh rules
clearRulesCache();

console.log(JSON.stringify({
    'all purpose flour': normalizeIngredientName('all purpose flour').cleaned,
    'liquid aminos': normalizeIngredientName('liquid aminos').cleaned,
    '100% liquid': normalizeIngredientName('100% liquid').cleaned,
    'ice cubes ice cubes': normalizeIngredientName('ice cubes ice cubes').cleaned,
    'single cream': normalizeIngredientName('single cream').cleaned,
    'ground beef': normalizeIngredientName('ground beef').cleaned,
}, null, 2));
