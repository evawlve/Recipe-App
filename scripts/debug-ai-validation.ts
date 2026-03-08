import 'dotenv/config';
import fs from 'fs';
import { validateMappingWithAI } from '../src/lib/fatsecret/ai-validation';

async function main() {
    const rawIngredient = "0.5 cup reduced fat mozzarella cheese";
    const mapping = {
        foodId: "11540315",
        foodName: "Reduced Fat Mozzarella Cheese",
        brandName: undefined,
        searchQuery: "0.5 cup reduced fat mozzarella cheese",
        ourConfidence: 0.728,
        nutrition: {
            protein: 24.26,
            carbs: 2.94,
            fat: 15.44,
            kcal: 254
        }
    };

    const scenarios = [
        {
            name: "Original (Reproduction)",
            mapping: mapping
        },
        {
            name: "Clean Search Query (No measurement)",
            mapping: { ...mapping, searchQuery: "reduced fat mozzarella cheese" }
        },
        {
            name: "Lower Fat (10g)",
            mapping: { ...mapping, nutrition: { ...mapping.nutrition, fat: 10 } }
        },
        {
            name: "Exact Name Match (lowercase)",
            mapping: { ...mapping, foodName: "reduced fat mozzarella cheese" }
        }
    ];

    let output = '';
    const log = (msg: string) => {
        console.log(msg);
        output += msg + '\n';
    };

    for (const scenario of scenarios) {
        log(`\n\n=== Testing Scenario: ${scenario.name} ===`);
        const result = await validateMappingWithAI(rawIngredient, scenario.mapping);
        log(`Approved: ${result.approved}`);
        log(`Reason: ${result.reason}`);
        log(`Category: ${result.category}`);
        log(`Confidence: ${result.confidence}`);
    }

    fs.writeFileSync('debug_results.log', output);
}

main().catch(console.error);
