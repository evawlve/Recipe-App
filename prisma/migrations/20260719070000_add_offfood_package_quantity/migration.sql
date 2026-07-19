-- OFF product_quantity backfill target (Cluster A pt2 Defect 3, Jul 2026).
-- Net package quantity per barcode ("591 ml" Gatorade bottle, "92 g" chip bag)
-- from OFF's quantity/product_quantity fields, which the ingest previously
-- discarded. Populated by scripts/backfill-off-package-quantity.ts from the
-- OFF CSV export; future ingests may set it directly.
ALTER TABLE "OffFood" ADD COLUMN "packageQuantity" DOUBLE PRECISION;
ALTER TABLE "OffFood" ADD COLUMN "packageQuantityUnit" TEXT;
