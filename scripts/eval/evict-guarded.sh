#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"
exec npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/eval/evict-guarded.ts "$@"
