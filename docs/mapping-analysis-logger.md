# Mapping Analysis Logger - Usage Guide

## Overview

The mapping analysis logger captures detailed decision-making data during ingredient mapping to help analyze and optimize the mapping pipeline.

## Features

- **Top 5 Candidates:** Shows all candidates considered with their scores and sources
- **Selection Reasoning:** Why each candidate was chosen
- **Serving Information:** Which serving was selected and if backfill was used
- **AI Validation:** Full AI approval/rejection details with reasons
- **JSON Export:** All data saved to timestamped JSON files in `logs/` directory

## Usage

### 1. Enable Logging

Set the environment variable before running your import:

```bash
# PowerShell
$env:ENABLE_MAPPING_ANALYSIS='true'

# Bash
export ENABLE_MAPPING_ANALYSIS=true
```

### 2. Run Your Import Script

```bash
npx ts-node scripts/your-import-script.ts
```

### 3. Initialize Session (if needed)

If your script doesn't auto-initialize, add:

```typescript
import { initMappingAnalysisSession, finalizeMappingAnalysisSession } from '../src/lib/fatsecret/mapping-logger';

// At start of script
initMappingAnalysisSession();

// ... your mapping code ...

// At end of script
finalizeMappingAnalysisSession();
```

## Output Format

### Console Output

```
📊 MAPPING: 0.5 cup almond flour
================================================================================
📝 Parsed: 0.5 cup almond flour

🏆 Top Candidates:
  1. [1.800] Almond Flour Meal (Hodgson Mill) [cache]
  2. [0.800] Almond Meal/Flour (Simple Truth) [cache]
  3. [0.767] Almond Meal Flour (Bob's Red Mill) [search]
  4. [0.700] Almonds [search]
  5. [0.567] Blanched Almond Flour (Kirkland) [cache]

✓ Selected: Almond Flour Meal (Hodgson Mill)
  Confidence: 0.445
  Reason: Selected from 23 candidates with base score 1.800

📏 Serving: 1/4 cup (28g)
  ⚡ Backfilled: volume

🤖 AI Validation: ✅
  Confidence: 0.8
  Category: correct
  Reason: The mapped almond flour falls within the acceptable fat range...

✅ Result: SUCCESS
```

### JSON File Output

Located in `logs/mapping-analysis-{timestamp}.json`:

```json
{
  "sessionId": "session-2025-11-30T03-15-20",
  "startTime": "2025-11-30T03:15:20.102Z",
  "mappings": [
    {
      "timestamp": "2025-11-30T03:15:40.328Z",
      "rawIngredient": "0.5 cup almond flour",
      "parsed": {
        "amount": 0.5,
        "unit": "cup",
        "ingredient": "almond flour"
      },
      "topCandidates": [
        {
          "rank": 1,
          "foodId": "36701",
          "foodName": "Almond Flour Meal",
          "brandName": "Hodgson Mill",
          "score": 1.8,
          "source": "cache"
        }
        // ... more candidates
      ],
      "selectedCandidate": {
        "foodId": "36701",
        "foodName": "Almond Flour Meal",
        "brandName": "Hodgson Mill",
        "confidence": 0.445,
        "selectionReason": "Selected from 23 candidates with base score 1.800"
      },
      "servingSelection": {
        "servingDescription": "1/4 cup",
        "grams": 28,
        "backfillUsed": true,
        "backfillType": "volume"
      },
      "aiValidation": {
        "approved": true,
        "confidence": 0.8,
        "category": "correct",
        "reason": "The mapped almond flour falls within the acceptable fat range...",
        "detectedIssues": []
      },
      "finalResult": "success"
    }
  ],
  "summary": {
    "totalIngredients": 50,
    "successfulMappings": 45,
    "failedMappings": 5,
    "aiApprovalRate": 0.92,
    "avgConfidence": 0.67
  }
}
```

## Analysis Queries

### 1. Find Low Confidence Mappings

```bash
# PowerShell
Get-Content logs\mapping-analysis-*.json | ConvertFrom-Json | 
  Select-Object -ExpandProperty mappings | 
  Where-Object { $_.selectedCandidate.confidence -lt 0.5 }
```

### 2. Find AI Rejections

```bash
Get-Content logs\mapping-analysis-*.json | ConvertFrom-Json | 
  Select-Object -ExpandProperty mappings | 
  Where-Object { -not $_.aiValidation.approved }
```

### 3. Check for Missed Exact Matches

Look for cases where rank 2-5 might have been better than rank 1.

## Tips

- **Run 10-15 recipes** to get meaningful data
- **Look for patterns** in rejections and low confidence scores
- **Compare candidates** to see if scoring is optimal
- **Note backfill usage** to verify volume serving pipeline

## Next Steps

1. Run your recipe imports with logging enabled
2. Analyze the generated JSON files
3. Identify optimization opportunities:
   - Scoring improvements
   - Parser enhancements
   - Search query refinements
4. Implement improvements based on findings
