import { logger } from '../logger';

const HOST = process.env.ELASTICSEARCH_HOST ?? 'http://192.168.1.21:9200';

async function esFetch(endpoint: string, options: RequestInit = {}): Promise<any> {
    const url = `${HOST}${endpoint}`;
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> | undefined),
    };

    const res = await fetch(url, {
        headers,
        ...options,
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Elasticsearch request to ${endpoint} failed with status ${res.status}: ${text}`);
    }

    if (res.status === 204) return null;
    return res.json();
}

/**
 * Checks if Elasticsearch is active and healthy
 */
export async function isElasticAvailable(): Promise<boolean> {
    try {
        const health = await esFetch('/_cluster/health');
        return health?.status === 'green' || health?.status === 'yellow';
    } catch (err) {
        logger.warn('elasticsearch.health_check_failed', { error: (err as Error).message });
        return false;
    }
}

/**
 * Perform a search query against an Elasticsearch index. Mirrors the
 * meilisearch/typesense/redisearch client shape — returns a flat array of
 * raw document sources so all four engines are drop-in interchangeable for
 * the benchmark harness.
 */
export async function searchElastic(
    indexName: string,
    query: string,
    fields: string[] = ['name^2', 'brandName'],
    limit: number = 5
): Promise<any[]> {
    try {
        const res = await esFetch(`/${indexName}/_search`, {
            method: 'POST',
            body: JSON.stringify({
                size: limit,
                query: {
                    multi_match: {
                        query,
                        fields,
                        fuzziness: 'AUTO',
                    },
                },
            }),
        });
        return (res.hits?.hits || []).map((hit: any) => ({ ...hit._source, _score: hit._score }));
    } catch (err) {
        logger.warn('elasticsearch.search_failed', { indexName, query, error: (err as Error).message });
        throw err;
    }
}

/**
 * Creates an index with the given mapping (deletes any existing index of the
 * same name first so re-syncs don't accumulate stale/duplicate mappings).
 */
export async function createElasticIndex(indexName: string, mappings: any): Promise<any> {
    try {
        await esFetch(`/${indexName}`, { method: 'DELETE' });
        logger.info('elasticsearch.deleted_existing_index', { indexName });
    } catch (e) {
        // Index didn't exist — fine
    }

    logger.info('elasticsearch.creating_index', { indexName });
    return esFetch(`/${indexName}`, {
        method: 'PUT',
        body: JSON.stringify({ mappings }),
    });
}

/**
 * Bulk-index documents using the _bulk API (newline-delimited JSON).
 */
export async function bulkIndexElastic(
    indexName: string,
    documents: { id: string; doc: any }[]
): Promise<any> {
    const lines: string[] = [];
    for (const { id, doc } of documents) {
        lines.push(JSON.stringify({ index: { _index: indexName, _id: id } }));
        lines.push(JSON.stringify(doc));
    }
    const bulkBody = lines.join('\n') + '\n';

    return esFetch('/_bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-ndjson' },
        body: bulkBody,
    });
}
