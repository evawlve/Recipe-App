import 'dotenv/config';
import { getRedisClient } from '../src/lib/search/redisearch-client';

async function main() {
    const client = await getRedisClient();
    const res = await client.sendCommand(['FT.SEARCH', 'off_foods', 'milk', 'LIMIT', '0', '1']);
    console.log('Response is array:', Array.isArray(res));
    console.log('Response length:', res?.length);
    console.log('Sample content:', JSON.stringify(res, null, 2));
    await client.disconnect();
}

main().catch(console.error);
