# Documentation

This directory contains project documentation organized by topic.

## 📁 Structure

```
docs/
├── sprints/                    # Sprint planning and workflow guides
├── Sprint_0_Report.md         # Sprint 0 completion report
├── s1-parser.md                # Sprint 1: Parser documentation
├── USDA_SATURATION_README.md   # USDA saturation system documentation
├── USDA_SATURATION_SUCCESS.md  # USDA saturation success report
├── MAIN_PHOTO_FEATURE.md       # Main photo feature documentation
└── README.md                   # This file
```

## 📚 Sprint Documentation

### Sprint Reports
- **[Sprint 0 Report](Sprint_0_Report.md)** — Baseline metrics, FDC API setup, and database audit
- **[Sprint 1 Parser Documentation](s1-parser.md)** — Ingredient parser documentation with examples

### Evaluation System
- **[Evaluation System](eval.md)** — Gold dataset, evaluation harness, and CI integration

### Sprint Workflow Guides
All sprint-related guides are in [`sprints/`](./sprints/):

- **`PROJECT_SETUP_GUIDE.md`** — Step-by-step GitHub Project setup
- **`SPRINT_WORKFLOW.md`** — Branch strategy and workflow for sprints
- **`SETUP_README.md`** — Sprint 0 setup reference (completed)

## 🔧 Feature Documentation

- **[USDA Saturation System](USDA_SATURATION_README.md)** — USDA data import and saturation system (v1 implementation, before sprints 0-9)
- **[USDA Saturation Success](USDA_SATURATION_SUCCESS.md)** — Implementation success report (v1 implementation, before sprints 0-9)
- **[Main Photo Feature](MAIN_PHOTO_FEATURE.md)** — Recipe main photo selection feature

## Quick Links

### Verify Sprint Setup
```bash
./scripts/verify-sprint-setup.sh
```

### View Sprint Issues
```bash
gh issue list --milestone "Sprint 0 — Audit, Baseline & FDC API Setup"
```

---

**Note**: Project-level documentation (like `README.md`, `ARCHITECTURE.md`, `CHANGELOG.md`) remains at the repository root.

