import { FatSecretClient } from '../src/lib/fatsecret/client';
import { mapIngredientWithFatsecret } from '../src/lib/fatsecret/map-ingredient';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
    const args = process.argv.slice(2);
    const ingredient = args.join(' ');

    if (!ingredient) {
        console.error('Please provide an ingredient string to debug.');
        console.error('Usage: npx ts-node scripts/debug-ingredient-mapping.ts "2 tsps chili powder"');
        process.exit(1);
    }

    console.log(`\n🔍 Debugging mapping for: "${ingredient}"\n`);
    console.log('------------------------------------------------');

    const client = new FatSecretClient();

    try {
        const result = await mapIngredientWithFatsecret(ingredient, {
            client,
            debug: true,
            minConfidence: 0 // Set to 0 to see all results in debug logs even if they fail threshold
        });

        console.log('\n------------------------------------------------');
        if (result) {
            console.log('✅ MAPPING SUCCESS');
            console.log('Food:', result.foodName);
            console.log('ID:', result.foodId);
            console.log('Serving:', result.servingDescription);
            console.log('Grams:', result.grams);
            console.log('Confidence:', result.confidence);
        } else {
            console.log('❌ MAPPING FAILED');
            console.log('No candidate met the criteria.');
        }
        console.log('------------------------------------------------');
        console.log('\nCheck "logs/fatsecret-debug-{date}.jsonl" for detailed scoring breakdown.');

    } catch (error) {
        console.error('Error during mapping:', error);
    }
}

main();
