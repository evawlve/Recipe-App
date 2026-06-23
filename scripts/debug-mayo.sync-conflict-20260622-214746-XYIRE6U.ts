#!/usr/bin/env tsx
import 'dotenv/config';
import { aiNormalizeIngredient } from '../src/lib/fatsecret/ai-normalize';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { applySynonyms } from '../src/lib/fatsecret/normalization-rules';

async function debug() {
    const raw = "2 oz mayonnaise low calorie";
    console.log(`Testing: "${raw}"`);

    // Check normalization
    const norm = await aiNormalizeIngredient(raw);
    console.log('Normalized:', norm);

    // Check applySynonyms manually
    console.log('ApplySynonyms("mayonnaise low calorie"):', applySynonyms("mayonnaise low calorie"));
    console.log('ApplySynonyms("low calorie mayonnaise"):', applySynonyms("low calorie mayonnaise"));

    // Check full map
    const res = await mapIngredientWithFallback(raw);
    console.log('Map Result:', res?.foodName);
}

debug();
