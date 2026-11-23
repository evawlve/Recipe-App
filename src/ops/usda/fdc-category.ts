/**
 * fdc-category.ts — USDA's own food category off a raw FDC row.
 *
 * Pure, no I/O: scripts/usda-saturate.ts and scripts/sync-typesense.ts run main()
 * on import, so anything a test needs lives here instead.
 *
 * The bulk dumps carry `foodCategory` as an object `{ description }`; the FDC
 * search API returns it as a plain string. Reading it with a template literal
 * gives "[object Object]" on a dump row, which is why this helper exists.
 */
export function fdcCategoryOf(row: unknown): string | null {
    if (!row || typeof row !== 'object') return null;
    const c = (row as { foodCategory?: unknown }).foodCategory;
    let s: unknown = c;
    if (c && typeof c === 'object') s = (c as { description?: unknown }).description;
    if (typeof s !== 'string') return null;
    const t = s.trim();
    return t === '' ? null : t;
}

/** fdcId → category for every dump row that carries one, sorted by fdcId. Pure. */
export function buildCategoryMap(rows: unknown[]): Record<string, string> {
    const pairs: Array<[number, string]> = [];
    for (const r of rows) {
        const id = (r as { fdcId?: unknown } | null)?.fdcId;
        const cat = fdcCategoryOf(r);
        if (typeof id === 'number' && cat) pairs.push([id, cat]);
    }
    pairs.sort((a, b) => a[0] - b[0]);
    const out: Record<string, string> = {};
    for (const [id, cat] of pairs) out[String(id)] = cat;
    return out;
}

/**
 * USDA categories the /api/foods/search produce hoist (rule 1) may lift to the top.
 * A bagel "includes onion" and covers the token, but USDA files it under Baked Products.
 */
export const PRODUCE_HOIST_CATEGORIES: readonly string[] = [
    'Vegetables and Vegetable Products',
    'Fruits and Fruit Juices',
    'Spices and Herbs',
];

export function isProduceHoistCategory(cat: unknown): boolean {
    return typeof cat === 'string' && PRODUCE_HOIST_CATEGORIES.includes(cat);
}
