
import 'dotenv/config';
import { fdcApi } from '@/lib/usda/fdc-api';

async function testFdcSearch() {
    console.log('Testing FDC Search...');
    if (!process.env.FDC_API_KEY) {
        console.error('FDC_API_KEY is missing!');
        return;
    }

    try {
        const results = await fdcApi.searchFoods({ query: 'apple', pageSize: 1 });
        if (results && results.foods.length > 0) {
            console.log('First result keys:', Object.keys(results.foods[0]));
            console.log('First result:', JSON.stringify(results.foods[0], null, 2));
        } else {
            console.log('No results found.');
        }
    } catch (error) {
        console.error('Search failed:', error);
    }
}

testFdcSearch().catch(console.error);
