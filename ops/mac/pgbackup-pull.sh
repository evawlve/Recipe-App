#!/bin/bash
#
# Pull the box's newest mealspire dump to the Mac — punch #233, Lane A S53 (2026-09-21) — then copy
# it off-site to Backblaze B2 — punch #248, and retry a cut transfer — punch #253, Lane A S55
# (2026-09-22).
# Driven by launchd: ops/mac/com.kindahealthy.pgbackup-pull.plist, 06:15 local.
#
# WHY THE MAC AND NOT THE WINDOWS PC. The Mac joined the tailnet on 2026-09-14, so this pull works
# from anywhere over the MagicDNS name. The Windows PC is not a documented tailnet node, which would
# tie the off-box copy to both machines being on the home LAN.
#
# WHY THE MAGICDNS NAME FIRST. 192.168.1.133 only works at home, and a 100.x literal NAT64s away on an
# IPv6-only network (memory `mac-env-points-at-tailnet-ip`). The FQDN below is the one address that
# resolves on the home LAN, on tethered data and behind someone else's Wi-Fi. The LAN IP is used ONLY
# as a fallback, and only when the tailnet never answered AND port 22 on the LAN IP does.
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
# SLEEP, AND WHAT THIS SCRIPT CAN AND CANNOT DO ABOUT IT (#253). On 2026-09-22 the Mac had
# hibernated at 1 % battery the evening before; launchd fired the missed 06:15 run on the 08:16 AC
# wake, both ssh reads answered, scp began, and the Mac went back to 'Low Power Sleep' at 1 % 70 s
# later, cutting the transfer mid-file. So:
#   - the whole run holds `caffeinate -i -w $$`, which holds off IDLE sleep until the script exits —
#     pre-flight gaps and backoffs included (the AC idle timer here is `sleep 1` minute per
#     `pmset -g custom`);
#   - a cut transfer is retried up to 3 times, each a FRESH scp connection after a 30 s / 60 s
#     backoff, with the .part discarded between attempts; the two ssh reads (list, sha256) are retried
#     the same way; ServerAlive options make a dead session fail in about a minute instead of hanging;
#   - LOW-BATTERY SLEEP AND A CLOSED LID ARE NOT PREVENTABLE by any assertion. A laptop asleep at
#     06:15 misses the run and launchd fires it on the next wake; that is acceptable and deliberate,
#     because the box's own 7 nightly copies are the primary.
# On final failure exactly one line names the cause: `tailnet down`, `transfer cut` or `sha mismatch`.
#
# THE OFF-SITE COPY (#248). After the local copy is verified (whether pulled now or already held),
# the newest dump is copied with rclone's native b2 backend to b2:$B2_BUCKET/mealspire/, its sha1 is
# compared against the local file's, and the remote is pruned to the newest 7 by name with
# `--b2-hard-delete` (a plain delete leaves a hidden version that still bills). The credentials come
# from /Users/diego/dev/Secrets/b2.env (mode 600), sourced inside a subshell and handed to rclone as
# RCLONE_CONFIG_B2_* environment variables — so no rclone.conf ever holds the key, and nothing under
# either repo or any Syncthing folder does. Every rclone output line passes through redact(), which
# replaces the two key values with <redacted> before anything is echoed or logged. The bucket NAME is
# not a secret and does appear in the log. rclone is called by ABSOLUTE path: launchd agents get
# PATH /usr/bin:/bin:/usr/sbin:/sbin, which lacks /opt/homebrew/bin. The env file is sourced with
# stderr discarded (a malformed line would echo the key) and xtrace forced off. An off-site failure
# (upload, sha1, a failed hard-delete) never touches a local copy (it runs after local retention) and
# exits 3, distinct from a pull failure (1). The newest dump is chosen by NAME on both ends.

set -u

BOX_USER=owner
BOX_TAILNET=dhl32-opt-5060.tail9ae316.ts.net
BOX_LAN=192.168.1.133
SRC_DIR=/home/owner/backups
DEST=/Users/diego/backups/mealspire
KEEP=3
LOG="$DEST/pgbackup-pull.log"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=30 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)

PREFLIGHT_TRIES=5
PREFLIGHT_GAP=60
TRANSFER_TRIES=3
BACKOFF=(30 60 120)

B2_ENV=/Users/diego/dev/Secrets/b2.env
RCLONE=/opt/homebrew/bin/rclone
REMOTE_KEEP=7

log() {
  local line
  line="$(date '+%Y-%m-%d %H:%M:%S %Z') pgbackup-pull: $*"
  echo "$line"
  echo "$line" >>"$LOG" 2>/dev/null || true
}

mkdir -p "$DEST" || { echo "pgbackup-pull: FAILED cannot create $DEST"; exit 1; }

# One idle assertion for the WHOLE run, released when this script exits — so the pre-flight gaps, the
# backoffs and the sha reads are held too, not only the transfers.
caffeinate -i -w $$ &

