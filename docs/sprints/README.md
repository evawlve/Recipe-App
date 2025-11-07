# Sprint Documentation

This directory contains all sprint planning, workflow, and setup documentation.

## 📚 Files

### Setup & Planning
- **`PROJECT_SETUP_GUIDE.md`** — Step-by-step guide for setting up GitHub Projects and Kanban boards
- **`SETUP_README.md`** — Sprint 0 setup reference (completed) with all created resources

### Workflow
- **`SPRINT_WORKFLOW.md`** — Branch strategy, PR workflow, and best practices for sprint development

## 🚀 Quick Commands

### Verify Sprint Setup
```bash
./scripts/verify-sprint-setup.sh
```

### View Sprint Issues
```bash
gh issue list --milestone "Sprint 0 — Audit, Baseline & FDC API Setup"
```

### Start Working on Sprint 0
1. Read [`SPRINT_WORKFLOW.md`](./SPRINT_WORKFLOW.md) for branch strategy
2. Start with issue #39 [S0.1] Create FDC API Client
3. Create branch: `git checkout -b s0-1-fdc-api-client`

---

## 📖 Related Documentation

- **GitHub Templates**: `.github/` directory (PR templates, issue templates)
- **Scripts**: `scripts/verify-sprint-setup.sh`
- **Project Root**: `README.md`, `ARCHITECTURE.md` for project-level docs

