#!/bin/bash
#
# The hard-case loop's nightly Mode O screen — Lane A S63 (pm109, 2026-09-29), on Diego's 2026-09-28
# "build it". Driven by launchd: ops/mac/com.kindahealthy.adversary.plist, 08:30 local.
# The code is scripts/eval/adversary/ (its cli.ts header owns what Mode O reads and judges).
#
# WHAT IT DOES. Reads MappingEventLog read-only over ssh, judges the served rows with
# `claude -p --model claude-sonnet-5` on Diego's Claude Code SUBSCRIPTION, and writes
# sync-docs/adversary-latest.md (gitignored; Syncthing carries it like flywheel-latest.md). It runs
# Mode O ONLY. Mode G (generated probes) creates rows on the box and is on demand, by hand.
#
# WHY THE MAC. The judge bills the subscription only from a machine logged in to claude.ai, and the
# box is reachable privately from here by its MagicDNS name. A cloud routine would reach the box only
# through the public Funnel, where a keyed request is refused.
#
# ADDRESSING. The MagicDNS short name `dhl32-opt-5060`, only. NOT the pgbackup job's address block:
# the `.ts.net` FQDN is the public Funnel over http, `192.168.1.133` is home-LAN only, and a 100.x
# literal NAT64s out of the tunnel on an IPv6-only network. The short name resolves only on the
# tailnet, so off it this job fails closed with `tailnet down`.
#
# EXITS AT ONCE, with ONE line written as the report, when:
#   - the hour under TZ=America/Los_Angeles is 04 (the flywheel sweep's hour). StartCalendarInterval
#     is Mac-local and the Mac travels, and a run missed during sleep fires on wake, so the hour is
#     checked here, not trusted to the plist;
#   - ~/.adversary-hold exists (a Lane A window holds the box; create it BEFORE a MEL quiet-window
#     check, remove it after the all-clear);
#   - the tailnet name does not answer (HTTP /api/ok and ssh);
#   - `claude auth status` does not read a logged-in claude.ai account.
# A skipped night loses nothing: cli.ts `--since-state` starts the next run where the last good run
# ended (capped at 7 days back).
#
# SLEEP. The whole run holds `caffeinate -i -w $$` (idle sleep only; a closed lid or low battery
# still wins, and launchd then fires the run on the next wake).
#
# LAUNCHD GIVES NO PATH, so node, ts-node and claude are absolute paths, and HOME is set explicitly.
# THE CLI'S LOGIN NEEDS USER AND PATH (measured 2026-09-29): the claude.ai credential is a keychain
# item (service "Claude Code-credentials", account "diego"); the CLI names the account from $USER and
# reads it through /usr/bin/security. Under `env -i` with HOME alone, or HOME + USER without PATH, or
# HOME + PATH + LOGNAME, `claude auth status` reads `loggedIn: false`; HOME + PATH + USER reads
# `loggedIn: true`. So both are exported here, not trusted to launchd.
# Exit: 0 ran (flags or not), 1 skipped or failed (the report says which).

set -u
export HOME=/Users/diego
export USER=diego
export LOGNAME=diego
export PATH=/usr/bin:/bin:/usr/sbin:/sbin

REPO=/Users/diego/dev/Recipe-App
NODE=/usr/local/bin/node
TS_NODE="$REPO/node_modules/ts-node/dist/bin.js"
CLAUDE=/Users/diego/.local/bin/claude
BOX=dhl32-opt-5060
HOLD=/Users/diego/.adversary-hold
STATE_DIR=/Users/diego/.adversary
REPORT="$REPO/sync-docs/adversary-latest.md"
LOG="$STATE_DIR/adversary.log"

mkdir -p "$STATE_DIR" || { echo "adversary: FAILED cannot create $STATE_DIR"; exit 1; }

log() {
  local line
  line="$(date '+%Y-%m-%d %H:%M:%S %Z') adversary: $*"
  echo "$line"
  echo "$line" >>"$LOG" 2>/dev/null || true
}

# One line as the report, then exit. The last full report stays in logs/adversary/ and is named.
stop() {
  local why="$1" code="$2" last
  last=$(ls -1 "$REPO"/logs/adversary/*-observe.md 2>/dev/null | sort | tail -1)
  printf '# Hard-case loop — Mode O\n\n%s PDT: **%s** — nothing was screened this run. Last full report: `%s`.\n' \
    "$(TZ=America/Los_Angeles date '+%Y-%m-%d %H:%M:%S')" "$why" "${last:-none}" >"$REPORT" 2>/dev/null || true
  log "$why"
  exit "$code"
}

# One idle assertion for the whole run, released when this script exits.
caffeinate -i -w $$ &

[ "$(TZ=America/Los_Angeles date +%H)" = "04" ] && stop "SKIPPED: 04:xx PDT is the flywheel sweep's hour" 1
[ -e "$HOLD" ] && stop "SKIPPED: $HOLD exists — a Lane A window holds the box" 1
curl -s -m 10 "http://$BOX:3000/api/ok" 2>/dev/null | grep -q '"buildId"' \
  || stop "FAILED cause=tailnet down — http://$BOX:3000/api/ok did not answer" 1
ssh -o BatchMode=yes -o ConnectTimeout=15 "owner@$BOX" true 2>/dev/null \
  || stop "FAILED cause=tailnet down — ssh owner@$BOX did not answer" 1
(cd "$STATE_DIR" && "$CLAUDE" auth status 2>/dev/null) | grep -q '"loggedIn": *true' \
  || stop "FAILED cause=claude auth — \`claude auth status\` is not logged in" 1

cd "$REPO" || stop "FAILED cannot cd $REPO" 1
OUT=$("$NODE" "$TS_NODE" --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register \
  scripts/eval/adversary/cli.ts observe --since-state 2>&1)
RC=$?
printf '%s\n' "$OUT" >>"$LOG"
case "$RC" in
  0 | 1) log "ok rc=$RC — $(printf '%s\n' "$OUT" | tail -1)" ;;
  *) stop "FAILED cause=observe exited $RC — $(printf '%s\n' "$OUT" | grep -v '^[[:space:]]*$' | tail -1 | cut -c1-300)" 1 ;;
esac
exit 0
