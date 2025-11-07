# Sprint 0 Workflow Guide

## Branch Strategy

**Recommended: One branch per issue** ✅

This keeps PRs focused, makes reviews easier, and allows independent progress.

### Why Branch Per Issue?

- ✅ **Clean PRs**: Each PR addresses one specific issue
- ✅ **Easy reviews**: Small, focused changes are easier to review
- ✅ **Independent progress**: Can merge issues in any order
- ✅ **Auto-close issues**: Using "Closes #39" in PR description
- ✅ **Rollback safety**: If one issue has problems, others aren't affected

---

## Workflow Steps

### 1. Start Working on an Issue

**Example: Issue #39 [S0.1] Create FDC API Client**

```bash
# Make sure you're on main/master and up to date
git checkout main
git pull origin main

# Create a new branch from main
git checkout -b s0-1-fdc-api-client

# Or if you prefer descriptive names:
# git checkout -b sprint-0/fdc-api-client
```

**Branch naming convention:**
- `s0-1-fdc-api-client` (short, clear)
- `sprint-0/fdc-api-client` (grouped by sprint)
- `issue-39-fdc-api-client` (includes issue number)

### 2. Work on the Issue

Make your changes, commit as you go:

```bash
# Make changes to files
# ...

# Commit frequently with clear messages
git add src/lib/usda/fdc-api.ts
git commit -m "Implement FDC API client with rate limiting"

git add src/lib/usda/fdc-api.test.ts
git commit -m "Add tests for rate limiter and cache"
```

### 3. Push and Create PR

```bash
# Push your branch
git push origin s0-1-fdc-api-client

# Create PR via GitHub CLI (or use web UI)
gh pr create \
  --title "[S0.1] Create FDC API Client (rate-limited + cached)" \
  --body "Implements src/lib/usda/fdc-api.ts with rate limiting and LRU cache.

Closes #39

## Changes
- Added FDC API client with searchFoods() method
- Implemented rate limiter (1000 req/hour)
- Added LRU cache (200 entries, 24h TTL)
- Unit tests for rate limiting and caching

## Testing
- [x] Rate limiter prevents >10 req/s
- [x] Cache hit on repeated queries
- [x] All tests pass"

# Or use the PR template by opening in browser:
gh pr create --web
```

**Important**: Include `Closes #39` in the PR body to auto-close the issue when merged.

### 4. After PR is Merged

```bash
# Switch back to main and pull latest
git checkout main
git pull origin main

# Delete your feature branch (optional, but recommended)
git branch -d s0-1-fdc-api-client
git push origin --delete s0-1-fdc-api-client  # Delete remote too
```

### 5. Start Next Issue

Repeat steps 1-4 for the next issue!

```bash
git checkout -b s0-2-db-audit-script
# ... work on issue #40
```

---

## Alternative: Small Issues Can Be Combined

If some issues are very small (like S0.5 - just adding env vars), you can combine them:

```bash
# For S0.5 (small change)
git checkout -b s0-5-env-config
# Make small changes
# PR can address S0.5

# Or combine with S0.1 if they're tightly coupled:
git checkout -b s0-1-fdc-api-client
# Work on S0.1
# Also add env config (S0.5) in same PR
# PR body: "Closes #39, Closes #43"
```

**When to combine:**
- Very small changes (<50 lines)
- Tightly coupled (one depends on the other)
- You're the only reviewer

**When to separate:**
- Different acceptance criteria
- Different areas of codebase
- Want independent review cycles

---

## Your Current Branch: `improveMapping`

**Question**: Should you use this branch or create new ones?

**Recommendation**: 
- If `improveMapping` already has Sprint 0 work → **Continue on it for now**, create PRs from it
- If `improveMapping` is empty/clean → **Create new branches** per issue (cleaner)

**To check what's on improveMapping:**
```bash
git checkout improveMapping
git log --oneline -10  # See recent commits
git status  # See if there are uncommitted changes
```

---

## Example Sprint 0 Workflow

```bash
# Issue #39: FDC API Client
git checkout -b s0-1-fdc-api-client
# ... work ...
git push origin s0-1-fdc-api-client
gh pr create --title "[S0.1] Create FDC API Client" --body "Closes #39"
# Wait for review/merge

# Issue #40: DB Audit Script
git checkout main
git pull origin main
git checkout -b s0-2-db-audit-script
# ... work ...
git push origin s0-2-db-audit-script
gh pr create --title "[S0.2] DB Audit Script" --body "Closes #40"
# Wait for review/merge

# Continue for all 7 issues...
```

---

## Quick Reference

**Create branch:**
```bash
git checkout -b s0-X-issue-name
```

**Create PR:**
```bash
gh pr create --title "[S0.X] Issue Title" --body "Closes #XX"
```

**Move to next issue:**
```bash
git checkout main
git pull origin main
git checkout -b s0-Y-next-issue
```

**Check Sprint progress:**
```bash
gh issue list --milestone "Sprint 0 — Audit, Baseline & FDC API Setup"
```

---

## Best Practices

✅ **Keep branches focused** - One branch = one issue  
✅ **Commit frequently** - Small, logical commits  
✅ **Write clear PR descriptions** - Use the template  
✅ **Link issues** - Always include "Closes #XX"  
✅ **Update status** - Move issue to "In Progress" when starting, "Done" when PR merged  
✅ **Test before PR** - Run tests locally, verify acceptance criteria  

---

**Ready to start?** Begin with issue #39! 🚀

