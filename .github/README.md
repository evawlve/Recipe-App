# .github Directory

This directory contains **GitHub-specific configuration files** that GitHub automatically uses.

## 📋 Contents

### Templates (Required by GitHub)
- **`pull_request_template.md`** — PR template (GitHub automatically uses this)
- **`ISSUE_TEMPLATE/sprint-task.md`** — Issue template for sprint tasks

### Workflows (GitHub Actions)
- **`workflows/`** — CI/CD and scheduled job definitions

---

## 📚 Documentation

**Sprint-related documentation has been moved to:**
- `docs/sprints/` — All sprint guides and workflows

**Scripts have been moved to:**
- `scripts/verify-sprint-setup.sh` — Verify Sprint 0 setup

---

## 🚀 Quick Commands

### View Sprint Issues
```bash
gh issue list --milestone "Sprint 0 — Audit, Baseline & FDC API Setup"
```

### Verify Sprint Setup
```bash
./scripts/verify-sprint-setup.sh
```

### Create New Sprint Task
1. Go to Issues → New Issue
2. Select "Sprint Task" template
3. Fill in details
4. Add labels (sprint-X, area-*)
5. Link to milestone

---

## 📖 Documentation Links

- **Project Setup**: [`docs/sprints/PROJECT_SETUP_GUIDE.md`](../docs/sprints/PROJECT_SETUP_GUIDE.md)
- **Sprint Workflow**: [`docs/sprints/SPRINT_WORKFLOW.md`](../docs/sprints/SPRINT_WORKFLOW.md)
- **Sprint 0 Setup**: [`docs/sprints/SETUP_README.md`](../docs/sprints/SETUP_README.md)
