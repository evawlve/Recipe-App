import { NextResponse, type NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { getLlmUsageSnapshot } from '@/lib/ai/llm-usage-metrics';
import { authenticateRequest } from '@/lib/auth/request-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * The deployed build's id, so a measurement taken against this API can record WHICH code
 * produced it. Without it an eval results file carries `base` and `noCache` but nothing
 * identifying the build, and two runs spanning a deploy are indistinguishable from two runs of
 * one build — which is how a deploy's effect gets recorded as "noise". Measured 2026-08-03: the
 * 08-02 23:50 / 08-03 00:48 cold pair reads as a clean 10-case noise floor, and two of those ten
 * are PR #226 landing between the runs.
 *
 * Read once per process and memoised — BUILD_ID cannot change without a restart. Fails soft to
 * null (Vercel serves from a different layout with no readable .next/BUILD_ID). A null is honest;
 * a confidently wrong id would be worse than none.
 */
let buildIdCache: string | null | undefined;
function readBuildId(): string | null {
  if (buildIdCache !== undefined) return buildIdCache;
  try {
    buildIdCache = fs.readFileSync(path.join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim() || null;
  } catch {
    buildIdCache = null;
  }
  return buildIdCache;
}

/**
 * Health probe, and — since Phase 0.5(c) — the READ SIDE of the LLM usage counters.
 *
 * Three properties of this response shape are deliberate:
 *
 * 1. `ok` / `ts` / `buildId` are UNCONDITIONAL and unchanged. The deploy-verification `curl` and
 *    the #232 buildId reader keep working byte-for-byte.
 *
 * 2. `llm` is ALWAYS PRESENT. An absent `llm` means an old build; `llm.authorized === false` means
 *    the key was wrong. Neither is confusable with "zero calls" — which is the whole point, given
 *    that a zeroed instrument reading as a measurement is this repo's most repeated defect.
 *
 * 3. It reuses the EXISTING `DEV_API_KEY` check — now through the shared
 *    `authenticateRequest()` chokepoint, the same one the key-only routes use. Since 2026-08-20
 *    that check FAILS CLOSED: no fallback literal, so an unset/empty `DEV_API_KEY` reads
 *    `authorized: false` rather than authorizing a committed string. A new env var would still
 *    be a var the box does not have — which is exactly how 0.5(a)'s instrument went silent — and
 *    would make this counter structurally unreadable on the box on day one.
 *
 * 4. `auth` is ALWAYS PRESENT and ADDITIVE: `{ via: 'key' | 'bearer' }` or
 *    `{ via: null, reason }`. It answers "did my credential authenticate, and as what" without
 *    a 401 — the post-deploy check for the bearer path is this field, not a guess from a 200.
 *    Only `via: 'key'` unlocks `llm`; a bearer is reported, never trusted with the counters.
 *    No userId or email goes on the wire. COST: a probe that carries a bearer now pays one
 *    GoTrue round trip; the unauthenticated and key-only probes pay nothing, as before.
 *
 * Counters and `buildId` come back in ONE response, so a counter can never be attributed to the
 * wrong build. Same reason #232 exists.
 *
 * READ RECIPE: two reads are a delta only if `since`, `pid` AND `buildId` are identical on both.
 * Any difference means the process restarted or the build changed — throw the measurement away.
 * On Vercel the counters are per-lambda and short-lived; `since`/`pid` make that visible rather
 * than misleading, but a Vercel read must never be quoted as a fleet number.
 *
 * `console.log` is DROPPED on the box, so grepping `next-start.log` is not a way to check whether
 * the counter works. This route is the only correct read.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateRequest(req, { accept: ['key', 'bearer'] });
  const authorized = auth.via === 'key';
  return NextResponse.json({
    ok: true,
    ts: Date.now(),
    buildId: readBuildId(),
    llm: authorized ? { authorized: true, ...getLlmUsageSnapshot() } : { authorized: false },
    auth: auth.via ? { via: auth.via } : { via: null, reason: auth.reason },
  });
}
