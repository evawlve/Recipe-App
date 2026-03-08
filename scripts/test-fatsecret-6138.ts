import 'dotenv/config';
import { FatSecretClient } from '../src/lib/fatsecret/client';

const client = new FatSecretClient();

async function testFoodDetails() {
    console.log('Testing FatSecret food.get for ID 6138...\n');

    try {
        const details = await client.getFoodDetails('6138');
        console.log('Success!');
        console.log('  Food name:', details?.name);
        console.log('  Servings:', details?.servings?.length);
    } catch (e) {
        console.log('Error:', (e as Error).message);
    }
}

testFoodDetails().catch(console.error);
