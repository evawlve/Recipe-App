# Mapping Validation Queue

**Last Updated**: 2026-01-22  
**Source**: `mapping-summary-2026-01-22` (regression test after fixes)

---

## Summary

| Metric | Value |
|--------|-------|
| Total Ingredients | 642 |
| Successful Mappings | 640 |
| Failures | 2 (unique) |
| Success Rate | **99.7%** |

---

## PENDING Issues

### Issue 1: Buttery Cinnamon Powder
| Field | Value |
|-------|-------|
| Raw Line | `"0.5 tsp buttery cinnamon powder"` |
| Current Mapping | FAILED (0.00 confidence) |
| Expected | Cinnamon (~3 kcal) |
| Severity | LOW |
| Status | PENDING (likely fictional ingredient) |
| Notes | "Buttery cinnamon powder" may not be a real product. Consider AI simplification to "cinnamon" |

---

### Issue 2: Burger Relish
| Field | Value |
|-------|-------|
| Raw Line | `"0.67 tbsp burger relish"` |
| Current Mapping | FAILED (0.00 confidence) |
| Expected | Pickle Relish (~5 kcal) |
| Severity | LOW |
| Status | PENDING (AI simplification needed) |
| Notes | 1 candidate survives but confidence too low. AI simplification should map "burger relish" → "pickle relish" |

---

## RESOLVED Issues

### ✅ Issue A: Bunch Spinach
| Field | Value |
|-------|-------|
| Raw Line | `"1 bunch spinach"` |
| Previous | FAILED - "bunch" treated as mandatory token |
| Fix | Added `bunch` to MODIFIER_TOKENS in `filter-candidates.ts` |
| Result | Now maps to Spinach successfully |
| Resolved | 2026-01-22 |

### ✅ Issue B: Vegetarian Mince
| Field | Value |
|-------|-------|
| Raw Line | `"6 oz vegetarian mince"` |
| Previous | FAILED - 0 candidates, dietary filter rejected all meat |
| Fix | Dietary filter working correctly; mapped via AI fallback |
| Result | Now maps successfully (likely to meatless crumbles) |
| Resolved | 2026-01-22 |
