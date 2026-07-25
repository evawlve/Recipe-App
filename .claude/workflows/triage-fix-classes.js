export const meta = {
  name: 'triage-fix-classes',
  description: 'Turn a triage report into one systemic fix per failure CLASS, each behind its own eval gate',
  whenToUse:
    'MANUAL TRIGGER ONLY, after scripts/eval/triage-drops.ts has produced a report. Diego\'s standing '
    + 'decision (2026-07-24): the nightly sweep classifies drops report-only; fix-agents run only when a '
    + 'human asks. Never wire this into flywheel-sweep.timer. Pass args: '
    + '{ report: "<path to triage-verdicts-*.json>", maxClasses?: number, dryRun?: boolean }',
  phases: [
    { title: 'Plan', detail: 'group drops by class, drop the ones no code change can fix' },
    { title: 'Fix', detail: 'one agent per CLASS, each in its own git worktree' },
    { title: 'Gate', detail: 'per-branch eval gate on an isolated box server' },
    { title: 'Synthesis', detail: 'what to merge, in what order, and what to leave alone' },
  ],
}

// ---------------------------------------------------------------------------
// Why one agent per CLASS and not per query
//
// A point fix touches data and is worth exactly one query — linear. A systemic fix
// touches the pipeline and is worth the whole class it governs. The 2026-07-21 wave
// spent 123 triage agents to convert 296 confirmed defects into 141 repoints: a huge
// amount of work that bought 141 queries and no leverage. Grouping by class is what
// makes each agent's output a category-sized win instead.
// ---------------------------------------------------------------------------

const BACKEND = '/home/diego/Recipe-App'  // overridden by args.backend; see resolveBackend()

function resolveBackend() {
  return (args && args.backend) || BACKEND
}

const report = (() => {
  if (!args || !args.report) {
    throw new Error('args.report is required — path to a triage-verdicts-*.json from scripts/eval/triage-drops.ts')
  }
  return args.report
})()

const MAX_CLASSES = (args && args.maxClasses) || 4
const DRY_RUN = !!(args && args.dryRun)

phase('Plan')

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['classes', 'excluded', 'totalDrops'],
  properties: {
    totalDrops: { type: 'number' },
    classes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['classId', 'title', 'fixKind', 'dropCount', 'distinctKeys', 'exemplars', 'hypothesis'],
        properties: {
          classId: { type: 'string' },
          title: { type: 'string' },
          fixKind: { type: 'string', enum: ['pipeline', 'data', 'ingest', 'healthy'] },
          dropCount: { type: 'number' },
          distinctKeys: { type: 'number' },
          exemplars: { type: 'array', items: { type: 'string' } },
          hypothesis: { type: 'string' },
          goldenCaseIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    excluded: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['classId', 'fixKind', 'reason'],
        properties: { classId: { type: 'string' }, fixKind: { type: 'string' }, reason: { type: 'string' }, dropCount: { type: 'number' } },
      },
    },
  },
}

