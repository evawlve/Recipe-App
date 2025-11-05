/**
 * Prisma Sentry Middleware
 * 
 * Automatically wraps all Prisma queries in Sentry performance spans to track
 * database query performance and errors.
 * 
 * Features:
 * - Creates spans for every Prisma operation with model and action tags
 * - Tracks query duration in milliseconds
 * - Captures errors with context
 * - Supports rate limiting via SENTRY_DB_SPAN_SAMPLE (0-1, default: 1.0)
 * 
 * Usage:
 *   import { prisma } from '@/lib/db';
 *   // Middleware is automatically attached when prisma is created
 * 
 * Tuning:
 *   Set SENTRY_DB_SPAN_SAMPLE=0.1 in .env to sample 10% of queries in production
 *   Set SENTRY_DB_SPAN_SAMPLE=1.0 to capture all queries (default in dev)
 */

// Sentry disabled - can be re-enabled in the future
// import * as Sentry from "@sentry/nextjs";
import type { PrismaClient } from "@prisma/client";

// Guard flag to prevent double installation during HMR
const attachedInstances = new WeakSet<PrismaClient>();

/**
 * Attaches Sentry middleware to a Prisma client instance.
 * This must be called only once per client instance to avoid duplicate spans.
 * 
 * NOTE: Sentry is currently disabled - this is a no-op function
 */
export function attachPrismaSentry(prisma: PrismaClient): void {
  // Sentry disabled - function is now a no-op
  // All the original Sentry middleware code has been commented out below
  // Uncomment and restore the imports when re-enabling Sentry
  
  /* Original Sentry code (disabled):
  
  // Guard: Don't attach twice to the same instance
  if (attachedInstances.has(prisma)) {
    return;
  }

  // Guard: Only attach if Sentry is available
  if (typeof Sentry.startSpan !== "function") {
    return;
  }

  // Get sampling rate (0-1), default to 1.0 (100%)
  const sampleRate = (() => {
    const envValue = process.env.SENTRY_DB_SPAN_SAMPLE;
    if (!envValue) return 1.0;
    const parsed = Number.parseFloat(envValue);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 1) return 1.0;
    return parsed;
  })();

  // Mark this instance as attached
  attachedInstances.add(prisma);

  prisma.$use(async (params, next) => {
    // Apply rate limiting: skip span creation if we shouldn't sample this query
    if (sampleRate < 1.0 && Math.random() >= sampleRate) {
      return next(params);
    }

    const startTime = performance.now();
    const model = params.model ?? "unknown";
    const action = params.action;
    const spanName = `db.${model}.${action}`;

    try {
      return await Sentry.startSpan(
        {
          name: spanName,
          op: "db.prisma",
        },
        async (span) => {
          try {
            const result = await next(params);
            const duration = performance.now() - startTime;
            const durationMs = Math.round(duration * 100) / 100; // Round to 2 decimal places

            // Set tags on the span
            if (span) {
              span.setAttribute("db.model", model);
              span.setAttribute("db.action", action);
              span.setAttribute("db.duration_ms", durationMs);
            }

            return result;
          } catch (error) {
            const duration = performance.now() - startTime;
            const durationMs = Math.round(duration * 100) / 100;

            // Set error tags and context
            if (span) {
              span.setAttribute("db.error", true);
              span.setAttribute("db.duration_ms", durationMs);
            }

            // Set error context for Sentry
            if (error instanceof Error) {
              Sentry.setContext("db.error", {
                message: error.message,
                stack: error.stack,
                model,
                action,
              });
            }

            // Re-throw the error
            throw error;
          }
        }
      );
    } catch (error) {
      // Fallback: if Sentry.startSpan fails, just execute the query
      // This ensures queries still work even if Sentry has issues
      return next(params);
    }
  });
  */
}

