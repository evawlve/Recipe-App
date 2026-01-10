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

interface QueuedCandidate {
    candidate: UnifiedCandidate;
    priority: number; // Lower = higher priority
    queuedAt: number;
}

// In-memory queue (cleared on process restart)
let hydrationQueue: QueuedCandidate[] = [];
let isProcessingQueue = false;

// ============================================================
// Queue Management
// ============================================================

/**
 * Add candidates to the deferred hydration queue.
 * Higher-scored candidates get higher priority.
 * Queues top 3 runner-ups (excluding the winner) for manual mapping alternatives.
 */
export function queueForDeferredHydration(
    candidates: UnifiedCandidate[],
    excludeId?: string
): void {
    const now = Date.now();

    // Filter out the winner and take top 3 remaining (regardless of source)
    const runnerUps = candidates
        .filter(c => !excludeId || c.id !== excludeId)
        .slice(0, 3);  // Top 3 runner-ups total

    for (const candidate of runnerUps) {
        // Skip if already in queue
        if (hydrationQueue.some(q => q.candidate.id === candidate.id)) {
            continue;
        }

        hydrationQueue.push({
            candidate,
            priority: 1 - candidate.score, // Higher score = lower priority number = processed first
            queuedAt: now,
        });
    }

    // Sort by priority
    hydrationQueue.sort((a, b) => a.priority - b.priority);

    logger.debug('deferred_hydration.queued', {
        added: runnerUps.length,
        totalInQueue: hydrationQueue.length,
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
        // Import hydration functions dynamically to avoid circular deps
        const { hydrateAllCandidates } = await import('./hydrate-cache');

        // Take batch from front of queue
        const batch = hydrationQueue.splice(0, batchSize);
        const candidates = batch.map(q => q.candidate);

        logger.info('deferred_hydration.processing_batch', {
            batchSize: candidates.length,
            remainingInQueue: hydrationQueue.length,
        });

        // Hydrate the batch
        const result = await hydrateAllCandidates(candidates, client);
        processed = result.hydrated;

        logger.info('deferred_hydration.batch_complete', {
            hydrated: result.hydrated,
            skipped: result.skipped,
            errors: result.errors,
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
