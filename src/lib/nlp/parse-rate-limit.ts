import type { FunnelStage } from '@/lib/mapping/funnel';

/**
 * /api/nlp/parse per-user rate limits — bearer callers only. The dev key and the
 * email allowlist in the route are exempt, and that exemption lives in the route.
 *
 * RESERVE, THEN REFUND (review H2, 2026-09-24 — it replaced count-then-charge, under which
 * N parallel requests all read the same count below the limit and all did paid work):
 *  - RESERVE (route, after the body is validated and bounded, before any paid work): one
 *    interactive transaction takes `pg_advisory_xact_lock(hashtext(userId))`, counts the
 *    minute and day windows, and — only if both are under the limit — writes this
 *    request's NlpRequestLog row. The lock serialises ONE user's concurrent reservations,
 *    so the second sees the first's committed row. `hashtext` is 32-bit, so two users can
 *    share a lock: over-serialisation of a millisecond transaction, never a wrong count.
 *  - REFUND (route, at the two places a run ends: the one-shot callback / catch, and the
 *    stream's then / catch): the reserved row is deleted when the request did no paid work
 *    (`isFreeParseRequest()`), or when the mapper threw. A request whose every line was
 *    answered from the FoodMapping cache or the zero-calorie fast path, and whose split
 *    needed no AI segmentation call, cost nothing — so it is refunded, and a user
 *    re-logging yesterday's breakfast does not spend today's allowance on it.
 *  - IN FLIGHT: at most MAX_INFLIGHT_PER_USER runs per user at once, refused before any
 *    DB call. PER PROCESS — exact on the box, which runs one; a multi-instance deployment
 *    would multiply it.
 *  - DB ERRORS: an isolated reservation error fails open (logged); after
 *    RESERVATION_FAILURES_BEFORE_FAIL_CLOSED consecutive errors the route answers 503 until
 *    a reservation succeeds. A transaction timeout (P2028) is a 429, not an error.
 *
 * The limits are read PER REQUEST from the env, each as a literal dotted member read
 * (CI's env-parity check scans for that spelling), so the box can retune them with
 * an edit + restart and no rebuild. Same fail-closed parsing as
 * `parseMappingAnalysisTopN()` in src/lib/mapping/config.ts: anything that is not a
 * positive integer — '', 'abc', '0', '-5', '1.5', '5x' — falls back to the default.
 */
export const NLP_PARSE_LIMIT_PER_MINUTE_DEFAULT = 10;
export const NLP_PARSE_LIMIT_PER_DAY_DEFAULT = 100;

export function parseLimitEnv(raw: string | undefined | null, fallback: number): number {
  if (raw == null) return fallback;
  const trimmed = raw.trim();
  if (!/^[0-9]+$/.test(trimmed)) return fallback;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export interface ParseLimits {
  perMinute: number;
  perDay: number;
}

/** Read per request, never cached at module scope — see the header. */
export function readParseLimits(): ParseLimits {
  return {
    perMinute: parseLimitEnv(process.env.NLP_PARSE_LIMIT_PER_MINUTE, NLP_PARSE_LIMIT_PER_MINUTE_DEFAULT),
    perDay: parseLimitEnv(process.env.NLP_PARSE_LIMIT_PER_DAY, NLP_PARSE_LIMIT_PER_DAY_DEFAULT),
  };
}

/**
 * Funnel stages that cost nothing: a FoodMapping row served the line, or the
 * water/ice short-circuit never consulted the corpus. Every other stage — `saved`,
 * `under_gate`, `save_rejected`, `no_match`, `no_candidates`, `all_filtered`,
 * `error` — means retrieval (and possibly a model) ran.
 */
export const FREE_FUNNEL_STAGES: ReadonlySet<FunnelStage> = new Set<FunnelStage>(['cache_hit', 'fast_path']);

export interface FreeParseInput {
  /** One entry per response item: its `funnelStage`, or null/undefined when the mapper never classified it. */
  funnelStages: ReadonlyArray<string | null | undefined>;
  /** true = split served from SegmentationCache, false = AI segmentation ran, null = never reached it. */
  segCacheHit: boolean | null;
}

/**
 * True when the request did no paid work: every line's stage is in FREE_FUNNEL_STAGES
 * AND the split was not an AI segmentation call. An empty request is free. A line
 * with NO stage is NOT free — unclassified means "we do not know what it cost", and
 * the honest side of that is to charge.
 */
export function isFreeParseRequest(input: FreeParseInput): boolean {
  if (input.segCacheHit === false) return false;
  return input.funnelStages.every(
    stage => stage != null && (FREE_FUNNEL_STAGES as ReadonlySet<string>).has(stage),
  );
}

// ============================================================
// In-flight cap and the reservation-error breaker. Module state: it survives
// `jest.clearAllMocks()`, hence `_resetInflightForTests()`.
// ============================================================

/** Concurrent parse runs one user may have open in this process. */
export const MAX_INFLIGHT_PER_USER = 2;

const inflightByUser = new Map<string, number>();

/** Take a slot for `userId`. false = already at MAX_INFLIGHT_PER_USER; nothing was taken. */
export function acquireInflight(userId: string): boolean {
  const held = inflightByUser.get(userId) ?? 0;
  if (held >= MAX_INFLIGHT_PER_USER) return false;
  inflightByUser.set(userId, held + 1);
  return true;
}

/** Give one slot back. Never goes below zero, so a double release cannot mint a slot. */
export function releaseInflight(userId: string): void {
  const held = inflightByUser.get(userId) ?? 0;
  if (held <= 1) inflightByUser.delete(userId);
  else inflightByUser.set(userId, held - 1);
}

export function inflightCount(userId: string): number {
  return inflightByUser.get(userId) ?? 0;
}

/** Isolated reservation errors fail open; one past this many in a row fails closed (503). */
export const RESERVATION_FAILURES_BEFORE_FAIL_CLOSED = 3;

let consecutiveReservationFailures = 0;

/** Count one reservation error; returns the run length including it. */
export function recordReservationFailure(): number {
  consecutiveReservationFailures += 1;
  return consecutiveReservationFailures;
}

/** Any successful reservation (over the limit or not) ends the run. */
export function recordReservationSuccess(): void {
  consecutiveReservationFailures = 0;
}

/** true once the run of consecutive errors is PAST the allowance: the 4th error is the first 503. */
export function reservationFailsClosed(consecutiveFailures: number): boolean {
  return consecutiveFailures > RESERVATION_FAILURES_BEFORE_FAIL_CLOSED;
}

/**
 * Prisma's interactive-transaction error (P2028): `maxWait` passed before a connection was
 * free, or `timeout` passed while the transaction held one — here, waiting on the user's
 * advisory lock behind their own concurrent reservations. Answered as a 429, and not
 * counted toward the breaker.
 */
export function isReservationTimeout(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: unknown }).code === 'P2028';
}

/** Interactive-transaction bounds, explicit rather than Prisma's implicit defaults. */
export const RESERVATION_TX_MAX_WAIT_MS = 2000;
export const RESERVATION_TX_TIMEOUT_MS = 5000;

/** Tests only: clear the in-flight map and the breaker. */
export function _resetInflightForTests(): void {
  inflightByUser.clear();
  consecutiveReservationFailures = 0;
}
