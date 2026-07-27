/**
 * fs-serving-macros.ts — THE reader for FatSecretServing.nutrients Json.
 *
 * Extracted verbatim from build-fatsecret-result.ts (2026-07-27) so that the
 * correctness screen and the production macro-only branch read serving-level
 * nutrition through the SAME function. The screen's first draft re-implemented
 * this reader (`Number(n.calories ?? n.kcal ?? NaN)`) and diverged on
 * string-typed Json values: `Number('') === 0` reads an empty string as a
 * genuine 0 kcal billing basis, while this reader's parseFloat returns NaN and
 * refuses it — playbook §11 class A (the instrument forks the system). Any
 * future caller that needs "what kcal does the FatSecret lane bill from this
 * nutrients Json" must import this, never re-derive it.
 *
 * PURE by design: no prisma, no logger, no config — importable by offline
 * eval tooling without dragging in a DB client.
 */

export interface Macros { kcal: number; protein: number; carbs: number; fat: number }

export function num(v: unknown): number | null {
    const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
    return Number.isFinite(n) ? n : null;
}

/**
 * Per-serving macros from a FatSecretServing.nutrients Json. The lane persists
 * the client's normalized field names (calories/protein/carbohydrate/fat);
 * accept kcal/carbs synonyms defensively — Json columns carry no schema.
 */
export function servingMacros(nutrients: Record<string, unknown> | null): Macros | null {
    if (!nutrients) return null;
    const kcal = num(nutrients['calories'] ?? nutrients['kcal']);
    if (kcal == null) return null;
    return {
        kcal,
        protein: num(nutrients['protein']) ?? 0,
        carbs: num(nutrients['carbohydrate'] ?? nutrients['carbs']) ?? 0,
        fat: num(nutrients['fat']) ?? 0,
    };
}
