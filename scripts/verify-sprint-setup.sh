#!/bin/bash

# Verify Sprint 0 Setup
# Quick check that everything was created

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Sprint 0 Setup Verification"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

MILESTONE="Sprint 0 — Audit, Baseline & FDC API Setup"

echo "📋 Checking labels..."
LABEL_COUNT=$(gh label list --limit 100 | grep -c -E "(sprint-0|area-)" || true)
echo "   Found $LABEL_COUNT sprint/area labels"

echo ""
echo "🎯 Checking milestone..."
gh api repos/:owner/:repo/milestones | grep -o "Sprint 0" || echo "   ⚠️  Milestone not found"

echo ""
echo "📝 Checking issues..."
ISSUE_COUNT=$(gh issue list --json title,milestone --jq ".[] | select(.milestone.title == \"$MILESTONE\") | .title" | wc -l)
echo "   Found $ISSUE_COUNT issues for Sprint 0"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$ISSUE_COUNT" -eq 7 ]; then
    echo "✅ Setup complete! All 7 issues created."
    echo ""
    echo "View your sprint:"
    gh issue list --json number,title,milestone --jq ".[] | select(.milestone.title == \"$MILESTONE\") | \"#\(.number) \(.title)\""
else
    echo "⚠️  Expected 7 issues, found $ISSUE_COUNT"
    echo ""
    echo "All issues in repo:"
    gh issue list --limit 10
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

