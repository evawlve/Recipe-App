import 'dotenv/config';
import { mapIngredientWithFdc } from '../src/lib/usda/map-ingredient-fdc';
import { fdcApi } from '../src/lib/usda/fdc-api';

async function main() {
    const rawLine = "0.5 cup almond flour";
    console.log(`Testing FDC mapping for: "${rawLine}"`);

    // 1. Check raw search results
    console.log('\n--- FDC Search Results ---');
    const searchRes = await fdcApi.searchFoods({ query: "almond flour", pageSize: 5 });
    if (searchRes?.foods) {
        searchRes.foods.forEach(f => {
            console.log(`[${f.fdcId}] ${f.description} (${f.dataType}) - Brand: ${f.brandName}`);
        });

        // 2. Check details for top result
        const top = searchRes.foods[0];
        if (top) {
            console.log(`\n--- Details for Top Result [${top.fdcId}] ---`);
            const details = await fdcApi.getFoodDetails(top.fdcId);
            if (details) {
                console.log('Serving Size:', details.servingSize, details.servingSizeUnit);
                console.log('Nutrients (partial):');
                details.foodNutrients.forEach((n: any) => {
                    if ([1008, 1003, 1004, 1005].includes(n.nutrient?.id || n.nutrientId)) {
                        console.log(`- ${n.nutrient?.name || n.nutrientName} (ID ${n.nutrient?.id || n.nutrientId}): ${n.amount} ${n.nutrient?.unitName || n.unitName}`);
                    }
                });
            }
        }
    }

    // 3. Check full mapping function
    console.log('\n--- Full Mapping Result ---');
    const result = await mapIngredientWithFdc(rawLine);
    console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);