# A read from the box, retried like the transfer: up to TRANSFER_TRIES fresh ssh connections.
ssh_read() {
  local out t
  for ((t = 1; t <= TRANSFER_TRIES; t++)); do
    out=$(ssh "${SSH_OPTS[@]}" "$BOX_USER@$BOX" "$1" 2>/dev/null)
    if [ -n "$out" ]; then
      echo "$out"
      return 0
    fi
    [ "$t" -lt "$TRANSFER_TRIES" ] && sleep "${BACKOFF[$((t - 1))]}"
  done
  return 1
}

# --- Pre-flight: wait, bounded, for the box over the tailnet; the LAN IP only as a fallback. -------
BOX=""
WAIT_START=$(date +%s)
for ((i = 1; i <= PREFLIGHT_TRIES; i++)); do
  if ssh -o ConnectTimeout=10 -o BatchMode=yes "$BOX_USER@$BOX_TAILNET" true 2>/dev/null; then
    BOX=$BOX_TAILNET
    break
  fi
  [ "$i" -lt "$PREFLIGHT_TRIES" ] && sleep "$PREFLIGHT_GAP"
done
if [ -z "$BOX" ] && nc -z -w 2 "$BOX_LAN" 22 2>/dev/null; then
  BOX=$BOX_LAN
fi
WAITED=$(($(date +%s) - WAIT_START))
if [ -z "$BOX" ]; then
  log "FAILED cause=tailnet down — $BOX_TAILNET did not answer ssh in $PREFLIGHT_TRIES tries over ${WAITED}s and $BOX_LAN:22 is closed"
  exit 1
fi
log "preflight: $BOX answered after ${WAITED}s"

# Newest by NAME (the names are date-stamped), the same order the remote prune keeps by — so a touched
# mtime can never make this run upload a name that the prune then hard-deletes.
NEWEST=$(ssh_read "ls -1 $SRC_DIR/mealspire-*.dump 2>/dev/null | sort | tail -1")
if [ -z "${NEWEST:-}" ]; then
  log "FAILED cause=tailnet down — no dump listed on $BOX after $TRANSFER_TRIES tries (or pg-backup has not run)"
  exit 1
fi
BASE=$(basename "$NEWEST")

REMOTE_SHA=$(ssh_read "sha256sum $NEWEST" | awk '{print $1}')
if [ -z "${REMOTE_SHA:-}" ]; then
  log "FAILED cause=tailnet down — could not read the box's sha256 for $BASE after $TRANSFER_TRIES tries"
  exit 1
fi

PULLED=0
if [ -f "$DEST/$BASE" ] && [ "$(shasum -a 256 "$DEST/$BASE" | awk '{print $1}')" = "$REMOTE_SHA" ]; then
  log "already holding $BASE, sha matches the box; nothing to pull"
else
  [ -f "$DEST/$BASE" ] && log "$BASE is present but its sha differs from the box's; re-pulling"

  # --- The transfer: up to TRANSFER_TRIES fresh scp connections, each under an idle assertion. ----
  PART="$DEST/$BASE.part"
  CAUSE=""
  for ((a = 1; a <= TRANSFER_TRIES; a++)); do
    rm -f "$PART"
    STARTED=$(date +%s)
    if caffeinate -i scp -q "${SSH_OPTS[@]}" "$BOX_USER@$BOX:$NEWEST" "$PART"; then
      ELAPSED=$(($(date +%s) - STARTED))
      LOCAL_SHA=$(shasum -a 256 "$PART" | awk '{print $1}')
      if [ "$LOCAL_SHA" = "$REMOTE_SHA" ]; then
        CAUSE=""
        break
      fi
      CAUSE="sha mismatch"
      log "attempt $a/$TRANSFER_TRIES: sha mismatch on $BASE box=$REMOTE_SHA mac=$LOCAL_SHA; discarding"
    else
      CAUSE="transfer cut"
      log "attempt $a/$TRANSFER_TRIES: scp of $BASE failed after $(($(date +%s) - STARTED))s; discarding the partial file"
    fi
    rm -f "$PART"
    if [ "$a" -lt "$TRANSFER_TRIES" ]; then
      sleep "${BACKOFF[$((a - 1))]}"
    fi
  done
  if [ -n "$CAUSE" ]; then
    log "FAILED cause=$CAUSE — $BASE not pulled after $TRANSFER_TRIES attempts"
    exit 1
  fi

  BYTES=$(stat -f %z "$PART" 2>/dev/null || echo 0)
  mv -f "$PART" "$DEST/$BASE" || { log "FAILED could not rename $PART"; exit 1; }
  log "ok $BASE bytes=$BYTES elapsed=${ELAPSED}s attempt=$a sha=$LOCAL_SHA (matches the box)"
  PULLED=1
fi

# Prune only after the new copy has renamed, oldest first; the glob cannot match a *.dump.part.
if [ "$PULLED" = 1 ]; then
  stale=$(ls -1t "$DEST"/mealspire-*.dump 2>/dev/null | tail -n +$((KEEP + 1)))
  if [ -n "$stale" ]; then
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      rm -f "$f" && log "pruned $f"
    done <<<"$stale"
  fi
  log "retained $(ls -1 "$DEST"/mealspire-*.dump 2>/dev/null | wc -l | tr -d ' ') of $KEEP"