const plan = await agent(
  `Read the triage report at ${report} (in the backend repo at ${resolveBackend()}, or as an absolute path).

The report already carries what you need — do NOT re-derive it from the raw rows:
  byFailureClass    class id -> dossier count
  byFixKind         'pipeline' | 'data' | 'ingest' | 'healthy' -> count
  confirmed[]       each with classId, fixKind, cls, action, targetId, note, dossier
  scope             which classes/buckets this tool structurally cannot see (see below)
  withheldTargetCount  repoint suggestions whose target apply-repoints.ts cannot consume
  caveats / log     what the run could not show, and anything it truncated

Cross-reference \`scripts/eval/failure-classes.ts\` for each class's title, description, status and
goldenCaseIds. Read the \`FUNNEL_CAVEATS\` array there too — several facts in it (a dead 'error' stage, an
fdc displacement bypass, three shadowing singularize copies) are things no row can reveal.

TWO THINGS THE REPORT TELLS YOU THAT MUST NOT BE READ AS ABSENCE:
- \`scope\` lists classes and coarse buckets that are out of reach for triage-drops by construction — a
  zero there means "not looked at", not "looked and found none". Never plan against those counts.
- the caveats may declare classes INERT for the input mode used (e.g. an Atwater-based arm is dark on
  --from-db, which stores no macros). Same rule.

Produce a fix plan. Rules that matter:

1. **Only \`fixKind: 'pipeline'\` classes may get a fix-agent.** Exclude the rest, and say why:
   - \`healthy\` — the drop is correct behaviour. \`save_rejected:cross_source_margin\` is the canonical
     example: it is 71% of all save_rejected events and it is incumbent protection, structurally unable
     to fire on a cold key. Sending an agent at it means sending an agent at working code.
   - \`ingest\` — no record exists in any lane. No pipeline change produces the right number; these belong
     in an ingest queue.
   - \`data\` — a repoint/evict on specific rows. Real work, but not a code change; list it for a data batch.

2. **Rank by leverage, not by raw event count.** Report BOTH \`dropCount\` (events) and \`distinctKeys\`.
   A high event count over few keys is a handful of queries being re-attempted; a low count over many
   keys is a broad systemic shape. The second is worth more per unit of code.

3. For each included class give a \`hypothesis\`: the specific mechanism you believe causes it, grounded in
   the dossiers in the report. If you cannot name a mechanism, say so — a class with no hypothesis is not
   ready for a fix-agent and should be excluded.

4. Include \`goldenCaseIds\` where the report or the registry names regression pins.

Return at most ${MAX_CLASSES} included classes, highest leverage first.`,
  { label: 'plan:group-by-class', phase: 'Plan', schema: PLAN_SCHEMA },
)

if (!plan || !plan.classes || plan.classes.length === 0) {
  log('No pipeline-fixable classes in this report — nothing to do. That is a valid outcome: it means the '
    + 'remaining drops are data/ingest work or correct behaviour.')
  return { plan, fixes: [], note: 'no pipeline-fixable classes' }
}

log(`${plan.totalDrops} drops -> ${plan.classes.length} pipeline-fixable classes, ${plan.excluded.length} excluded`)
for (const e of plan.excluded) log(`  excluded ${e.classId} (${e.fixKind}): ${e.reason}`)
if (DRY_RUN) {
  log('dryRun — stopping before any code is written.')
  return { plan, fixes: [], note: 'dry run' }
}

// ---------------------------------------------------------------------------

const FIX_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['classId', 'changed', 'summary', 'filesTouched', 'testsAdded', 'localTestOutput', 'risks'],
  properties: {
    classId: { type: 'string' },
    changed: { type: 'boolean', description: 'false when investigation concluded no change should be made' },
    summary: { type: 'string' },
    filesTouched: { type: 'array', items: { type: 'string' } },
    testsAdded: { type: 'array', items: { type: 'string' } },
    localTestOutput: { type: 'string', description: 'actual jest + tsc output, not a claim about it' },
    branch: { type: 'string' },
    worktree: { type: 'string' },
    risks: { type: 'array', items: { type: 'string' } },
    negativeResult: { type: 'string', description: 'if changed=false, what was tried and why it was abandoned' },
  },
}

const GATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['classId', 'verdict', 'realFailures', 'knownIssues', 'evidence'],
  properties: {
    classId: { type: 'string' },
    verdict: { type: 'string', enum: ['pass', 'fail', 'not-run'] },
    realFailures: { type: 'number' },
    knownIssues: { type: 'number' },
    driftedPins: { type: 'array', items: { type: 'string' } },
    cacheDiff: { type: 'string', description: 'added/removed/changed row counts from the FoodMapping diff' },
    evidence: { type: 'string', description: 'the actual tail of the eval output' },
    regressions: { type: 'array', items: { type: 'string' } },
  },
}

