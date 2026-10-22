/**
 * Amount hedge reader: a LEADING `(a) (little) bit of <food>`.
 *
 * "a bit of onion" names no quantity, and `parseIngredientLine()` reads none
 * (qty stays 1, unit stays null), so the bare cascade bills a FULL serving of
 * the food. This reader only DETECTS the hedge; it never touches the parse, the
 * identity or the cache key. The mapper applies the fraction AFTER it has
 * picked a serving (see `mapIngredientWithFallback()` in
 * `mapping/map-ingredient-with-fallback.ts`).
 *
 * Pure, positional, no mapping import (parse imports nothing from mapping).
 * It declines (returns null) when the hedge is not the whole story:
 *  - the remainder has a digit (`a bit of 2 cups of rice`);
 *  - the hedge repeats (`a bit of a little bit of rice`);
 *  - the remainder parses its own quantity or unit (`a bit of a cup of rice`,
 *    `a bit of a dozen eggs`);
 *  - the remainder opens with a quantity word the parser leaves unread
 *    (`a bit of a few almonds`, `a bit of some rice`, `a little bit of a lot
 *    of cheese`): two hedges stacked through an unread quantity are not "a
 *    fraction of a serving".
 */
import { parseIngredientLine } from './ingredient-line';

/** The fraction of the picked serving a hedge bills. Diego's anchor: three user re-logs, all exactly half. */
export const AMOUNT_HEDGE_FRACTION = 0.5;

const HEDGE_RE = /^\s*(?:a\s+)?(?:little\s+)?bit\s+of\s+(?=\p{L})/iu;

/** Quantity words the parser leaves unread when they open the remainder. */
const UNREAD_QUANTITY_RE =
    /^(?:a\s+lot\s+of|lots\s+of|a\s+few|few|several|a\s+couple|couple|(?:a\s+)?pair\s+of|(?:a\s+)?(?:half|third|quarter)\s+of|more|some|each|both|all)\b/iu;

/** The fraction (0.5) when `line` opens with a clean amount hedge, else null. */
export function readLeadingAmountHedge(line: string): number | null {
    if (typeof line !== 'string') return null;
    const m = HEDGE_RE.exec(line);
    if (!m) return null;
    const rest = line.slice(m[0].length).trim();
    if (!rest || /\d/.test(rest)) return null;
    if (HEDGE_RE.test(rest)) return null;
    if (UNREAD_QUANTITY_RE.test(rest)) return null;
    const p = parseIngredientLine(rest) as
        | { qty?: number; multiplier?: number; unit?: unknown; unitHint?: unknown }
        | null;
    if (!p || p.qty !== 1 || p.multiplier !== 1 || p.unit != null || p.unitHint != null) return null;
    return AMOUNT_HEDGE_FRACTION;
}
