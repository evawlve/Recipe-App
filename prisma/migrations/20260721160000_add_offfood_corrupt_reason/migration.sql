-- Corrupt-record marking for OffFood (per-serving-panel-as-per-100g family and kin,
-- detected by scripts/eval/detect-corrupt-panel.ts, written by scripts/mark-corrupt-off.ts).
-- NULL means the row is clean or not yet evaluated. Non-null rows are excluded from the
-- Typesense sync (scripts/sync-typesense.ts) and the Postgres fallback search; direct
-- barcode lookups still resolve so existing references keep working.
-- Deliberately a separate column from "duplicateOfBarcode": dedupe-off-mark.ts clears and
-- recomputes that column on every run, so it can never carry corrupt marks.
ALTER TABLE "OffFood" ADD COLUMN "corruptReason" TEXT;
CREATE INDEX "OffFood_corruptReason_idx" ON "OffFood"("corruptReason");
