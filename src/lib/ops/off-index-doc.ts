/**
 * off-index-doc.ts — the ONE construction of an `off_foods` search document.
 *
 * Extracted from scripts/sync-typesense.ts so a targeted single-document
 * upsert and the full rebuild cannot drift apart. That drift is not
 * hypothetical here: the document carries `nutrientsPer100g` as a stored
 * string, so a row whose panel is repaired in Postgres keeps billing the OLD
 * panel off the search hit until its document is rewritten (mobile
 * sync-docs/CLAUDE.md, the FIFTH-population rule), and a hand-written upsert
 * that omitted `embedding` or `hasCountServing` would silently downgrade the
 * row instead — present, but no longer semantically searchable.
 *
 * `id` is the barcode, which is what makes an upsert idempotent: writing the
 * same document twice cannot create a duplicate, and a rebuild afterwards
 * produces the identical document.
 */

import { servingLabelHasPieceCount } from '../mapping/count-label';

/** The columns the index needs, exactly as they come off `OffFood`.
 *  `embedding` is pgvector's `'[f1,f2,...]'` text form — valid JSON — because
 *  the column is a Prisma `Unsupported("vector(384)")` and cannot be selected
 *  through the typed client. */
export interface OffIndexRow {
    barcode: string;
    name: string;
    brandName: string | null;
    nutrientsPer100g: unknown;
    servingGrams: number | null;
    servingSize: string | null;
    categories: string | null;
    embedding: string | null;
}

export function buildOffIndexDoc(f: OffIndexRow): Record<string, unknown> {
    const doc: Record<string, unknown> = {
        id: String(f.barcode), // key TS doc by barcode so upserts are idempotent (no duplicates)
        barcode: String(f.barcode),
        name: f.name,
        brandName: f.brandName || '',
        nutrientsPer100g: JSON.stringify(f.nutrientsPer100g || {}),
        servingGrams: f.servingGrams != null ? Number(f.servingGrams) : null,
        servingSize: f.servingSize || '',
        categories: f.categories || '',
        hasCountServing: servingLabelHasPieceCount(f.servingSize, f.servingGrams != null ? Number(f.servingGrams) : null),
    };
    if (f.embedding) {
        doc.embedding = JSON.parse(f.embedding) as number[];
    }
    return doc;
}

/** SELECT list the builder needs, so callers cannot forget a column. */
export const OFF_INDEX_DOC_COLUMNS = `barcode, name, "brandName", "nutrientsPer100g",
                   "servingGrams", "servingSize", categories,
                   embedding::text AS embedding`;
