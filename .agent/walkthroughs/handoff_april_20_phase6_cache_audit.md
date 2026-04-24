# Handoff: Cache Quality Audit & Pipeline Benchmarking

> **Date:** April 20, 2026  
> **Branch:** `feat/cache-quality-and-perf-benchmarks` (new)  
> **Prerequisite:** This branch is independent of `feat/uncertainty-resolution`. Both branch from `main`.

## Current State

- **ValidatedMapping entries:** **1,440**
- Pipeline stability: Phase 5 hardening complete (fat modifier CRITICAL constraint injected into AI nutrition backfill prompts)
- Latest pilot import: 841 recipes, mapping log at `logs/mapping-summary-2026-04-20T01-20-09.txt`

## Goals

1. **Audit** all 1,440 `ValidatedMapping` entries for poisoned/redundant/stale/semantically-inverted cache entries
2. **Benchmark** every discrete stage of the mapping pipeline across a diverse ingredient matrix
3. **Purge** confirmed bad entries and compact near-duplicate keys

## Detailed Spec

See the full spec in the artifact:  
`C:\Users\diega\.gemini\antigravity\brain\09633464-c1b1-4569-8198-557792572c84\handoff_cache_audit_and_benchmarks.md`

## Flags to Detect in Audit

| Flag            | Condition                                                       |
|-----------------|-----------------------------------------------------------------|
| `LOW_CONF`      | `aiConfidence < 0.75`                                           |
| `STALE`         | `lastUsedAt` > 60 days AND `usedCount < 5`                     |
| `DUPLICATE_KEY` | Multiple `normalizedForm` values → same `foodId`               |
| `SYNONYM_DRIFT` | ≤ 1 token overlap between `normalizedForm` and `foodName`      |
| `POSSIBLE_POISON` | High confidence (`≥ 0.9`) but `normalizedForm` not in `foodName` |

## Pipeline Stages to Benchmark

1. ValidatedMapping cache hit
2. AiNormalizeCache hit (DB vs live LLM)
3. Full cold pipeline (no cache)
4. Full pipeline + weight serving backfill
5. Full pipeline + ambiguous count backfill
6. AI nutrition backfill (no FatSecret match)
7. In-flight lock contention (5 parallel identical requests)
8. FDC fallback path
9. Early cache hit after lock release

## Key Files

- `src/lib/fatsecret/map-ingredient-with-fallback.ts` — pipeline orchestrator
- `src/lib/fatsecret/validated-mapping-helpers.ts` — cache lookup
- `src/lib/fatsecret/ai-normalize.ts` — LLM normalize with cache
- `src/lib/fatsecret/ai-nutrition-backfill.ts` — nutrition AI (updated April 20)
- `src/lib/fatsecret/serving-backfill.ts` — serving gap detection