const SAFETY = `
=== HARD SAFETY RULES — violating any of these has broken production before ===

1. The box (owner@192.168.1.133) is DEPLOY-ONLY. Never run git mutations there beyond
   \`fetch\` and \`merge --ff-only\`. Never \`git reset --hard\` — the box carries untracked keepers.
2. NEVER \`pkill -f "next start"\`. It matches the live \`recipe-api\` AND its own command line, and it
   has taken the live service down. Kill by port:
     PID=$(ss -lptn "sport = :PORT" | grep -o "pid=[0-9]*" | head -1 | cut -d= -f2); kill $PID
3. \`run-eval.ts\` and \`warm-cache.ts\` WRITE TO THE SHARED PRODUCTION DATABASE. Always
   \`pg_dump\` the FoodMapping table first, and diff before/after with a python dict compare —
   never \`join\`, which silently drops rows to collation.
4. A source pull + restart DEPLOYS NOTHING. \`recipe-api\` runs \`next start\` against the prebuilt
   \`.next\`, so you must \`npm run build\` before restarting or you are testing old code.
5. Backend \`master\` is branch-protected. Never push to it. Never call \`gh pr merge\`.
6. DB is \`mealspire\` (not recipe_app). The confidence column is \`aiConfidence\` (not confidence).

=== The gate recipe that does NOT touch the deployed tree ===
  rsync -a --exclude node_modules --exclude .next --exclude .git <worktree>/ owner@192.168.1.133:/tmp/<gate>/
  ssh: cp -al /home/owner/Recipe-App/node_modules /tmp/<gate>/node_modules && cp /home/owner/Recipe-App/.env /tmp/<gate>/
  ssh: cd /tmp/<gate> && npx prisma generate && npm run build
  ssh: cd /tmp/<gate> && setsid nohup env PORT=<port> npm run start > /tmp/<gate>-server.log 2>&1 < /dev/null &
  ssh: npx ts-node --compiler-options '{"module":"commonjs"}' -r tsconfig-paths/register \\
         scripts/eval/run-eval.ts --base http://localhost:<port>
  then kill by port as in rule 2.
`

phase('Fix')

// pipeline(), not parallel() — each class's gate runs the moment ITS fix lands, rather than
// waiting for the slowest fix in the batch. No stage here needs cross-class context.
const results = await pipeline(
  plan.classes,

  // Stage 1 — one fix-agent per class, isolated so concurrent edits cannot collide.
  (cls, _orig, i) => agent(
    `You are fixing ONE failure class in the Mealspire ingredient mapper. Backend repo: ${resolveBackend()}.

CLASS: ${cls.classId} — ${cls.title}
Observed: ${cls.dropCount} events over ${cls.distinctKeys} distinct keys.
Exemplar queries: ${cls.exemplars.join(' | ')}
Working hypothesis from triage: ${cls.hypothesis}
Regression pins: ${(cls.goldenCaseIds || []).join(', ') || '(none named)'}

Triage report with full dossiers: ${report}

${SAFETY}

YOUR JOB — a SYSTEMIC fix, i.e. one change that governs the whole class, not ${cls.distinctKeys} data edits.

Method, in this order:
1. **Reproduce first, from the dossiers.** Confirm the hypothesis against at least two exemplars before
   writing anything. If the dossiers contradict it, say so and re-diagnose — a plausible, internally
   consistent diagnosis has been wrong three times on this codebase, and each time only running the
   actual pipeline stage and printing its output settled it. Inferring pool composition from hit counts
   is not evidence.
2. **Check whether the data already contains the answer** before building an estimator or a lexicon.
   The single highest-value fix in this project's history (PR #145) came from noticing that FatSecret's
   synthetic "100 g" panel is an invertible weight oracle, validated on 24,579 rows where the truth was
   already recorded. That replaced a whole planned beverage-lexicon feature with one SQL query.
3. **Prefer, strictly in this order:** admit-only relaxation > relative demotion / sort reorder >
   confidence suppression > absolute gate. An absolute gate that rejects a winner sets \`winner = null\`,
   and the null path falls through to AI backfill at \`grams ?? 100\` — turning a silently wrong number
   into a differently wrong number while discarding the candidate that was mostly right.
4. **Ask whether your change INSERTS or DISPLACES.** Insert-only is a total blast-radius bound and is why
   funnel fix 4 shipped; letting a gate displace hot incumbents is why funnel fix 3 was abandoned after
   two attempts.
5. Add unit tests that pin the class, including at least one case the fix must NOT touch.
6. Run \`npx jest\` and \`npx tsc --noEmit\`. Paste the REAL output into localTestOutput.

If you conclude no change should be made, set changed=false and write up the negative result. A
well-evidenced "don't do this" is a valid and valuable outcome — fix 3's abandonment is one of the most
useful records in this project.

Do NOT push, do NOT open a PR, do NOT merge, do NOT deploy. Commit to your worktree branch only.
Name your branch fix/class-${i + 1}-<short-slug> and report both branch and worktree path.`,
    { label: `fix:${cls.classId}`, phase: 'Fix', schema: FIX_SCHEMA, isolation: 'worktree' },
  ),

  // Stage 2 — gate that class's branch alone, on its own port so gates cannot collide.
  (fix, cls, i) => {
    if (!fix || !fix.changed) {
      log(`${cls.classId}: no change made — skipping gate`)
      return { classId: cls.classId, verdict: 'not-run', realFailures: -1, knownIssues: -1, evidence: fix?.negativeResult ?? 'no fix produced' }
    }
    return agent(
      `Gate ONE branch of the Mealspire backend against the golden-set eval, then report honestly.

CLASS: ${cls.classId}
Branch: ${fix.branch}
Worktree: ${fix.worktree}
Files touched: ${(fix.filesTouched || []).join(', ')}

${SAFETY}

Use gate directory /tmp/gate-cls${i + 1} and PORT ${3200 + i}. Steps:
1. \`pg_dump\` the FoodMapping table to /tmp/fm-pre-cls${i + 1}.sql BEFORE anything else.
2. rsync the worktree, hardlink node_modules, copy .env, prisma generate, npm run build.
3. Start the gate server on PORT ${3200 + i}. Verify /api/ok returns 200 before proceeding.
4. Run run-eval.ts --base http://localhost:${3200 + i}. Run it TWICE — a single run has passed while
   the second exposed nondeterminism.
5. Diff FoodMapping before/after with a python dict compare on normalizedForm -> (source, offBarcode,
   fdcId, fsId, foodName). Report added/removed/changed counts. The eval writes to the shared DB, so a
   nonzero diff is expected but must be UNDERSTOOD, not waved through.
6. Report any 🟠 knownIssue DRIFT lines — a pinned case that keeps failing but fails DIFFERENTLY is a
   regression the pass/fail count cannot show.
7. Kill the gate server BY PORT.

verdict = 'pass' only if BOTH runs show 0 real failures and you can account for every cache diff and every
drifted pin. Quote the actual eval tail in \`evidence\`. Do not merge, do not deploy, do not push.`,
      { label: `gate:${cls.classId}`, phase: 'Gate', schema: GATE_SCHEMA },
    )
  },
)

