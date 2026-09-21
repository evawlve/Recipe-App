#!/bin/bash
#
# Pull the box's newest mealspire dump to the Mac — punch #233, Lane A S53 (2026-09-21).
# Driven by launchd: ops/mac/com.kindahealthy.pgbackup-pull.plist, 06:15 local.
#
# WHY THE MAC AND NOT THE WINDOWS PC. The Mac joined the tailnet on 2026-09-14, so this pull works
# from anywhere over the MagicDNS name. The Windows PC is not a documented tailnet node, which would
# tie the off-box copy to both machines being on the home LAN.
#
# WHY THE MAGICDNS NAME AND NOTHING ELSE. 192.168.1.133 only works at home, and a 100.x literal
# NAT64s away on an IPv6-only network (memory `mac-env-points-at-tailnet-ip`). The FQDN below is the
# one address that resolves on the home LAN, on tethered data and behind someone else's Wi-Fi.
#
# WHERE IT WRITES. /Users/diego/backups/mealspire is outside both git repos and outside all three of
# the Mac's Syncthing folders (/Users/diego/dev/KindaHealthyMobile, /Users/diego/dev/Recipe-App,
# "/Users/diego/School Stuff"; re-derive: grep -o 'path="[^"]*"' \
# ~/Library/Application\ Support/Syncthing/config.xml). It is also outside ~/Documents, which is an
# iCloud file-provider domain that forks contended files. Never move it into any of those.
#
# THE SHA COMPARISON IS THE POINT. A dump that arrives truncated is worse than no dump, because it
# looks like a backup. This script writes to .part, compares the Mac's sha256 against the box's, and
# only then renames. A mismatch discards the file rather than keeping it.
#
# A laptop asleep at 06:15 simply misses a night and catches up on the next run; that is acceptable
# and deliberate, because the box's own 7 nightly copies are the primary.

set -u

BOX_USER=owner
BOX=dhl32-opt-5060.tail9ae316.ts.net
SRC_DIR=/home/owner/backups
DEST=/Users/diego/backups/mealspire
KEEP=3
LOG="$DEST/pgbackup-pull.log"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=30)

log() {
  local line
  line="$(date '+%Y-%m-%d %H:%M:%S %Z') pgbackup-pull: $*"
  echo "$line"
  echo "$line" >>"$LOG" 2>/dev/null || true
}

mkdir -p "$DEST" || { echo "pgbackup-pull: FAILED cannot create $DEST"; exit 1; }

NEWEST=$(ssh "${SSH_OPTS[@]}" "$BOX_USER@$BOX" "ls -1t $SRC_DIR/mealspire-*.dump 2>/dev/null | head -1" 2>/dev/null)
if [ -z "${NEWEST:-}" ]; then
  log "FAILED no dump listed on $BOX — box unreachable, Tailscale down, or pg-backup has not run"
  exit 1
fi
BASE=$(basename "$NEWEST")

REMOTE_SHA=$(ssh "${SSH_OPTS[@]}" "$BOX_USER@$BOX" "sha256sum $NEWEST" 2>/dev/null | awk '{print $1}')
if [ -z "${REMOTE_SHA:-}" ]; then
  log "FAILED could not read the box's sha256 for $BASE"
  exit 1
fi

if [ -f "$DEST/$BASE" ]; then
  HAVE_SHA=$(shasum -a 256 "$DEST/$BASE" | awk '{print $1}')
  if [ "$HAVE_SHA" = "$REMOTE_SHA" ]; then
    log "already holding $BASE, sha matches the box; nothing to pull"
    exit 0
  fi
  log "$BASE is present but its sha differs from the box's; re-pulling"
fi

PART="$DEST/$BASE.part"
rm -f "$PART"
STARTED=$(date +%s)
if ! scp -q "${SSH_OPTS[@]}" "$BOX_USER@$BOX:$NEWEST" "$PART"; then
  log "FAILED scp of $BASE; discarding the partial file"
  rm -f "$PART"
  exit 1
fi
ELAPSED=$(($(date +%s) - STARTED))

LOCAL_SHA=$(shasum -a 256 "$PART" | awk '{print $1}')
if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  log "FAILED sha mismatch on $BASE box=$REMOTE_SHA mac=$LOCAL_SHA; discarding"
  rm -f "$PART"
  exit 1
fi

BYTES=$(stat -f %z "$PART" 2>/dev/null || echo 0)
mv -f "$PART" "$DEST/$BASE" || { log "FAILED could not rename $PART"; exit 1; }
log "ok $BASE bytes=$BYTES elapsed=${ELAPSED}s sha=$LOCAL_SHA (matches the box)"

# Prune only after the new copy has renamed, oldest first; the glob cannot match a *.dump.part.
stale=$(ls -1t "$DEST"/mealspire-*.dump 2>/dev/null | tail -n +$((KEEP + 1)))
if [ -n "$stale" ]; then
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    rm -f "$f" && log "pruned $f"
  done <<<"$stale"
fi
log "retained $(ls -1 "$DEST"/mealspire-*.dump 2>/dev/null | wc -l | tr -d ' ') of $KEEP"