fi

# --- The off-site copy. Runs in a subshell so the key never reaches this shell's environment. -------
(
  { set +x; } 2>/dev/null   # a hand run under `bash -x` must not trace the key exports below
  if [ ! -x "$RCLONE" ]; then
    log "offsite FAILED rclone not installed at $RCLONE"
    exit 3
  fi
  if [ ! -r "$B2_ENV" ]; then
    log "offsite FAILED cannot read $B2_ENV"
    exit 3
  fi
  set -a
  # stderr to /dev/null: a malformed line would otherwise be echoed, key and all, into the launchd log.
  # shellcheck disable=SC1090
  . "$B2_ENV" 2>/dev/null || { set +a; log "offsite FAILED cannot parse $B2_ENV"; exit 3; }
  set +a
  if [ -z "${B2_KEY_ID:-}" ] || [ -z "${B2_APP_KEY:-}" ] || [ -z "${B2_BUCKET:-}" ]; then
    log "offsite FAILED $B2_ENV is missing B2_KEY_ID, B2_APP_KEY or B2_BUCKET"
    exit 3
  fi
  export RCLONE_CONFIG=/dev/null   # no config file at all: the remote lives only in these variables
  export RCLONE_CONFIG_B2_TYPE=b2
  export RCLONE_CONFIG_B2_ACCOUNT="$B2_KEY_ID"
  export RCLONE_CONFIG_B2_KEY="$B2_APP_KEY"
  REMOTE="b2:$B2_BUCKET/mealspire"

  # Replace both key values in every line before it is echoed or logged (bash builtins only, so
  # neither value ever appears in a process's argv).
  redact() {
    local l
    while IFS= read -r l; do
      l="${l//"$B2_APP_KEY"/<redacted>}"
      l="${l//"$B2_KEY_ID"/<redacted>}"
      log "rclone: $l"
    done
  }

  UP_START=$(date +%s)
  # --checksum: compare by size + sha1, never mtime. A re-pull gives the local file a new mtime, and
  # without this rclone re-uploads identical bytes as a second B2 version (measured 2026-09-22).
  if caffeinate -i "$RCLONE" copy --checksum "$DEST/$BASE" "$REMOTE/" 2>&1 | redact; [ "${PIPESTATUS[0]}" -ne 0 ]; then
    log "offsite FAILED cause=upload failed — $BASE to $REMOTE/ after $(($(date +%s) - UP_START))s"
    exit 3
  fi
  UP_SECS=$(($(date +%s) - UP_START))

  LOCAL_SHA1=$(shasum -a 1 "$DEST/$BASE" | awk '{print $1}')
  REMOTE_SHA1=$("$RCLONE" hashsum sha1 "$REMOTE/" --include "$BASE" 2>/dev/null | awk '{print $1}')
  if [ "$LOCAL_SHA1" != "$REMOTE_SHA1" ]; then
    log "offsite FAILED cause=sha1 mismatch on $BASE local=$LOCAL_SHA1 remote=${REMOTE_SHA1:-none}"
    exit 3
  fi
  REMOTE_BYTES=$("$RCLONE" lsl "$REMOTE/" --include "$BASE" 2>/dev/null | awk '{print $1}')
  log "offsite ok $BASE bytes=${REMOTE_BYTES:-?} elapsed=${UP_SECS}s sha1=$LOCAL_SHA1 (matches the local copy) -> $REMOTE/"

  # Prune the remote to the newest REMOTE_KEEP by name (the names sort by date), hard-deleting.
  remote_stale=$("$RCLONE" lsf "$REMOTE/" --include 'mealspire-*.dump' 2>/dev/null | sort -r | tail -n +$((REMOTE_KEEP + 1)))
  PRUNE_FAILED=0
  if [ -n "$remote_stale" ]; then
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      if "$RCLONE" deletefile --b2-hard-delete "$REMOTE/$f" 2>&1 | redact; [ "${PIPESTATUS[0]}" -eq 0 ]; then
        log "offsite hard-deleted $f"
      else
        log "offsite FAILED could not hard-delete $f"
        PRUNE_FAILED=1
      fi
    done <<<"$remote_stale"
  fi
  VERSIONS=$("$RCLONE" lsf --b2-versions "$REMOTE/" 2>/dev/null | wc -l | tr -d ' ')
  log "offsite retained $VERSIONS object version(s) under $REMOTE/ (cap $REMOTE_KEEP)"
  # Only a same-name upload of DIFFERENT bytes (a box re-dump on the same day) can leave an old
  # version behind; say so rather than delete it — `rclone cleanup` reports itself bucket-wide.
  if [ "$VERSIONS" -gt "$REMOTE_KEEP" ]; then
    log "offsite WARN $VERSIONS versions exceed the cap of $REMOTE_KEEP — an old version of a re-uploaded name is billing"
  fi
  [ "$PRUNE_FAILED" = 0 ] || exit 3
)
exit $?
