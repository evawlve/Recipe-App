import { searchFood, getFoodDetails } from '../src/lib/fatsecret/client';

async function main() {
    console.log("Searching for Palm Sugar...");
    const results = await searchFood('Palm Sugar');
    if (results && results.length > 0) {
        console.log(`Top result: ${results[0].food_name} (${results[0].food_id})`);
        const details = await getFoodDetails(results[0].food_id);
        console.log("Servings:");
        details?.servings?.serving?.forEach(s => {
            console.log(` - ${s.serving_description}: ${s.metric_serving_amount}${s.metric_serving_unit}`);
        });
    }

    console.log("\nSearching for Jalapeno Pepper...");
    const jalResults = await searchFood('Jalapeno Pepper');
    if (jalResults && jalResults.length > 0) {
        console.log(`Top result: ${jalResults[0].food_name} (${jalResults[0].food_id})`);
    }
}

main().catch(console.error);
