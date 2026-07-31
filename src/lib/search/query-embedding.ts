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

export type QueryPooling = 'cls' | 'mean';

/**
 * POOLING MUST MATCH THE CORPUS, AND THE CORPUS IS CLS.
 *
 * `scripts/embed-off-cpu.ts` writes document vectors with an explicit
 * `pooling: 'cls'`. `scripts/embed_foods.py`, which wrote the original corpus,
 * states no pooling at all — it calls `SentenceTransformer(...).encode()` and
 * inherits whatever the model repo's `1_Pooling/config.json` specifies, so its
 * side is settled by MEASUREMENT, not by reading it: re-embedding stored rows
 * reproduces their live vectors at cosine 1.00000 under 'cls' and ~0.947 under
 * 'mean' (measured 2026-07-30, re-measured 2026-07-31 over 5 sampled OFF rows;
 * re-derive with `scripts/eval/semantic-recall-probe.ts`, control C4).
 * This file embedded queries with 'mean' from the start, so
 * queries and documents sat in different vector spaces — a silent recall tax
 * that the golden set could not see (`search/semantic` scored 5/5 through it).
 * BGE's own documented usage is CLS on both sides, so the query side was the
 * wrong one. Changed to 'cls' on 2026-07-31.
 *
 * If document vectors are ever rewritten with a different pooling, this constant
 * moves in the SAME commit. `scripts/eval/semantic-recall-probe.ts` measures the
 * difference and re-derives which pooling the live corpus is actually in.
 */
export const CORPUS_POOLING: QueryPooling = 'cls';

/**
 * Diagnostic override, read per call so a probe can A/B both poolings in one
 * process against one loaded model. NOT a tuning knob: any value other than the
 * corpus pooling puts queries in the wrong space, so it warns every time it is
 * honoured. Unset (the production case) means `CORPUS_POOLING`.
 */
function resolveQueryPooling(): QueryPooling {
    const raw = process.env.EMBED_QUERY_POOLING;
    if (!raw) return CORPUS_POOLING;
    if (raw !== 'cls' && raw !== 'mean') {
        logger.warn('embedding.pooling_override_invalid', { value: raw, using: CORPUS_POOLING });
        return CORPUS_POOLING;
    }
    if (raw !== CORPUS_POOLING) {
        logger.warn('embedding.pooling_override_mismatched_corpus', { override: raw, corpus: CORPUS_POOLING });
    }
    return raw;
}

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
        const pooling = resolveQueryPooling();
        const started = Date.now();
        const output = await extractor(BGE_QUERY_PREFIX + cleaned, { pooling, normalize: true });
        logger.debug('embedding.query_embedded', { text: cleaned, pooling, embedMs: Date.now() - started });
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
