# Sprint 0 — GitHub Setup (Complete ✅)

**Sprint 0 setup is complete!** All labels, milestone, and 7 issues have been created.

## What Was Created

- ✅ **8 Labels**: sprint-0, area-api, area-data, area-eval, area-infra, blocked, needs-spec, good-first-issue
- ✅ **1 Milestone**: Sprint 0 — Audit, Baseline & FDC API Setup (due Nov 11)
- ✅ **7 Issues**: #39-#45 (all Sprint 0 tasks)

## Next Steps

1. **Set up GitHub Project**: See [PROJECT_SETUP_GUIDE.md](./PROJECT_SETUP_GUIDE.md) for step-by-step instructions
2. **Start working**: Begin with issue #39 [S0.1] Create FDC API Client
3. **Verify setup**: Run `./verify-setup.sh` anytime to check your sprint status

## Quick Reference

**View Sprint 0 issues:**
```bash
gh issue list --milestone "Sprint 0 — Audit, Baseline & FDC API Setup"
```

**View labels:**
```bash
gh label list | grep -E "(sprint-0|area-)"
```

---

## Original Setup Instructions (Archive)

This section contains the original setup instructions for reference.

## Prerequisites

1. **GitHub CLI installed**
   ```bash
   # Check if installed
   gh --version
   
   # Install if needed:
   # macOS: brew install gh
   # Windows: winget install --id GitHub.cli
   # Linux: https://github.com/cli/cli/blob/trunk/docs/install_linux.md
   ```

2. **Authenticated with GitHub**
   ```bash
   gh auth login
   ```

3. **Set default repository**
   ```bash
   gh repo set-default
   # Select your repository from the list
   ```

## Quick Start (All-in-One)

Run everything at once:

### Unix/Mac/Linux:
```bash
chmod +x .github/setup-all.sh
./.github/setup-all.sh
```

### Windows (PowerShell):
```powershell
# Run each script manually:
bash .github/setup-labels.sh
bash .github/setup-milestone.sh
bash .github/setup-issues.sh
```

Or use Git Bash on Windows to run the `setup-all.sh` script.

## Individual Scripts

If you want more control, run scripts individually:

### 1. Create Labels
```bash
bash .github/setup-labels.sh
```

Creates:
- `sprint-0` (blue) — Sprint identifier
- `area-api`, `area-data`, `area-eval`, `area-infra` — Component areas
- `blocked`, `needs-spec`, `good-first-issue` — Status labels

### 2. Create Milestone
```bash
bash .github/setup-milestone.sh
```

Creates milestone: **Sprint 0 — Audit, Baseline & FDC API Setup**
- Due date: 5 days from now
- Description included

### 3. Create All 7 Issues
```bash
bash .github/setup-issues.sh
```

Creates issues:
- **[S0.1]** FDC API Client (rate-limited + cached)
- **[S0.2]** DB Audit Script
- **[S0.3]** Gold Dataset (50-100 test cases)
- **[S0.4]** Eval Harness
- **[S0.5]** Environment Configuration for FDC API
- **[S0.6]** Smoke Tests for FDC API Client
- **[S0.7]** Baseline Report (Sprint 0 Closeout)

Each issue is:
- ✅ Linked to Sprint 0 milestone
- 🏷️ Tagged with appropriate labels
- 📋 Filled with acceptance criteria
- 🔗 Cross-referenced where appropriate

## Verify Setup

```bash
# List all Sprint 0 issues
gh issue list --milestone "Sprint 0 — Audit, Baseline & FDC API Setup"

# View milestone details
gh api repos/:owner/:repo/milestones | jq '.[] | select(.title | contains("Sprint 0"))'

# List labels
gh label list | grep -E "(sprint-0|area-)"
```

## GitHub Project Setup (Manual)

After running the scripts, set up a Project board:

### Option A: Web UI (Recommended)
1. Go to your repo → **Projects** tab
2. Click **New project**
3. Select **Board** template
4. Name it: "Mealspire — Sprints"
5. Add custom views:
   - **Active Sprint**: Filter by `label:sprint-0`
   - **Backlog**: Filter by `-label:sprint-0`
6. Auto-add issues with `sprint-0` label (Settings → Workflows)

### Option B: CLI
```bash
# Create project
gh project create --owner YOUR_USERNAME --title "Mealspire — Sprints"

# Get project number from output, then add items
gh project item-add PROJECT_NUMBER --owner YOUR_USERNAME --url ISSUE_URL
```

## Templates Created

- **`.github/PULL_REQUEST_TEMPLATE.md`** — Standard PR template
- **`.github/ISSUE_TEMPLATE/sprint-task.md`** — Template for future sprint tasks

## Troubleshooting

### "gh: command not found"
Install GitHub CLI: https://cli.github.com/

### "Could not resolve to a Repository"
Set default repo: `gh repo set-default`

### "Resource not accessible by personal access token"
Re-authenticate: `gh auth refresh -s project`

### Date command fails (macOS)
The script handles both macOS and Linux date formats automatically.

### Windows date issues
Use Git Bash or manually calculate date:
```powershell
# Get date 5 days from now in ISO format
(Get-Date).AddDays(5).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
```

## Next Steps

After setup:
1. ✅ Review issues in GitHub
2. 📊 Set up Project board
3. 🚀 Start working on [S0.1] (FDC API Client)
4. 📝 Update issue status as you progress

## Definition of Done (Sprint 0)

- [ ] All 7 issues closed
- [ ] Milestone 100% complete
- [ ] `docs/Sprint_0_Report.md` merged
- [ ] Baseline metrics documented
- [ ] `ENABLE_BRANDED_SEARCH=false` (feature flag off until Sprint 5)

---

**Ready to ship?** 🎉

Once Sprint 0 is done, close the milestone and create Sprint 1 using similar scripts!


