#!/bin/bash
#
# Nightly pg_dump of the box's mealspire database — punch #233, Lane A S53 (2026-09-21).
#
# WHY THIS EXISTS. Until 2026-09-21 the box had no backup at all: no pg_dump timer, no cron job
# (measured read-only 2026-09-19 by consolidation S37b, re-measured 2026-09-21). The only dump on
# disk was /home/owner/pg-migrate/mealspire.dump — 1,415,959,079 bytes dated 2026-07-19, a migration
# artifact that predates every repoint campaign, every warm batch and every Lane A fix.
#
# WHERE IT WRITES, AND WHY IT MUST STAY THERE. /home/owner/backups is OUTSIDE all three of the box's
# Syncthing folders (/home/owner/Sync, /home/owner/KindaHealthyMobile, /home/owner/Recipe-App;
# re-derive: grep -o 'path="[^"]*"' ~/.local/state/syncthing/config.xml). Never move it inside one.
# A 307 MB rollback anchor once lived inside the repo and replicated to every machine; at ~1.4 GB a
# night, multiplied again by `simple` versioning keep=5, that mistake would be an order of magnitude
# worse. The off-box copy is PULLED by the Mac (launchd com.kindahealthy.pgbackup-pull), which is why
# this script only ever writes locally: a local dump is faster and cannot half-finish over a network.
#
# The history is the journal — `journalctl --user -u pg-backup` — which is why pg-backup.service
# deliberately does NOT redirect StandardOutput to a file the way the other four ops units do. Every
# line is ALSO appended to /home/owner/backups/pg-backup.log so the history survives a volatile
# journal.

set -u
set -o pipefail

DB=mealspire
CONTAINER=mealspire-db
DEST=/home/owner/backups
KEEP=7
# An OUTPUT guard, not a detector: refuse to promote a dump that cannot possibly be whole. The
# 2026-07-19 artifact is 1.41 GB against a 3,695 MB database, so 500 MB is far below any real dump
# and far above a truncated pipe. Guarding the output with an absolute number is legitimate;
# detecting with one is not.
MIN_BYTES=524288000
LOGFILE="$DEST/pg-backup.log"

log() {
  local line
  line="$(date '+%Y-%m-%d %H:%M:%S %Z') pg-backup: $*"
  echo "$line"
  echo "$line" >>"$LOGFILE" 2>/dev/null || true
}

mkdir -p "$DEST" || { echo "pg-backup: FAILED cannot create $DEST"; exit 1; }

OUT="$DEST/$DB-$(date +%Y-%m-%d).dump"
PART="$OUT.part"

log "start db=$DB -> $OUT"

# Docker may not be up yet on a Persistent=true catch-up after a boot, and a user unit cannot order
# itself after the system's docker.service. Ask the database instead of faking a dependency.
ready=no
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if docker exec "$CONTAINER" pg_isready -U postgres -d "$DB" >/dev/null 2>&1; then
    ready=yes
    break
  fi
  log "waiting for $CONTAINER to accept connections (attempt $attempt)"
  sleep 15
done
if [ "$ready" != yes ]; then
  log "FAILED $CONTAINER not ready after 10 attempts; no dump written"
  exit 1
fi

# Write to .part and rename only on success, so a half-written dump is never mistaken for a good one.
# A same-day re-run replaces that day's dump, which is intended: the file is named by date.
rm -f "$PART"
STARTED=$(date +%s)
if ! docker exec "$CONTAINER" pg_dump -U postgres -d "$DB" -Fc >"$PART"; then
  log "FAILED pg_dump exited non-zero; keeping $PART for inspection, NOT renaming"
  exit 1
fi
ELAPSED=$(($(date +%s) - STARTED))

BYTES=$(stat -c %s "$PART" 2>/dev/null || echo 0)
if [ "$BYTES" -lt "$MIN_BYTES" ]; then
  log "FAILED dump is $BYTES bytes, under the $MIN_BYTES floor; keeping $PART, NOT renaming"
  exit 1
fi

mv -f "$PART" "$OUT" || { log "FAILED could not rename $PART to $OUT"; exit 1; }
log "ok bytes=$BYTES elapsed=${ELAPSED}s file=$OUT"

# Prune ONLY after the new dump has renamed, oldest first. The glob cannot match a *.dump.part, so a
# failed run's leftover is never counted as a copy and never silently deleted.
stale=$(ls -1t "$DEST"/"$DB"-*.dump 2>/dev/null | tail -n +$((KEEP + 1)))
if [ -n "$stale" ]; then
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    rm -f "$f" && log "pruned $f"
  done <<<"$stale"
fi
log "retained $(ls -1 "$DEST"/"$DB"-*.dump 2>/dev/null | wc -l) of $KEEP"
