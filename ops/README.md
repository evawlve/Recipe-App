# Ops — OptiPlex server units

Systemd **user** units for the backend box (`owner@` on the OptiPlex, linger enabled).
The API itself (`recipe-api.service`) was configured by hand on the box; units here
are the ones the repo owns and deploys by copy.

## flywheel-sweep (nightly cache-accuracy loop, PR E / flywheel Phase 4)

Runs `scripts/eval/flywheel-sweep.ts` at 04:30 local:
telemetry mining (MappingEventLog) → warm run (standard corpus + top telemetry keys)
→ diff vs previous warm report → golden-set eval gate → markdown report published to
`sync-docs/flywheel-latest.md` (Syncthing carries it to the Mac/Windows machines).

Install / update on the box:

```bash
mkdir -p ~/.config/systemd/user
cp ~/Recipe-App/ops/systemd/flywheel-sweep.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now flywheel-sweep.timer
```

Check:

```bash
systemctl --user list-timers flywheel-sweep.timer
systemctl --user start flywheel-sweep.service   # manual run now
tail -f ~/Recipe-App/logs/flywheel-sweep.log
```

Notes:
- Node comes from nvm (`v24.18.0`) — same pinned PATH pattern as `recipe-api.service`.
  If the box's node version changes, update both unit files.
- The sweep exits non-zero when the eval gate finds real failures outside the
  allowlist (default `n-mq-10`); `systemctl --user status flywheel-sweep.service`
  will show it failed. The markdown report is still written first.
- The cold cache-parity sweep (`cache-parity-sweep.ts`) is deliberately NOT part of
  the timer: its `nocache=1` replay overwrites cache rows as a side effect. Run it
  manually, snapshot first (`pg_dump -t '"FoodMapping"'`).
