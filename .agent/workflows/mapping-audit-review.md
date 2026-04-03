---
description: How to conduct a line-by-line ingredient mapping audit using the grouped summary script
---

## Mapping Audit Review Workflow

Use this workflow whenever a new `mapping-summary-*.txt` log is generated and you need to review it for nutritional anomalies, incorrect matches, and pipeline failures.

### Step 1: Generate the grouped summary

```bash
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/group-mapping-summary.ts logs/<log-file-name>.txt
```

This produces `logs/grouped-<log-file-name>.txt`, grouping all mapping events by their resolved food target. This reduces 13k+ lines to ~800 semantic groups.

### Step 2: Read the file chunk-by-chunk (800 lines at a time)

Read the grouped file in chunks using `view_file` with `StartLine` and `EndLine`. Review each chunk for:

- **Semantic inversions**: e.g., `apple pie spice` resolving to `apple chips`
- **Category mismatches**: e.g., `hamburger buns` resolving to `saltine crackers`
- **Extreme weight bloat**: entries with very large grams relative to the quantity (especially for herbs, sprays, drops, packets)
- **Fat modifier mismatches**: `extra light` mapping to `fat free` products
- **Package vs serving confusion**: `1 packet sweetener` should be ~1g, not 100g
- **Branded product drift**: simple ingredients resolving to brand-named complex products (e.g., "filet mignon wrapped in bacon")
- **Bare query failures**: ingredient with no unit resolving to entire-package weight (thousands of grams)

### Step 3: Document findings in an audit report

Write findings to a `mapping_audit_results.md` artifact, grouped by category:

1. **Complex Product Misidentifications**
2. **Serving Size & Heuristic Anomalies**
3. **Fat Modifier Mismatches**
4. **Unit Parsing Failures**
5. **Category Mismatches**

For each finding, record:
- The raw query string
- The resolved mapped food
- The resolved weight/calories
- The expected correct behavior

### Step 4: Transition to planning

After the audit, create a new implementation_plan.md (if changes are needed) to address the systemic failures. Reference the specific files to modify:
- `src/lib/fatsecret/normalization-rules.ts` — synonym rewrites
- `src/lib/parse/unit.ts` — micro-unit types (drop, second)
- `src/lib/units/unit-graph.ts` — ml equivalents for new units
- `src/lib/servings/default-count-grams.ts` — gram seed data for new units
- `src/lib/ai/ambiguous-serving-estimator.ts` — packet routing fix
- `src/lib/fatsecret/filter-candidates.ts` — negative category filters

### Notes

- Always skip re-reading lines already reviewed in a prior session — the context checkpoint captures the last line reviewed.
- Do NOT rely solely on automated scripts to identify issues; automated filters miss subtle semantic inversions. The chunk-by-chunk human review is essential.
- After fixes, always re-run the grouped summary and spot-check the problem groups manually.
