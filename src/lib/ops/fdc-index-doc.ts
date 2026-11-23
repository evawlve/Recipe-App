/**
 * fdc-index-doc.ts — the ONE construction of an `fdc_foods` search document.
 *
 * Pure so a test can import it; scripts/sync-typesense.ts runs main() on import.
 * `foodCategory` is USDA's own category (absent = empty string omitted, since the
 * schema field is optional).
 */
export interface FdcIndexRow {
    fdcId: number;
    description: string;
    brandName: string | null;
    dataType: string | null;
    foodCategory?: string | null;
    nutrientsPer100g: unknown;
    servings: Array<{ description: string; grams: number }>;
}

export function buildFdcIndexDoc(f: FdcIndexRow): Record<string, unknown> {
    const doc: Record<string, unknown> = {
        fdcId: String(f.fdcId),
        description: f.description,
        brandName: f.brandName || '',
        dataType: f.dataType || 'Generic',
        nutrientsPer100g: JSON.stringify(f.nutrientsPer100g),
        servings: JSON.stringify(f.servings.map(s => ({ description: s.description, grams: s.grams }))),
    };
    if (f.foodCategory) doc.foodCategory = f.foodCategory;
    return doc;
}
