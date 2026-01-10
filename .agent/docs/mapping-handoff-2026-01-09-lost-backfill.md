# Mapping Handoff: Lost AI Backfill Feature

**Date**: 2026-01-09  
**Issue**: "1 container low fat yogurt" fails with "No mapping found"

## Problem Summary

During the quinoa race condition fix, a `git restore` was used to reset `map-ingredient-with-fallback.ts` to a clean state. This inadvertently lost the **AI backfill integration** for ambiguous units like "container", "bag", "box", etc.

The staged version of the file contained backfill code that is now missing from the working version.

## What Was Lost

### Missing Imports (in staged, not in working)
```typescript
import { insertAiServing } from './ai-backfill';
import { backfillOnDemand } from './serving-backfill';
import { isSizeQualifier, getOrCreateFdcSizeServings } from '../usda/fdc-ai-backfill';
```

### Missing Backfill Logic
The staged version had extensive backfill integration in the `hydrateAndSelectServing` function:

1. **Weight-based backfill** - Try AI backfill when no usable serving found
2. **Volume backfill** - Fallback for volume-based servings
3. **On-demand backfill** - For count/volume unit types
4. **Unitless backfill** - For ingredients without units (e.g., "1 apple")

## Existing Backfill Files (Still Present)

These files exist and contain the backfill logic, they just need to be integrated:

- `src/lib/fatsecret/ai-backfill.ts` - `insertAiServing` function
- `src/lib/fatsecret/serving-backfill.ts` - `backfillOnDemand` function
- `src/lib/fatsecret/ambiguous-unit-backfill.ts` - Ambiguous unit handling
- `src/lib/ai/ambiguous-serving-estimator.ts` - AI estimation for containers, bags, etc.

## Recovery Options

### Option 1: Restore from Staged (Recommended)
The staged version has a complete implementation. Use git to get the relevant sections:
```bash
git show :src/lib/fatsecret/map-ingredient-with-fallback.ts | grep -A 50 "backfill"
```

### Option 2: Merge Staged with Current Working
```bash
# Create a backup of current working file (with quinoa fix)
cp src/lib/fatsecret/map-ingredient-with-fallback.ts src/lib/fatsecret/map-ingredient-with-fallback.ts.working

# View staged version
git show :src/lib/fatsecret/map-ingredient-with-fallback.ts > staged-version.ts

# Manually merge the backfill sections from staged-version.ts into the working file
```

## Test Case

After restoration, run:
```bash
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/debug-mapping-issue.ts "1 container low fat yogurt"
```

**Expected**: Should map to "Low Fat Yogurt" with estimated grams for "container"

## Related Conversation
- Conversation where ambiguous unit backfill was implemented: `7a07a034-8ad9-4c6e-8534-17813ac76e45` (Implement Ambiguous Unit Backfill)

## Current File Stats
- **Staged version**: 1575 lines (has backfill)
- **Current working**: 1629 lines (has quinoa lock fix, missing backfill)
- **Both features needed**: ~1700-1800 lines estimated
