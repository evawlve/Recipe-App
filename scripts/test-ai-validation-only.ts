import 'dotenv/config';
import { validateMappingWithAI } from '../src/lib/fatsecret/ai-validation';

async function main() {
    console.log('Testing AI Validation for Almond Flour...');

    const result = await validateMappingWithAI('0.5 cup almond flour', {
        foodId: '123',
        foodName: 'Almond Flour Meal',
        brandName: 'Hodgson Mill',
        searchQuery: 'almond flour',
        ourConfidence: 0.8,
        nutrition: {
            protein: 20,
            carbs: 20,
            fat: 53.3333,
            kcal: 600,
        },
    });

    console.log('\nResult:', JSON.stringify(result, null, 2));
    if (result.standardValuesForIngredient) {
        console.log('\nAI Standard Values:', JSON.stringify(result.standardValuesForIngredient, null, 2));
    }
}

main().catch(console.error);
