/**
 * Deferred Hydration Queue
 * 
 * Queues non-selected candidates for hydration AFTER all mappings complete.
 * This prioritizes fast automapping over cache population.
 * 
 * Flow:
 * 1. During mapping: only hydrate the selected candidate
 * 2. Queue remaining candidates for later
 * 3. After batch completes: process the queue
 */

import { logger } from '../logger';
import { FatSecretClient } from './client';
import type { UnifiedCandidate } from './gather-candidates';

// ============================================================
// Queue Storage
// ============================================================

interface ServingContext {
    unit?: string;
    unitType: 'count' | 'volume' | 'weight';
}

interface QueuedCandidate {
    candidate: UnifiedCandidate;
    priority: number; // Lower = higher priority
    queuedAt: number;
    servingContext?: ServingContext;
}

// In-memory queue (cleared on process restart)
let hydrationQueue: QueuedCandidate[] = [];
let isProcessingQueue = false;

// ============================================================
// Queue Management
// ============================================================

/**
 * Fire-and-forget hydration for runner-up candidates.
 * Kicks off immediately when candidates are scored - does NOT block.
 * Hydrates candidates and backfills common servings in parallel.
 */
export function queueForDeferredHydration(
    candidates: UnifiedCandidate[],
    excludeId?: string,
    servingContext?: ServingContext
): void {
    // Filter out the winner and take top 3 remaining (regardless of source)
    const runnerUps = candidates
        .filter(c => !excludeId || c.id !== excludeId)
        .slice(0, 3);  // Top 3 runner-ups total

    if (runnerUps.length === 0) {
        return;
    }

    logger.debug('deferred_hydration.fire_and_forget_start', {
        count: runnerUps.length,
        hasServingContext: !!servingContext,
    });

    // Fire and forget - kick off immediately, don't await
    processImmediately(runnerUps, servingContext).catch(err => {
        logger.error('deferred_hydration.fire_and_forget_failed', {
            error: (err as Error).message,
        });
    });
}

/**
 * Process candidates immediately in background.
 * Called by queueForDeferredHydration - not awaited.
 */
async function processImmediately(
    candidates: UnifiedCandidate[],
    servingContext?: ServingContext
): Promise<void> {
    const { hydrateSingleCandidate } = await import('./hydrate-cache');
    const { backfillCommonServings } = await import('./serving-backfill');
    const client = new FatSecretClient();

    // Process all candidates in parallel
    await Promise.allSettled(
        candidates.map(async (candidate) => {
            try {
                // 1. Hydrate to cache
                await hydrateSingleCandidate(candidate, client);

                // 2. Backfill common servings (only if enabled via env var)
                // Set ENABLE_PREEMPTIVE_BACKFILL=true to pre-fill serving options
                // Default: disabled for faster pilot imports focused on accuracy
                if (process.env.ENABLE_PREEMPTIVE_BACKFILL === 'true') {
                    await backfillCommonServings(
                        candidate.id,
                        candidate.name,
                        servingContext?.unit
                    );
                }
            } catch (err) {
                logger.debug('deferred_hydration.candidate_failed', {
                    candidateId: candidate.id,
                    error: (err as Error).message,
                });
            }
        })
    );

    logger.debug('deferred_hydration.fire_and_forget_complete', {
        count: candidates.length,
    });
}

/**
 * Get current queue size.
 */
export function getQueueSize(): number {
    return hydrationQueue.length;
}

/**
 * Clear the queue (useful for testing).
 */
export function clearQueue(): void {
    hydrationQueue = [];
}

// ============================================================
// Queue Processing
// ============================================================

const defaultClient = new FatSecretClient();

/**
 * Process the deferred hydration queue.
 * Called after batch mapping completes.
 * Parallelizes hydration and serving backfill for speed.
 * 
 * @param batchSize - Number of candidates to process at once
 * @param client - FatSecret client for hydration
 */
export async function processDeferredQueue(
    batchSize: number = 50,
    client: FatSecretClient = defaultClient
): Promise<{ processed: number; remaining: number }> {
    if (isProcessingQueue) {
        logger.debug('deferred_hydration.already_processing');
        return { processed: 0, remaining: hydrationQueue.length };
    }

    if (hydrationQueue.length === 0) {
        return { processed: 0, remaining: 0 };
    }

    isProcessingQueue = true;
    let processed = 0;

    try {
        // Import functions dynamically to avoid circular deps
        const { hydrateSingleCandidate } = await import('./hydrate-cache');

        // Take batch from front of queue
        const batch = hydrationQueue.splice(0, batchSize);

        logger.info('deferred_hydration.processing_batch', {
            batchSize: batch.length,
            remainingInQueue: hydrationQueue.length,
        });

        // Process batch in PARALLEL with Promise.allSettled
        const results = await Promise.allSettled(
            batch.map(async (item) => {
                // 1. Hydrate the candidate to cache
                await hydrateSingleCandidate(item.candidate, client);

                // 2. Backfill common servings based on food type
                const { backfillCommonServings } = await import('./serving-backfill');
                await backfillCommonServings(
                    item.candidate.id,
                    item.candidate.name,
                    item.servingContext?.unit
                );

                return 'success';
            })
        );

        processed = results.filter(r => r.status === 'fulfilled').length;
        const errors = results.filter(r => r.status === 'rejected').length;

        logger.info('deferred_hydration.batch_complete', {
            processed,
            errors,
            remainingInQueue: hydrationQueue.length,
        });
    } catch (err) {
        logger.error('deferred_hydration.batch_failed', {
            error: (err as Error).message,
        });
    } finally {
        isProcessingQueue = false;
    }

    return { processed, remaining: hydrationQueue.length };
}

/**
 * Process entire queue until empty.
 * Use after all mappings complete.
 */
export async function drainQueue(
    batchSize: number = 50,
    client: FatSecretClient = defaultClient
): Promise<{ totalProcessed: number }> {
    let totalProcessed = 0;

    logger.info('deferred_hydration.drain_start', {
        queueSize: hydrationQueue.length,
    });

    while (hydrationQueue.length > 0) {
        const result = await processDeferredQueue(batchSize, client);
        totalProcessed += result.processed;

        // Small delay between batches to not overwhelm APIs
        if (hydrationQueue.length > 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    logger.info('deferred_hydration.drain_complete', {
        totalProcessed,
    });

    return { totalProcessed };
}