phase('Synthesis')

const pairs = plan.classes.map((cls, i) => ({ cls, outcome: results[i] }))
const passed = pairs.filter(p => p.outcome && p.outcome.verdict === 'pass')
log(`${passed.length}/${plan.classes.length} classes gated green`)

const synthesis = await agent(
  `Summarise a class-by-class fix run on the Mealspire mapper for a human who will decide what to merge.

PLAN:
${JSON.stringify(plan, null, 2)}

OUTCOMES:
${JSON.stringify(pairs.map(p => ({ classId: p.cls.classId, title: p.cls.title, gate: p.outcome })), null, 2)}

Write markdown with:
1. **Merge in this order, or don't** — one line per class: merge / hold / abandon, with the reason. Order
   matters: put the narrowest, most clearly-bounded change first so that if something breaks later the
   bisect is short.
2. **What each fix actually buys**, in queries or in class breadth. Be concrete; "improves matching" is
   not an answer.
3. **Negative results worth keeping** — any class where the right answer turned out to be "don't". Say what
   was tried and why it was abandoned, in enough detail that nobody repeats it.
4. **Excluded classes and where they went** — data classes to a repoint batch, ingest classes to an ingest
   queue, healthy classes recorded as by-design so they stop reading as defects.
5. **What is still unmeasured.** Anything a gate could not settle.

Be skeptical of the fix-agents' own reports. If a localTestOutput or an evidence field looks like a claim
rather than pasted output, say so and mark that class as unverified.`,
  { label: 'synthesis', phase: 'Synthesis', effort: 'high' },
)

return {
  plan,
  outcomes: pairs.map(p => ({ classId: p.cls.classId, gate: p.outcome })),
  gatedGreen: passed.map(p => p.cls.classId),
  synthesis,
}
