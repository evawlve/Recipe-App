-- Funnel taxonomy columns on MappingEventLog (sprint F1, Jul 2026).
-- Additive and nullable: existing rows keep NULL, which reads as "logged before
-- the funnel existed" rather than as a stage.
--
-- funnelStage is the coarse bucket a line ended in (cache_hit | saved |
-- under_gate | save_rejected | no_match | no_candidates | all_filtered |
-- fast_path | error). The one that motivated this sprint is 'under_gate':
-- 0.3 <= confidence < 0.85, where the pick serves the user but is never offered
-- to the validated cache — previously invisible, and exactly the population that
-- cache-warming exists to convert.
--
-- dropReason is the fine-grained class ID, '<stage>:<class>[:<detail>]'. It is
-- normalized (interpolated measurements stripped) by src/lib/mapping/funnel.ts so
-- it stays low-cardinality and groups cleanly.

ALTER TABLE "MappingEventLog" ADD COLUMN "funnelStage" TEXT;
ALTER TABLE "MappingEventLog" ADD COLUMN "dropReason" TEXT;

CREATE INDEX "MappingEventLog_funnelStage_idx" ON "MappingEventLog"("funnelStage");
CREATE INDEX "MappingEventLog_dropReason_idx" ON "MappingEventLog"("dropReason");
