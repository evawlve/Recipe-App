/**
 * Mapping funnel taxonomy (sprint F1, Jul 2026).
 *
 * Every ingredient line that enters the mapper ends in exactly one FunnelStage.
 * Until now only the two cache outcomes were observable — in particular a pick
 * with 0.3 <= confidence < 0.85 served the user and was silently never offered
 * to the cache, with no log line at all. That "under_gate" population is the
 * bulk of what cache-warming exists to convert, and it was only reconstructable
 * after the fact by SQL inference (src/lib/ops/stuck-keys.ts).
 *
 * These types carry no runtime dependencies on the mapper so that both
 * map-ingredient-with-fallback.ts (which owns MappingTelemetry) and
 * validated-mapping-helpers.ts (which owns the save gates) can import them
 * without a cycle.
 */

/**
 * Coarse funnel bucket: where the line ended up. Exactly one is set per line.
 */
export type FunnelStage =
    /** A FoodMapping row served the line (early or normalized cache layer). */
    | 'cache_hit'
    /** Fresh pick cleared the >=0.85 save gate and was written to the cache. */
    | 'saved'
    /** 0.3 <= confidence < 0.85: served to the user, never offered to the cache. */
    | 'under_gate'
    /** confidence >= 0.85 but a save gate blocked the write. */
    | 'save_rejected'
    /** Best pick scored below MIN_ACCEPTABLE_CONFIDENCE -> null. */
    | 'no_match'
    /** Retrieval returned nothing at all — a dataset gap, not a ranking gap. */
    | 'no_candidates'
    /** Candidates existed but every one was dropped before ranking. */
    | 'all_filtered'
    /** Zero-calorie short-circuit (water/ice) — never consults the corpus. */
    | 'fast_path'
    /** The mapper threw. */
    | 'error';

/**
 * The funnel-writable slice of MappingTelemetry. The save path takes this
 * rather than the full telemetry object: it has no business touching
 * cacheHit/normalizedForm, and depending on the narrow shape keeps
 * validated-mapping-helpers.ts free of an import cycle back into the mapper.
 */
export interface FunnelSink {
    funnelStage?: FunnelStage;
    dropReason?: string;
}

/**
 * Downgrade an optimistically-'saved' line to 'save_rejected' with the class ID
 * of whichever gate blocked the write.
 */
export function markSaveRejected(sink: FunnelSink | undefined, classId: string): void {
    if (!sink) return;
    sink.funnelStage = 'save_rejected';
    sink.dropReason = funnelReason('save_rejected', classId);
}

/** Confidence at/above which a fresh pick is offered to the validated cache. */
export const SAVE_GATE_CONFIDENCE = 0.85;

/** Confidence below which a pick is rejected outright as a garbage match. */
export const MIN_ACCEPTABLE_CONFIDENCE = 0.3;

/**
 * Collapse a raw reason string into a stable, low-cardinality class token.
 *
 * The vocabularies we reuse were built for human-readable logs, not for
 * GROUP BY: macro-plausibility interpolates live measurements into its reason
 * IDs (`atwater:kcal_412_exceeds_computed_388.5`), confidenceGate parenthesizes
 * thresholds (`confidence_below_threshold(0.42)`), and selectionReason can
 * carry free-form AI rationale (`fallback_simplified: <sentence>`). Stored raw,
 * dropReason would be near-unique per row and useless as a class label.
 *
 * So each colon-separated segment is: cut at the first '(' , stripped of
 * embedded numbers, lowercased, reduced to [a-z0-9_], and length-capped. That
 * turns the examples above into `atwater:kcal_exceeds_computed`,
 * `confidence_below_threshold` and `fallback_simplified` — the detail suffix
 * Diego asked to keep, without the unbounded tail.
 */
export function normalizeClassId(
    raw: string | null | undefined,
    opts?: { maxSegments?: number },
): string {
    const maxSegments = opts?.maxSegments ?? 3;
    if (!raw) return 'unknown';

    const segments = String(raw)
        .split(':')
        .map(segment => segment
            // Drop parenthesized detail: "confidence_below_threshold(0.42)".
            .split('(')[0]
            .toLowerCase()
            // Strip interpolated measurements, keeping the surrounding words:
            // "kcal_412_exceeds_computed_388.5" -> "kcal_exceeds_computed".
            .replace(/\d+(?:\.\d+)?/g, ' ')
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 40)
            .replace(/_+$/g, ''))
        .filter(Boolean)
        .slice(0, maxSegments);

    return segments.length > 0 ? segments.join(':') : 'unknown';
}

/**
 * Build a namespaced drop reason: `"<stage>:<class>[:<detail>]"`.
 *
 * `classId` may itself be colon-separated (macro-plausibility reasons already
 * are); it is normalized as a path so the stage prefix is never duplicated.
 */
export function funnelReason(stage: FunnelStage, classId?: string | null): string {
    return `${stage}:${normalizeClassId(classId)}`;
}
