import { logger } from '../logger';

const HOST = process.env.TYPESENSE_HOST ?? 'http://192.168.1.21:8108';
const KEY = process.env.TYPESENSE_API_KEY ?? 'xyzapikey';

async function typesenseReq(endpoint: string, options: RequestInit = {}): Promise<any> {
    const url = `${HOST}${endpoint}`;
    const headers: Record<string, string> = {
        'X-TYPESENSE-API-KEY': KEY,
    };
    if (!(options.body instanceof GetHeadersClass)) {
        headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, {
        headers,
        ...options,
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Typesense request to ${endpoint} failed with status ${res.status}: ${text}`);
    }

    if (res.status === 204) return null;
    
    // Some endpoints (like document import) return text/json-lines rather than standard JSON
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        return res.json();
    }
    return res.text();
}

// Dummy class to identify raw bodies that shouldn't have application/json headers
class GetHeadersClass {}

/**
 * Checks if Typesense is active and healthy
 */
export async function isTypesenseAvailable(): Promise<boolean> {
    try {
        const res = await typesenseReq('/health');
        return res?.ok === true;
    } catch (err) {
        logger.warn('typesense.health_check_failed', { error: (err as Error).message });
        return false;
    }
}

/**
 * Perform a search query against a Typesense collection
 */
export async function searchTypesense(
    collectionName: string,
    query: string,
    queryBy: string,
    limit: number = 5
): Promise<any[]> {
    try {
        // typo_tokens_threshold: by default Typesense stops expanding typo-corrected
        // variants as soon as it finds 1 result, which starves fuzzy recall on
        // misspellings relative to Meilisearch. Raise it so we keep collecting
        // typo-corrected candidates up to `limit`; the caller re-scores/dedupes anyway.
        const url = `/collections/${collectionName}/documents/search?q=${encodeURIComponent(query)}&query_by=${queryBy}&limit=${limit}&typo_tokens_threshold=${limit}`;
        const res = await typesenseReq(url, { method: 'GET' });
        // Map Typesense's hit layout to raw document layout so it matches the expected candidates layout
        return (res.hits || []).map((hit: any) => hit.document);
    } catch (err) {
        logger.warn('typesense.search_failed', { collectionName, query, error: (err as Error).message });
        throw err;
    }
}

/**
 * Nearest-neighbor search against a collection's `embedding` field.
 * Returns raw documents (embedding excluded) with `_vectorDistance` attached —
 * cosine distance, so similarity = 1 - _vectorDistance for normalized vectors.
 */
export async function vectorSearchTypesense(
    collectionName: string,
    embedding: number[],
    k: number = 8
): Promise<any[]> {
    try {
        const body = {
            searches: [{
                collection: collectionName,
                q: '*',
                vector_query: `embedding:([${embedding.join(',')}], k:${k})`,
                per_page: k,
                exclude_fields: 'embedding',
            }],
        };
        const res = await typesenseReq('/multi_search', {
            method: 'POST',
            body: JSON.stringify(body),
        });
        const result = res?.results?.[0];
        if (result?.error) {
            throw new Error(`Typesense vector search error: ${result.error}`);
        }
        return (result?.hits || []).map((hit: any) => ({
            ...hit.document,
            _vectorDistance: hit.vector_distance,
        }));
    } catch (err) {
        logger.warn('typesense.vector_search_failed', { collectionName, error: (err as Error).message });
        throw err;
    }
}

/**
 * Creates a collection using a Typesense schema
 */
export async function createTypesenseCollection(schema: any): Promise<any> {
    logger.info('typesense.creating_collection', { name: schema.name });
    return typesenseReq('/collections', {
        method: 'POST',
        body: JSON.stringify(schema),
    });
}

/**
 * Deletes a collection
 */
export async function deleteTypesenseCollection(collectionName: string): Promise<any> {
    logger.info('typesense.deleting_collection', { collectionName });
    return typesenseReq(`/collections/${collectionName}`, {
        method: 'DELETE',
    });
}

/**
 * Import documents in bulk (JSON lines format)
 */
export async function importTypesenseDocuments(
    collectionName: string,
    documents: any[],
    action: 'create' | 'upsert' | 'update' = 'upsert'
): Promise<any> {
    const jsonLines = documents.map(doc => JSON.stringify(doc)).join('\n');
    const url = `/collections/${collectionName}/documents/import?action=${action}`;
    return typesenseReq(url, {
        method: 'POST',
        body: jsonLines,
    });
}
