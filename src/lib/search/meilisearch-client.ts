import { MEILISEARCH_ENABLED, MEILISEARCH_HOST, MEILISEARCH_API_KEY } from '../mapping/config';
import { logger } from '../logger';

// Helper to make request to Meilisearch
async function meiliFetch(endpoint: string, options: RequestInit = {}): Promise<any> {
    const url = `${MEILISEARCH_HOST}${endpoint}`;
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (MEILISEARCH_API_KEY) {
        headers['Authorization'] = `Bearer ${MEILISEARCH_API_KEY}`;
    }

    const res = await fetch(url, {
        headers,
        ...options,
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Meilisearch request to ${endpoint} failed with status ${res.status}: ${text}`);
    }

    // Some endpoints return empty body or 204
    if (res.status === 204) return null;
    return res.json();
}

/**
 * Checks if Meilisearch is active and healthy
 */
export async function isMeiliAvailable(): Promise<boolean> {
    if (!MEILISEARCH_ENABLED) return false;
    try {
        const health = await meiliFetch('/health');
        return health?.status === 'available';
    } catch (err) {
        logger.warn('meilisearch.health_check_failed', { error: (err as Error).message });
        return false;
    }
}

/**
 * Perform a search query against a Meilisearch index.
 */
export async function searchMeili(
    indexUid: string,
    query: string,
    limit: number = 5
): Promise<any[]> {
    try {
        const res = await meiliFetch(`/indexes/${indexUid}/search`, {
            method: 'POST',
            body: JSON.stringify({ q: query, limit }),
        });
        return res.hits || [];
    } catch (err) {
        logger.warn('meilisearch.search_failed', { indexUid, query, error: (err as Error).message });
        throw err; // rethrow to trigger database fallback
    }
}

/**
 * Updates settings for a specific index.
 */
export async function updateIndexSettings(indexUid: string, settings: any): Promise<any> {
    logger.info('meilisearch.updating_settings', { indexUid, settings });
    return meiliFetch(`/indexes/${indexUid}/settings`, {
        method: 'PATCH',
        body: JSON.stringify(settings),
    });
}
