import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function debugAlmondFlour() {
    console.log('Testing: 0.5 cup almond flour\n');

    // Monkey-patch validateMappingWithAI to see what it receives
    const originalValidate = (await import('../src/lib/fatsecret/ai-validation')).validateMappingWithAI;
    const aiValidation = await import('../src/lib/fatsecret/ai-validation');

    (aiValidation as any).validateMappingWithAI = async (rawLine: string, mapping: any) => {
        console.log('=== AI VALIDATION INPUT ===');
        console.log('Raw ingredient:', rawLine);
        console.log('Mapped to:', mapping.foodName);
        console.log('Brand:', mapping.brandName || 'N/A');
        console.log('Search query:', mapping.searchQuery);
        console.log('Our confidence:', mapping.ourConfidence);
        console.log('\nNutrition (what AI sees):');
        console.log('  Protein:', mapping.nutrition.protein, 'g per 100g');
        console.log('  Carbs:', mapping.nutrition.carbs, 'g per 100g');
        console.log('  Fat:', mapping.nutrition.fat, 'g per 100g');
        console.log('  Calories:', mapping.nutrition.kcal, 'kcal per 100g');
        console.log('===========================\n');

        return originalValidate(rawLine, mapping);
    };

    const result = await mapIngredientWithFallback('0.5 cup almond flour', { debug: false });

    if (!result) {
        console.log('❌ No mapping found');
        return;
    }

    console.log('\n=== MAPPING RESULT ===');
    console.log('Mapped to:', result.foodName);
    console.log('Brand:', result.brandName || 'N/A');
    console.log('Grams (recipe amount):', result.grams, 'g');
    console.log('\nNutrition (for recipe amount - ' + result.grams + 'g):');
    console.log('  Protein:', result.protein, 'g');
    console.log('  Carbs:', result.carbs, 'g');
    console.log('  Fat:', result.fat, 'g');
    console.log('  Calories:', result.kcal, 'kcal');

    console.log('\nCalculated per-100g (manual check):');
    console.log('  Protein:', (result.protein / result.grams) * 100, 'g');
    console.log('  Carbs:', (result.carbs / result.grams) * 100, 'g');
    console.log('  Fat:', (result.fat / result.grams) * 100, 'g');
    console.log('  Calories:', (result.kcal / result.grams) * 100, 'kcal');

    if (result.aiValidation) {
        console.log('\n=== AI DECISION ===');
        console.log('Approved:', result.aiValidation.approved);
        console.log('Confidence:', result.aiValidation.confidence);
        console.log('Reason:', result.aiValidation.reason);
        console.log('Category:', result.aiValidation.category);
    }
}

debugAlmondFlour().catch(console.error);
