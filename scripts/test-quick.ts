#!/usr/bin/env tsx
import 'dotenv/config';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';

const trimmed = '1 tbsp oil';
const parsed = parseIngredientLine(trimmed);
let baseName = parsed?.name?.trim() || trimmed;

const GENERIC_FALLBACKS: Record<string, string> = {
    'oil': 'vegetable oil',
    'liquid': 'water',
};

const baseNameLower = baseName.toLowerCase().trim();
console.log('baseName:', baseName);
console.log('baseNameLower:', baseNameLower);
console.log('Has fallback:', !!GENERIC_FALLBACKS[baseNameLower]);

if (GENERIC_FALLBACKS[baseNameLower]) {
    baseName = GENERIC_FALLBACKS[baseNameLower];
    console.log('New baseName:', baseName);
}
