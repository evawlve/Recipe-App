import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

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

export async function GET() {
  return NextResponse.json({ ok: true, ts: Date.now(), buildId: readBuildId() });
}
