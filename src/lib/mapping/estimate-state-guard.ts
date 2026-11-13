/**
 * A cached nutrition estimate can describe a DIFFERENT COOKING STATE than the
 * line asking for it (C6970 s400, 2026-10-30; defect measured in s395 Q1).
 *
 * AiNormalizeCache is keyed by computeNormalizedKey(), which drops `cooked`
 * (`cooked oats` -> key `rolled oats`). So an explicit-cooked line reads the row
 * a BARE line minted: key `rolled oats`, minted by `oatmeal`, 389 kcal/100 g, a
 * dry panel. Adopted at the mapper's normalize-gate-skip replay, that estimate
 * sinks every cooked candidate by ~0.28 in simpleRerank() (0.737 -> 0.596, a
 * decline) and vetoes the save at the save-time plausibility gate (73 vs 389).
 *
 * cookingModifier cannot tell us the row's state: it is NULL on ~97% of live
 * rows, including the CORRECT `rice` 130 kcal row that `1 cup cooked rice` reads.
 * The panel itself can. No cooked grain, legume, pasta or porridge reaches
 * 280 kcal/100 g (golden n-cook-01..06 kcal100 bands sit inside 45-170), while
 * every measured dry grain row is 350-390. So the predicate is TRUE only when ALL hold:
 *   (i)   the line is explicit-cooked, never the soft volume-grain class
 *         (`1 cup oats` keeps its row: that is the separate bare-oatmeal class);
 *   (ii)  the raw line names no dry state (`uncooked` sets preferCooked by
 *         substring in detectGrainCookingContext());
 *   (iii) isExplicitCookedGrainVolumeLine() (#621): head noun in
 *         VOLUME_COOKED_GRAINS, an eaten-portion volume unit, no dry signal;
 *   (iv)  the estimate is a dry panel (>= DRY_GRAIN_PANEL_MIN_KCAL_PER_100G).
 *
 * When true, the caller skips ONLY the estimate; the row's canonicalBase is
 * still replayed, because identity does not depend on cooking state.
 */
import { isExplicitCookedGrainVolumeLine } from './filter-candidates';

/** Lowest kcal/100 g read as a DRY grain panel. */
export const DRY_GRAIN_PANEL_MIN_KCAL_PER_100G = 280;

const RAW_LINE_DRY_WORD_RE = /\b(uncooked|raw|dry|dried)\b/i;

export function dryEstimateOnCookedGrainLine(
    ctx: { preferCooked: boolean; preferDry: boolean; softCooked?: boolean },
    rawLine: string,
    normalizedName: string,
    estimate: { caloriesPer100g: number } | null | undefined,
): boolean {
    if (!estimate) return false;
    if (!ctx.preferCooked || ctx.preferDry || ctx.softCooked === true) return false;
    if (RAW_LINE_DRY_WORD_RE.test(rawLine)) return false;
    if (!isExplicitCookedGrainVolumeLine(rawLine, normalizedName)) return false;
    return estimate.caloriesPer100g >= DRY_GRAIN_PANEL_MIN_KCAL_PER_100G;
}
