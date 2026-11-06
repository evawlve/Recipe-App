import { prisma } from '@/lib/db';

/**
 * Candidate `OffFood.barcode` spellings for a scanned code, stored form first.
 * `OffFood.barcode` is the PK and holds US UPC-A codes ONLY in their 13-digit
 * form (`'0' + upc`), so a 12-digit scan must try the padded form before the
 * raw one. Not exported: callers use `findLocalOffBarcode()`.
 */
function barcodeForms(code: string): string[] {
  if (code.length === 12) return ['0' + code, code];
  if (code.length === 13 && code.startsWith('0')) return [code, code.slice(1)];
  return [code];
}

/**
 * Read the local Open Food Facts mirror for a scanned barcode, BEFORE any live
 * OFF call. Read-only: nothing here writes. Deliberately does NOT filter
 * `corruptReason` / `duplicateOfBarcode` — a direct barcode lookup serves the
 * row the scan named (see the OffFood schema comment).
 */
export async function findLocalOffBarcode(
  code: string,
): Promise<{ barcode: string; nutrientsPer100g: unknown } | null> {
  for (const barcode of barcodeForms(code)) {
    const row = await prisma.offFood.findUnique({
      where: { barcode },
      select: { barcode: true, nutrientsPer100g: true },
    });
    if (row) return row;
  }
  return null;
}
