#!/usr/bin/env bash
#
# check-nutrition-allowlist.sh — is refresh-off-from-parquet.sh's
# NUTRITION_PHYSICS allowlist still a set of directions the detector emits?
#
# Prints the count of STALE entries (0 = healthy) and exits 0 either way, so
# both callers can decide what a non-zero count means:
#   - the refresh's own preflight, which must fail BEFORE the truncate (a typo
#     found afterwards aborts a run that has already rebuilt the corpus);
#   - the doc-check claim off-refresh-nutrition-allowlist-not-stale.
#
# One copy on purpose. A rename in the detector silently drops that direction's
# whole population from every future rebuild while the run still reports
# success, and a check that lives in only one of the two callers is a check the
# other one is missing.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REFRESH="$REPO/scripts/refresh-off-from-parquet.sh"
DETECTOR="$REPO/scripts/eval/detect-corrupt-nutrition.ts"

# Missing files are a failure, never a quiet pass: an allowlist that cannot be
# read is not an allowlist with zero stale entries.
[ -f "$REFRESH" ]  || { echo "missing: $REFRESH"  >&2; exit 2; }
[ -f "$DETECTOR" ] || { echo "missing: $DETECTOR" >&2; exit 2; }

ALLOWLIST="$(sed -n "s/^NUTRITION_PHYSICS='\(.*\)'\$/\1/p" "$REFRESH")"
[ -n "$ALLOWLIST" ] || { echo "NUTRITION_PHYSICS not found in $REFRESH" >&2; exit 2; }

STALE=0
for d in ${ALLOWLIST//,/ }; do
  grep -q "direction: '$d'" "$DETECTOR" || {
    echo "stale direction: $d" >&2
    STALE=$((STALE + 1))
  }
done
echo "$STALE"
