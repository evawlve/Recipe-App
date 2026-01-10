# User Serving Overrides

> **Status**: Schema implemented, feature partially implemented
> **Priority**: High - Solves the "container" unit problem

---

## Overview

User serving overrides allow users to define custom serving sizes for ambiguous units like "container", "scoop", "bowl", etc. The system provides AI-estimated defaults, which users can override on a per-user, per-food basis.

## Problem Statement

Many recipes use ambiguous count units that don't have standard weights:
- `1 container low fat yogurt` - Is this 6oz? 16oz? 32oz?
- `1 scoop protein powder` - Varies by brand and user preference
- `1 bowl oatmeal` - Depends on bowl size

Currently, these fail mapping because we can't determine the weight.

## Proposed Solution

### Phase 1: AI Backfill for Ambiguous Units (Not Yet Implemented)

When encountering an ambiguous unit:
1. Call AI to estimate typical serving size
2. Store in `PortionOverride` table (global default)
3. Use this estimate for all users initially

**Example AI Prompt**:
```
For "1 container low fat yogurt", what is the typical container size in fluid ounces?
Consider common retail packaging.
```

**AI Response**:
```json
{
  "unit": "container",
  "estimatedOz": 16,
  "estimatedGrams": 453.6,
  "confidence": 0.75,
  "reasoning": "Most single-serve yogurt containers are 5-6oz, but 'container' often refers to larger tubs (16-32oz). 16oz is a common mid-size."
}
```

### Phase 2: User Overrides (Schema Exists)

Users can override the AI estimate:

**Schema**:
```prisma
model UserPortionOverride {
  id        String   @id @default(cuid())
  userId    String
  foodId    String
  unit      String   // "container", "scoop", "bowl"
  grams     Float    // User's custom weight
  label     String?  // Optional label like "My yogurt container"
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  @@unique([userId, foodId, unit])
}
```

**Lookup Priority**:
1. Check `UserPortionOverride` for this user + food + unit
2. Fallback to `PortionOverride` (global AI estimate)
3. Fail if neither exists

### Phase 3: UI for Override Management (Not Yet Implemented)

**During Recipe Import**:
```
✓ 1 cup milk → Milk (240g)
⚠️ 1 container yogurt → Low Fat Yogurt (453.6g) [AI estimate]
   
   [Adjust serving size] button
```

**Override Dialog**:
```
Ingredient: Low Fat Yogurt
Unit: container
Current: 453.6g (16 fl oz) [AI estimate]

Your container size: [____] oz  or  [____] grams

[Save for future recipes]  [Use once]
```

**Saved Overrides Page**:
```
Your Custom Serving Sizes

Low Fat Yogurt
  • container → 283.5g (10 oz) [Your override]
  
Protein Powder
  • scoop → 30g [Your override]
  
[+ Add new override]
```

---

## Implementation Status

### ✅ Completed
- `UserPortionOverride` table in schema
- `PortionOverride` table in schema (for global defaults)

### ⏳ In Progress
- None

### 📋 TODO
1. **AI Backfill Function** (`ai-serving-estimator.ts`)
   - Prompt engineering for serving size estimation
   - Parse AI response to extract grams/oz
   - Store in `PortionOverride` table
   
2. **Serving Selection Logic** (update `select-serving.ts`)
   - Check `UserPortionOverride` first
   - Fallback to `PortionOverride`
   - Call AI backfill if neither exists
   
3. **UI Components**
   - Override adjustment dialog during recipe import
   - Saved overrides management page
   - Inline editing in recipe view

4. **API Endpoints**
   - `POST /api/user/portion-overrides` - Create/update override
   - `GET /api/user/portion-overrides` - List user's overrides
   - `DELETE /api/user/portion-overrides/:id` - Remove override

---

## Database Schema

### UserPortionOverride
Stores user-specific serving size overrides.

| Field | Type | Description |
|-------|------|-------------|
| `userId` | String | User who created the override |
| `foodId` | String | Food item this applies to |
| `unit` | String | Unit being overridden (e.g., "container") |
| `grams` | Float | User's custom weight in grams |
| `label` | String? | Optional label for this override |

**Unique Constraint**: `(userId, foodId, unit)`

### PortionOverride
Stores global AI-estimated serving sizes.

| Field | Type | Description |
|-------|------|-------------|
| `foodId` | String | Food item this applies to |
| `unit` | String | Unit being estimated (e.g., "container") |
| `grams` | Float | AI-estimated weight in grams |
| `label` | String? | Optional description |

**Unique Constraint**: `(foodId, unit)`

---

## Example Flow

### Scenario: User imports "1 container low fat yogurt"

**First Time (No Override Exists)**:
```
1. Parse: qty=1, unit="container", name="low fat yogurt"
2. Map to food: "Low Fat Yogurt" (foodId: "abc123")
3. Check UserPortionOverride(userId, "abc123", "container") → Not found
4. Check PortionOverride("abc123", "container") → Not found
5. Call AI: "Estimate serving size for 1 container of low fat yogurt"
6. AI returns: 453.6g (16 oz, confidence: 0.75)
7. Save to PortionOverride("abc123", "container", 453.6g)
8. Show user: "⚠️ Using AI estimate: 453.6g (16 oz) [Adjust?]"
9. User clicks [Adjust] → Sets to 283.5g (10 oz)
10. Save to UserPortionOverride(userId, "abc123", "container", 283.5g)
```

**Future Recipes**:
```
1. Parse: qty=1, unit="container", name="low fat yogurt"
2. Map to food: "Low Fat Yogurt" (foodId: "abc123")
3. Check UserPortionOverride(userId, "abc123", "container") → Found: 283.5g ✅
4. Use 283.5g (no AI call needed)
```

**Different User**:
```
1. Parse: qty=1, unit="container", name="low fat yogurt"
2. Map to food: "Low Fat Yogurt" (foodId: "abc123")
3. Check UserPortionOverride(otherUserId, "abc123", "container") → Not found
4. Check PortionOverride("abc123", "container") → Found: 453.6g ✅
5. Use 453.6g (AI estimate from first user's import)
```

---

## Known Ambiguous Units

These units should trigger AI backfill:

| Unit | Typical Range | Notes |
|------|---------------|-------|
| `container` | 6-32 oz | Varies widely by product type |
| `scoop` | 15-60g | Protein powder, ice cream |
| `bowl` | 200-500g | Depends on bowl size |
| `handful` | 20-40g | Very subjective |
| `packet` | 1-28g | Varies by product (sweetener vs sauce) |
| `envelope` | 7-28g | Gelatin, sauce mixes |
| `can` | 150-450g | Varies by product |

---

## Future Enhancements

1. **Brand-Specific Defaults**: "1 container Chobani yogurt" → 150g (5.3oz)
2. **Photo-Based Estimation**: User uploads photo of container → AI estimates size
3. **Community Defaults**: Aggregate user overrides to improve AI estimates
4. **Smart Suggestions**: "Most users set this to 10oz. Use this value?"
