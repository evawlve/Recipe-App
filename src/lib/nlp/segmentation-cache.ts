/**
 * segmentation-cache.ts — DB-backed cache of AI segmentation results.
 *
 * Biggest felt-latency lever on the magic-log path: an identical repeat line
 * ("2 eggs and toast for breakfast") used to re-pay the ~2-4s LLM split every
 * time; only the per-food mapping was cached. This module serves the split
 * from Postgres (SegmentationCache, keyed [lineKey, parserVersion]) in
 * single-digit ms instead.
 *
 * Contract (see route.ts caller):
 *   - Only lines that would hit the LLM consult this cache. The heuristic
 *     single-item fast path and item-form requests never touch it (no LLM
 *     cost to save there).
 *   - Only SUCCESSFUL, complete LLM segmentations are written. Heuristic
 *     fallback splits (LLM error/deadline) and empty/invalid parses are NEVER
 *     cached — a degraded result must not be replayed forever.
 *   - FAIL-OPEN everywhere: any cache read/write error logs a warning and the
 *     request proceeds exactly as a miss. The cache can never fail a request.
 *   - Invalidation is by version: bump SEG_PARSER_VERSION (ai-segmenter.ts)
 *     on any prompt/model/schema change; old-version rows are never read.
 *
 * TTL: sliding 30 days on lastUsedAt. Implemented as an opportunistic,
 * throttled deleteMany after write-throughs (at most once per
 * TTL_SWEEP_EVERY_N_WRITES writes per process) rather than a standalone cron —
 * consistent with the codebase's in-process opportunistic maintenance style
 * (cf. fire-and-forget telemetry, alias-cache refresh) and avoids another
 * systemd unit for a table this small. Misses only delay cleanup, never
 * correctness: stale rows for old parser versions are unreachable by design.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { SEG_PARSER_VERSION, SegmentedItem, isSegmentedItemArray } from './ai-segmenter';

export const SEG_CACHE_TTL_DAYS = 30;
export const TTL_SWEEP_EVERY_N_WRITES = 50;

/** Per-process write counter for the opportunistic TTL sweep throttle. */
let writesSinceSweep = 0;

/**
 * Look up a cached segmentation for a canonicalized line key under the
 * CURRENT parser version. On a hit, bumps hitCount/lastUsedAt fire-and-forget
 * (never blocks the request). Fail-open: any error → null (treated as miss).
 */
export async function lookupSegmentationCache(lineKey: string): Promise<SegmentedItem[] | null> {
  try {
    const row = await prisma.segmentationCache.findUnique({
      where: { lineKey_parserVersion: { lineKey, parserVersion: SEG_PARSER_VERSION } },
    });
    if (!row) return null;

    const segments: unknown = row.segmentsJson;
    if (!isSegmentedItemArray(segments)) {
      console.warn(`[seg-cache] malformed segmentsJson for key "${lineKey}" — treating as miss`);
      return null;
    }

    // Usage bump is fire-and-forget: a failed bump costs a stat, not a request.
    prisma.segmentationCache
      .update({
        where: { lineKey_parserVersion: { lineKey, parserVersion: SEG_PARSER_VERSION } },
        data: { hitCount: { increment: 1 }, lastUsedAt: new Date() },
      })
      .catch((err) => console.warn('[seg-cache] hit bump failed (non-fatal):', err));

    return segments;
  } catch (err) {
    console.warn('[seg-cache] lookup failed (fail-open, treating as miss):', err);
    return null;
  }
}

/**
 * Write-through after a SUCCESSFUL AI segmentation. Upsert so a concurrent
 * duplicate request (or a re-parse after a malformed-row miss) replaces
 * rather than conflicts. Fail-open: errors are logged and swallowed.
 */
export async function writeSegmentationCache(lineKey: string, segments: SegmentedItem[]): Promise<void> {
  try {
    const segmentsJson = segments as unknown as Prisma.InputJsonValue;
    await prisma.segmentationCache.upsert({
      where: { lineKey_parserVersion: { lineKey, parserVersion: SEG_PARSER_VERSION } },
      create: {
        lineKey,
        parserVersion: SEG_PARSER_VERSION,
        segmentsJson,
        lastUsedAt: new Date(),
      },
      update: { segmentsJson, lastUsedAt: new Date() },
    });
  } catch (err) {
    console.warn('[seg-cache] write-through failed (non-fatal):', err);
    return;
  }
  maybeSweepExpired();
}

/**
 * Opportunistic sliding-TTL sweep: at most once per TTL_SWEEP_EVERY_N_WRITES
 * successful write-throughs, delete rows idle for >SEG_CACHE_TTL_DAYS.
 * Fire-and-forget — never blocks or fails the triggering request.
 */
function maybeSweepExpired(): void {
  writesSinceSweep += 1;
  if (writesSinceSweep < TTL_SWEEP_EVERY_N_WRITES) return;
  writesSinceSweep = 0;

  const cutoff = new Date(Date.now() - SEG_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000);
  prisma.segmentationCache
    .deleteMany({ where: { lastUsedAt: { lt: cutoff } } })
    .then((res) => {
      if (res.count > 0) {
        console.log(`[seg-cache] TTL sweep deleted ${res.count} rows idle >${SEG_CACHE_TTL_DAYS}d`);
      }
    })
    .catch((err) => console.warn('[seg-cache] TTL sweep failed (non-fatal):', err));
}
