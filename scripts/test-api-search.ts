import 'dotenv/config';
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { FATSECRET_CLIENT_ID, FATSECRET_CLIENT_SECRET } from '../src/lib/fatsecret/config';

const FAILING_INGREDIENTS = [
    'salt', 'Italian seasoning', 'cayenne pepper', 'vegetable oil',
    'canola oil', 'coconut oil', 'baking soda', 'splenda',
    'rosemary', 'dijon mustard', 'light butter', 'parsley flakes',
    'salted butter', 'sesame oil', 'sweetener', 'kosher salt',
    'oil', 'butter cooking spray', 'petite tomatoes',
    'tomatoes with green chilies', 'no calorie sweetener', 'coarse salt',
];

async function main() {
    console.log('=== API Credential Check ===');
    console.log('FATSECRET_CLIENT_ID:', FATSECRET_CLIENT_ID ? `SET (${FATSECRET_CLIENT_ID.slice(0, 5)}...)` : 'EMPTY');
    console.log('FATSECRET_CLIENT_SECRET:', FATSECRET_CLIENT_SECRET ? 'SET' : 'EMPTY');
    console.log('FDC_API_KEY:', process.env.FDC_API_KEY ? 'SET' : 'EMPTY');
    console.log();

    const client = new FatSecretClient();

    console.log('=== Testing FatSecret API for Failing Ingredients ===');
    for (const ingredient of FAILING_INGREDIENTS.slice(0, 10)) {
        try {
            const results = await client.searchFoodsV4(ingredient, { maxResults: 3 });
            if (results.length === 0) {
                console.log(`❌ "${ingredient}" → 0 results`);
            } else {
                console.log(`✓ "${ingredient}" → ${results.length} results:`);
                results.forEach(r => console.log(`    - [${r.id}] ${r.name} ${r.brandName ? `(${r.brandName})` : ''}`));
            }
        } catch (e: any) {
            console.log(`💥 "${ingredient}" → ERROR: ${e.message}`);
        }
    }

    // Also test FDC
    console.log('\n=== Testing FDC API for Failing Ingredients ===');
    const FDC_API_KEY = process.env.FDC_API_KEY;
    for (const ingredient of FAILING_INGREDIENTS.slice(0, 5)) {
        try {
            const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(ingredient)}&pageSize=3&api_key=${FDC_API_KEY}`;
            const resp = await fetch(url);
            const data = await resp.json() as any;
            const foods = data.foods || [];
            if (foods.length === 0) {
                console.log(`❌ "${ingredient}" → 0 results`);
            } else {
                console.log(`✓ "${ingredient}" → ${foods.length} results:`);
                foods.slice(0, 3).forEach((f: any) => console.log(`    - [${f.fdcId}] ${f.description}`));
            }
        } catch (e: any) {
            console.log(`💥 "${ingredient}" → ERROR: ${e.message}`);
        }
    }
}

main().catch(console.error);
