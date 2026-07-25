# Workflows

Multi-agent workflow scripts for the Claude Code `Workflow` tool. `Workflow({name})` resolves this
directory relative to the **session's cwd**, so invoking by name works from a session rooted in this
repo; from a session rooted in the mobile repo, pass `scriptPath` instead.

## triage-fix-classes.js — F4 of the funnel sprint

Turns a triage report into one systemic fix **per failure CLASS**, each behind its own eval gate.

```js
Workflow({
  name: 'triage-fix-classes',
  args: {
    report: 'scripts/eval/results/triage-verdicts-<ts>.json',  // from scripts/eval/triage-drops.ts
    backend: '/home/diego/Recipe-App',
    maxClasses: 4,
    dryRun: true,          // stops after the plan, before any code is written — start here
  },
})
```

**Prerequisite:** a report from `scripts/eval/triage-drops.ts` (F3). Generate one cheaply with
`--from-db --no-probes` first to see the class distribution before spending probe calls.

### Standing constraint

**Diego's decision, 2026-07-24: report-only nightly, fix-agents on manual trigger, no unattended
code-writing.** The nightly `flywheel-sweep.timer` may classify drops into a report; it must never invoke
this. Do not wire it in.

### Why one agent per class

A point fix touches data and is worth exactly one query — linear. A systemic fix touches the pipeline and
is worth the whole class it governs. The 2026-07-21 wave spent 123 triage agents converting 296 confirmed
defects into 141 repoints: a great deal of work that bought 141 queries and no leverage. Grouping by class
is what makes each agent's output category-sized.

### What it refuses to do, and why each guard exists

- **Only `fixKind: 'pipeline'` classes get a fix-agent.** `save_rejected:cross_source_margin` is 71% of all
  `save_rejected` events and is *incumbent protection* — structurally unable to fire on a cold key. Ranking
  by raw count aims the biggest agent at working code. `ingest` classes go to an ingest queue (no code
  change produces the right number); `data` classes to a repoint batch.
- **Ranks by leverage, not event count** — it reports events *and* distinct keys, because high-events /
  few-keys is a handful of queries being re-attempted while low-events / many-keys is systemic breadth.
- **A class with no named mechanism is excluded.** Not ready for a fix-agent.
- **Never plans against `scope` or declared-inert counts.** A zero there means "not looked at", not
  "looked and found none".
- **Fix preference order, stated to every agent:** admit-only relaxation → relative demotion / sort
  reorder → confidence suppression → absolute gate. An absolute gate sets `winner = null`, and the null
  path falls through to AI backfill at `grams ?? 100` — a differently wrong number, with the mostly-right
  candidate discarded.
- **Asks "does this INSERT or DISPLACE?"** Insert-only is a total blast-radius bound and is why funnel
  fix 4 shipped; displacing hot incumbents is why fix 3 was abandoned after two attempts.
- **`changed: false` is a first-class outcome.** A well-evidenced "don't do this" is valuable.
- **`pipeline()` not `parallel()`** — each class's gate runs the moment its own fix lands.
- Worktree isolation per fix-agent; gate port `3200 + i` so concurrent gates cannot collide.
- The synthesis agent is told to be **skeptical of the fix-agents' own reports** and to mark a class
  unverified when a `localTestOutput` or `evidence` field reads like a claim rather than pasted output.

### Safety rules inlined into every agent prompt

Not assumed — restated, because each has bitten before:

- the box is **deploy-only**; no git mutations beyond `fetch` / `merge --ff-only`, never `reset --hard`
- **never `pkill -f "next start"`** — it matches the live `recipe-api` and its own command line, and has
  taken the service down. Kill by port.
- `run-eval.ts` / `warm-cache.ts` **write to the shared production database** — `pg_dump` first, diff with
  a python dict compare, never `join` (collation silently drops rows)
- **a pull without `npm run build` deploys nothing** — `recipe-api` serves the prebuilt `.next`
- `master` is branch-protected; never push to it, never `gh pr merge`
- DB is `mealspire`; the confidence column is `aiConfidence`
