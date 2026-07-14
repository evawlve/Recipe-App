import { createClient } from 'redis';
import { logger } from '../logger';

const HOST = process.env.REDIS_HOST ?? '192.168.1.21';
const PORT = process.env.REDIS_PORT ?? '6379';

let redisClient: any = null;

export async function getRedisClient() {
    if (!redisClient) {
        redisClient = createClient({
            url: `redis://${HOST}:${PORT}`
        });
        redisClient.on('error', (err: any) => {
            logger.error('redis.client_error', { error: err.message });
        });
        await redisClient.connect();
    }
    return redisClient;
}

/**
 * Checks if Redis is active and healthy
 */
export async function isRedisAvailable(): Promise<boolean> {
    try {
        const client = await getRedisClient();
        const ping = await client.ping();
        return ping === 'PONG';
    } catch (err) {
        logger.warn('redis.health_check_failed', { error: (err as Error).message });
        return false;
    }
}

/**
 * Perform a RediSearch query against an index
 */
export async function searchRediSearch(
    indexName: string,
    query: string,
    limit: number = 5
): Promise<any[]> {
    try {
        const client = await getRedisClient();
        
        // Escape special characters in query (like colons, dashes, etc.)
        const escapedQuery = query
            .replace(/[/\\()@#$&|*~?+={}[\]]/g, '\\$&')
            .trim();
        
        if (!escapedQuery) return [];

        // Run FT.SEARCH command
        const res = await client.sendCommand([
            'FT.SEARCH',
            indexName,
            escapedQuery,
            'LIMIT',
            '0',
            String(limit)
        ]);

        if (!res || !res.results) return [];

        const hits = [];
        
        for (const item of res.results) {
            const doc: Record<string, any> = {
                ...(item.extra_attributes || {}),
                ...(item.attributes || {}),
                id: item.id
            };

            // De-serialize JSON fields
            if (doc.nutrientsPer100g) {
                try {
                    doc.nutrientsPer100g = JSON.parse(doc.nutrientsPer100g);
                } catch (e) {}
            }
            if (doc.servings) {
                try {
                    doc.servings = JSON.parse(doc.servings);
                } catch (e) {}
            }
            if (doc.servingGrams) {
                doc.servingGrams = doc.servingGrams !== 'null' ? Number(doc.servingGrams) : null;
            }
            
            // Map barcode from index/hash if needed
            if (doc.barcode && !doc.id) {
                doc.id = `off_${doc.barcode}`;
            } else if (doc.fdcId && !doc.id) {
                doc.id = `fdc_${doc.fdcId}`;
            }

            hits.push(doc);
        }

        return hits;
    } catch (err) {
        logger.warn('redisearch.search_failed', { indexName, query, error: (err as Error).message });
        throw err;
    }
}

/**
 * Creates a RediSearch index
 */
export async function createRediSearchIndex(
    indexName: string,
    prefix: string,
    schemaFields: string[]
): Promise<any> {
    try {
        const client = await getRedisClient();
        
        // Check if index already exists
        try {
            await client.sendCommand(['FT.INFO', indexName]);
            logger.info('redisearch.index_exists_recreating', { indexName });
            await client.sendCommand(['FT.DROPINDEX', indexName]);
        } catch (e) {
            // Index doesn't exist, proceed
        }

        const createCmd = [
            'FT.CREATE',
            indexName,
            'ON',
            'HASH',
            'PREFIX',
            '1',
            prefix,
            'SCHEMA',
            ...schemaFields
        ];

        logger.info('redisearch.creating_index', { indexName, prefix });
        return await client.sendCommand(createCmd);
    } catch (err) {
        logger.error('redisearch.index_creation_failed', { indexName, error: (err as Error).message });
        throw err;
    }
}
