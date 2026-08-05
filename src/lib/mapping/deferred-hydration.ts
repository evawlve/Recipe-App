/**
 * Background hydration of runner-up candidates.
 *
 * There is NO QUEUE in this module. It once held an in-memory
 * `hydrationQueue` with `processDeferredQueue()`/`drainQueue()` batch
 * drainers, but nothing ever pushed to it — the queue had no producer and
 * was therefore unreachable in every code path. That machinery is deleted.
 *
 * What actually happens: `queueForDeferredHydration()` calls
 * `processImmediately()` fire-and-forget. The "queue"/"deferred" in that
 * name is a leftover from the removed design — DO NOT read it as evidence
 * that work is being buffered for later. The name is kept only because it
 * has live callers and test importers.
 *
 * Flow: hydrate the winner during mapping; hand the top 3 runner-ups to
 * `queueForDeferredHydration()`, which hydrates them immediately in the
 * background. Every fire-and-forget promise is tracked in
 * `pendingBackgroundTasks` so `drainPendingBackgroundTasks()` can await
 * them before `prisma.$disconnect()`.
 */

import { logger } from '../logger';
import type { UnifiedCandidate } from './gather-candidates';

// ============================================================
// Proactive Produce Backfill (for winner candidate)
// ============================================================

/**
 * Fire-and-forget backfill of small/medium/large servings for produce.
 * Called for the WINNER candidate after successful mapping.
 * Does NOT block the main mapping flow.
 * 
 * @param foodId - The food cache ID
 * @param foodName - The food name (for produce detection)
 */
export function proactiveProduceBackfill(foodId: string, foodName: string): void {
    // Fire and forget — but tracked so drainPendingBackgroundTasks() can await it
    const task = doProduceBackfill(foodId, foodName).catch(err => {
        logger.debug('proactive_produce_backfill.failed', {
            foodId,
            foodName,
            error: (err as Error).message,
        });
    });
    pendingBackgroundTasks.add(task);
    task.finally(() => pendingBackgroundTasks.delete(task));
}

async function doProduceBackfill(foodId: string, foodName: string): Promise<void> {
    const { isProduce, backfillCommonServings } = await import('./serving-backfill');

    if (!isProduce(foodName)) {
        return; // Not produce, skip
    }

    logger.info('proactive_produce_backfill.starting', {
        foodId,
        foodName,
    });

    // Backfill small/medium/large for produce
    const result = await backfillCommonServings(foodId, foodName);

    logger.info('proactive_produce_backfill.complete', {
        foodId,
        foodName,
        backfilled: result.backfilled,
        skipped: result.skipped,
    });
}

// ============================================================
// Background Task Tracking
// ============================================================

interface ServingContext {
    unit?: string;
    unitType: 'count' | 'volume' | 'weight';
}

// Tracks all background fire-and-forget promises so callers can await them
// before disconnecting Prisma (prevents stale-transaction errors).
const pendingBackgroundTasks = new Set<Promise<void>>();

/**
 * Await all in-flight background hydration and backfill tasks.
 * Call this before `prisma.$disconnect()` in scripts that trigger
 * `queueForDeferredHydration` or `proactiveProduceBackfill`.
 */
export async function drainPendingBackgroundTasks(): Promise<void> {
    if (pendingBackgroundTasks.size === 0) return;
    logger.debug('deferred_hydration.drain_pending', { count: pendingBackgroundTasks.size });
    await Promise.allSettled([...pendingBackgroundTasks]);
    pendingBackgroundTasks.clear();
}

/**
 * Register an external fire-and-forget promise with the drain set, the same
 * way this module's own tasks are tracked (e.g. the FatSecret lane's
 * persist writes). The promise MUST already have a .catch() attached —
 * registration does not add error handling.
 */
export function registerBackgroundTask(task: Promise<void>): void {
    pendingBackgroundTasks.add(task);
    task.finally(() => pendingBackgroundTasks.delete(task));
}

// ============================================================
// Runner-up Hydration
// ============================================================


/**
 * Fire-and-forget hydration for runner-up candidates.
 * Kicks off immediately when candidates are scored - does NOT block.
 * Hydrates candidates and backfills common servings in parallel.
 *
 * NAMING TRAP: nothing here is queued or deferred. This calls
 * `processImmediately()` right now; the name predates the removal of the
 * producer-less `hydrationQueue` and is retained only for its callers.
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

    // Fire and forget — but tracked so drainPendingBackgroundTasks() can await it
    const task = processImmediately(runnerUps, servingContext).catch(err => {
        logger.error('deferred_hydration.fire_and_forget_failed', {
            error: (err as Error).message,
        });
    });
    pendingBackgroundTasks.add(task);
    task.finally(() => pendingBackgroundTasks.delete(task));
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

    // Process all candidates in parallel
    await Promise.allSettled(
        candidates.map(async (candidate) => {
            try {
                // 1. Hydrate to cache
                await hydrateSingleCandidate(candidate);

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

