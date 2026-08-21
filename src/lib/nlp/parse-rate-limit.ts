import type { FunnelStage } from '@/lib/mapping/funnel';

/**
 * /api/nlp/parse per-user rate limits — bearer callers only. The dev key and the
 * email allowlist in the route are exempt, and that exemption lives in the route.
 *
 * Two halves, deliberately split:
 *  - COUNT (route preamble, before the body is read): `>= perMinute` or `>= perDay`
 *    NlpRequestLog rows in the window is a 429.
 *  - CHARGE (end of the route's runParse(), after the mapper): one NlpRequestLog row,
 *    but ONLY for a request that did paid work. `isFreeParseRequest()` is that
 *    predicate. A request whose every line was answered from the FoodMapping cache
 *    or the zero-calorie fast path, and whose split needed no AI segmentation call,
 *    cost nothing — so it is not charged, and a user re-logging yesterday's
 *    breakfast does not spend today's allowance on it.
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
