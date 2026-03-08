
import 'dotenv/config';
import { FatSecretClient } from '@/lib/fatsecret/client';

async function testSearch() {
    console.log('Client ID length:', process.env.FATSECRET_CLIENT_ID?.length);
    const client = new FatSecretClient();
    console.log('Searching for "apple"...');
    try {
        const results = await client.searchFoods('apple');
        console.log('Total results:', results.totalResults);

        if (results.foods.length > 0) {
            console.log('First result:', JSON.stringify(results.foods[0], null, 2));
            if (results.foods[0].servings) {
                console.log('Servings found in search result!');
            } else {
                console.log('No servings in search result.');
            }
        } else {
            console.log('No results found.');
        }
    } catch (error) {
        console.error('Search failed:', error);
    }
}

testSearch().catch(console.error);
