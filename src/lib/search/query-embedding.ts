/**
 * Query-Time Embedding (semantic search)
 *
 * Embeds search queries with the same model used to embed the OffFood corpus
 * (bge-small-en-v1.5, 384-dim, normalized) so they can be compared against the
 * pgvector/Typesense document vectors. Runs a quantized ONNX copy of the model
 * on CPU via transformers.js — ~5–20ms per query once warm.
 *
 * The model (~35MB) is downloaded from HuggingFace on first load and cached
 * under ~/.cache/huggingface (override with HF_HOME). Loaded once at module
 * scope; a failed load is retried on the next query.
 */

import { logger } from '../logger';

const MODEL_ID = 'Xenova/bge-small-en-v1.5';

// bge models expect this exact prefix on QUERIES ONLY — documents were embedded
// without it (see scripts/embed_foods.py, which embeds "{name} — {brandName}").
const BGE_QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

export const SEMANTIC_SEARCH_ENABLED = process.env.SEMANTIC_SEARCH_ENABLED === 'true';

let extractorPromise: Promise<any> | null = null;

function getExtractor(): Promise<any> {
    if (!extractorPromise) {
        extractorPromise = (async () => {
            const { pipeline } = await import('@huggingface/transformers');
            const started = Date.now();
            const extractor = await pipeline('feature-extraction', MODEL_ID, { dtype: 'q8' });
            logger.info('embedding.model_loaded', { model: MODEL_ID, loadMs: Date.now() - started });
            return extractor;
        })();
        extractorPromise.catch((err) => {
            logger.warn('embedding.model_load_failed', { error: (err as Error).message });
            extractorPromise = null; // allow retry on the next query
        });
    }
    return extractorPromise;
}

/**
 * Embed a search query. Returns a normalized 384-dim vector, or null when
 * semantic search is disabled or the model fails — callers must treat null
 * as "keyword-only" and never block on this path.
 */
export async function embedQuery(text: string): Promise<number[] | null> {
    if (!SEMANTIC_SEARCH_ENABLED) return null;
    const cleaned = text.toLowerCase().trim().replace(/\s+/g, ' ');
    if (!cleaned) return null;

    try {
        const extractor = await getExtractor();
        const started = Date.now();
        const output = await extractor(BGE_QUERY_PREFIX + cleaned, { pooling: 'mean', normalize: true });
        logger.debug('embedding.query_embedded', { text: cleaned, embedMs: Date.now() - started });
        return Array.from(output.data as Float32Array);
    } catch (err) {
        logger.warn('embedding.query_embed_failed', { text: cleaned, error: (err as Error).message });
        return null;
    }
}

/** Fire-and-forget model load so the first real query doesn't pay it. */
export function warmupEmbedder(): void {
    if (SEMANTIC_SEARCH_ENABLED) void getExtractor();
}
