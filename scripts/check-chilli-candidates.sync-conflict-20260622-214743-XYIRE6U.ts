/**
 * Quick check: what candidates are returned for "chilli peppers"
 */
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { fdcApi } from '../src/lib/usda/fdc-api';

async function main() {
    const client = new FatSecretClient();

    console.log('\n=== FatSecret API Results for "chilli peppers" ===\n');
    try {
        const fsResults = await client.searchFoods('chilli peppers', 10);
        const foods = fsResults.foods?.food || [];
        if (Array.isArray(foods)) {
            foods.slice(0, 10).forEach((f: any, i: number) => {
                console.log(`${i + 1}. ${f.food_name} [${f.food_type}] ID:${f.food_id}`);
            });
        } else {
            console.log('Single result:', foods.food_name);
        }
    } catch (err) {
        console.log('FatSecret error:', (err as Error).message);
    }

    console.log('\n=== FDC API Results for "chilli peppers" ===\n');
    try {
        const fdcResults = await fdcApi.searchFoods({ query: 'chilli peppers', pageSize: 10 });
        fdcResults.foods?.slice(0, 10).forEach((f: any, i: number) => {
            console.log(`${i + 1}. ${f.description} [${f.dataType}] ${f.brandName || ''}`);
        });
    } catch (err) {
        console.log('FDC error:', (err as Error).message);
    }

    console.log('\n=== FDC API Results for "chili peppers" (American spelling) ===\n');
    try {
        const fdcResults = await fdcApi.searchFoods({ query: 'chili peppers', pageSize: 10 });
        fdcResults.foods?.slice(0, 10).forEach((f: any, i: number) => {
            console.log(`${i + 1}. ${f.description} [${f.dataType}] ${f.brandName || ''}`);
        });
    } catch (err) {
        console.log('FDC error:', (err as Error).message);
    }
}

main().catch(console.error);
