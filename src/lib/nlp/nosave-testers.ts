/**
 * `nosave=1` for TESTER accounts — who may ask /api/nlp/parse not to persist what it computed.
 *
 * WHY THIS EXISTS (2026-08-23, plan 11 §4, Diego's D2). `nosave` used to be honoured only for
 * `isDevBypass` callers — the dev key and the email allowlist that also skips rate limiting.
 * H3 (#369) removed the shared `google_test_user@kindahealthy.com` account from that allowlist
 * so it becomes a normal rate-limited user, which is right for auth and wrong for device
 * sittings: a sitting signed in as that account would then WRITE `FoodMapping` rows for every
 * probe line it types (the mobile `EXPO_PUBLIC_SUPPRESS_MAPPING_WRITES=1` switch only appends
 * `nosave=1`; it cannot make the server honour it). Session 6 of Lane B measured exactly that:
 * a fresh real account wrote 3 rows under suppression.
 *
 * WHAT THIS IS NOT. Membership here grants ONE thing — the request-scoped write policy behind
 * `nosave=1`. It is not a rate-limit bypass, not `noCache`, not the debug echo; those stay on
 * `isDevBypass`. A tester is counted and charged like any other bearer user.
 *
 * SHAPE. `NOSAVE_TESTER_EMAILS` — comma-separated EXACT addresses, compared case-insensitively
 * after trimming, read per request (edit + restart, no rebuild — same as the parse limits).
 * Unset or empty ⇒ nobody beyond `isDevBypass` (fail-closed). No domain suffixes and no
 * substring matching on purpose: the parse route's own bypass lost its `'test'`/`'dev'` substring
 * checks on 2026-08-20 because a real user whose address contained either skipped rate limiting
 * (doc-check claim `dev-bypass-email-substring-removed`).
 */

export function readNoSaveTesters(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.NOSAVE_TESTER_EMAILS ?? '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0 && s.includes('@')),
  );
}

export function isNoSaveTester(
  email: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!email) return false;
  return readNoSaveTesters(env).has(email.trim().toLowerCase());
}
