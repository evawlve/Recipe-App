-- Near-duplicate marking for OffFood: barcode of the surviving representative.
-- NULL means the row is itself a representative (or was never evaluated).
ALTER TABLE "OffFood" ADD COLUMN "duplicateOfBarcode" TEXT;

CREATE INDEX "OffFood_duplicateOfBarcode_idx" ON "OffFood"("duplicateOfBarcode");
