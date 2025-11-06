# GitHub Project Setup Guide

## Step-by-Step: Create Your Sprint Board

### 1. Navigate to Projects

1. Go to your repository: `https://github.com/evawlve/Recipe-App`
2. Click on the **Projects** tab (top navigation)
3. Click the green **New project** button

### 2. Choose Template

1. Select **Board** template (the Kanban-style view)
2. Click **Create**

### 3. Configure Your Project

**Name:**
- Enter: `Mealspire — Sprints`

**Description (optional):**
- `Sprint planning and tracking board for Recipe App development`

Click **Create** to finish.

### 4. Add Your Sprint 0 Issues

Your project should automatically show issues. If not:

1. Click the **+ Add item** button
2. Select **Issues** from the dropdown
3. Search for "Sprint 0" or "S0" and add all 7 issues (#39-#45)

**Or manually add each:**
- Click **+ Add item** → **Issues**
- Type `#39` and press Enter (adds issue 39)
- Repeat for `#40`, `#41`, `#42`, `#43`, `#44`, `#45`

### 5. Set Up Columns (Kanban Board)

Your board should have default columns. Customize them:

**Default columns (you can rename):**
- **Todo** → Rename to **Backlog**
- **In Progress** → Keep as is
- **Done** → Keep as is

**Optional: Add more columns:**
1. Click **+ Add column** (right side)
2. Add: **Review** (between In Progress and Done)
3. Add: **Blocked** (if needed)

**To rename columns:**
- Click the three dots (⋮) on the column header
- Select **Edit column**
- Rename and save

### 6. Create Custom Views (Optional but Recommended)

**Active Sprint View:**
1. Click the **View** dropdown (top left, next to "Board")
2. Select **New view** → **Board**
3. Name it: **Active Sprint**
4. Click **+ Add filter**
5. Add filter: **Label** → `sprint-0`
6. Save

**Backlog View:**
1. Create another view: **New view** → **Board**
2. Name it: **Backlog**
3. Add filter: **Label** → `-sprint-0` (this shows issues NOT labeled sprint-0)
4. Save

**To switch between views:**
- Use the **View** dropdown at the top

### 7. Enable Auto-Add (Recommended)

Automatically add issues with `sprint-0` label to your project:

1. Click the **Settings** gear icon (⚙️) in the top right of the project
2. Scroll down to **Workflows**
3. Find **Auto-add items**
4. Toggle it **ON**
5. Add rule: **Label** → `sprint-0` → **Add to project**
6. Save

### 8. Organize Your Sprint 0 Issues

**Drag and drop issues to organize:**

- **Todo/Backlog**: All 7 issues start here
- **In Progress**: Move issues here when you start working on them
- **Done**: Move here when an issue is complete

**Example workflow:**
1. Start working on `#39 [S0.1] FDC API Client`
2. Drag it to **In Progress**
3. When done, drag to **Done**
4. Continue with `#40 [S0.2]`, etc.

### 9. Track Progress

**View Sprint Progress:**
- Click on your **Active Sprint** view
- You'll see all Sprint 0 issues organized by status
- The milestone progress bar at the top shows completion

**Insights:**
- Click the **Insights** tab in your project to see charts and metrics

---

## Quick Reference

**Project URL Pattern:**
```
https://github.com/evawlve/Recipe-App/projects/X
```
(Replace X with your project number)

**View all Sprint 0 issues:**
```bash
gh issue list --milestone "Sprint 0 — Audit, Baseline & FDC API Setup"
```

**Move issue to project (if auto-add doesn't work):**
- In GitHub web UI: Issue → Right sidebar → Projects → Add to project

---

## Tips

✅ **Update issue status** as you work (drag cards between columns)  
✅ **Link PRs to issues** using "Closes #39" in PR description  
✅ **Use labels** to filter and organize issues  
✅ **Add notes** to project board for reminders or context  

---

**That's it!** Your Sprint 0 board is ready. 🚀

