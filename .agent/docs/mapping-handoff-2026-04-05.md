# Mapping Pipeline Handoff (April 5, 2026)

## Current Status
We have successfully deployed a final series of systemic heuristics and deployed a new **500-recipe pilot batch import** to validate the pipeline.

### Deployed Fixes Prior to Import:
1. **Context-Aware Semantic Rewrites:**
   - `"bouillon"` rewrites to `"broth"` when volumetrically quantified.
   - `"corn"` rewrites to `"sweet corn"` when unit is `"can"`.
2. **Discrete Produce Tracking:** `selectServing` now intercepts unitless items flagged by `isDiscreteItem` and assigns them the `"piece"` unit so they pass into the count-based serving backfill rather than defaulting to `1g`.
3. **Cache Fixes:** Patched `earlyCacheHit` to respect the `--skip-cache` argument to ensure test scripts don't pull poisoned cache anomalies. We specifically cleared prior ValidatedMappings for `"mint"`, `"pancake mix"`, `"bouillon"`, etc., prior to this import.

The pilot batch import successfully concluded, creating:
- Raw Log: `logs/mapping-summary-2026-04-05T21-39-37.txt`
- Grouped Log: `logs/grouped-mapping-summary-2026-04-05T21-39-37.txt`

---

## Next Agent: Action Items & How to Proceed

Your primary directive is to review the newly emitted grouped summary to verify our previous fixes held and catch any remaining boundary anomalies. 

### 1. Execute the Grouped Audit
Open `logs/grouped-mapping-summary-2026-04-05T21-39-37.txt` and review the outputs semantic chunk by chunk. Follow the `/mapping-audit-review` workflow outlined in `AGENTS.md`. 

### 2. Immediate Diagnostic Targets
When scanning the file, look explicitly for:
- **Produce/Meat Weight Drops:** Keep an eye out for extreme weight drops in discrete items (e.g., `chicken breast` or `eggs` mapping to `1g` or `2g` instead of ~150g or ~50g). While scanning the log, there was a brief glimpse of `"1  breast bone and skin removed chicken breast" | (2kcal/1g)`. The new `"piece"` unit injection in `selectServing` might be getting overridden later in the pipeline or FDC might be serving strange defaults for poultry.
- **FDC Caloric Bloat:** Items jumping astronomically due to trailing characters in the parser. 

### 3. Debugging Protocol
If you identify an anomaly:
1. Do **NOT** run another 500-recipe pilot import to verify a single fix. 
2. Use `tmp/debug.ts` to execute the pipeline directly on the broken ingredient string (ensure `skipCache: true` is set, which now works correctly thanks to Fix 82).
3. Trace the output. Is it failing in the Filter phase? The Parsing phase? The Heuristic Serving phase?
4. Fix the pipeline (usually in `filter-candidates.ts`, `normalization-rules.ts`, or `map-ingredient-with-fallback.ts`).
5. Re-run `tmp/debug.ts` to confirm the fix.
6. Clear the cache for the individual term using `npx tsx scripts/clear-ingredient-cache.ts "problem-word"`.
7. Once verified, log the fix chronologically in `docs/mapping-fix-log.md`. 

Proceed directly to scanning the grouped summary and documenting your findings in a `mapping_audit_results.md` artifact!
