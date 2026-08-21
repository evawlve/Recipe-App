import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The server-side Supabase client used to VALIDATE a caller's bearer token
 * (`auth.getUser(jwt)`). It is not a cookie session client — that is
 * `createSupabaseServerClient()` in ./server.ts — and it carries no request state.
 *
 * Built lazily on first use and memoised ON SUCCESS ONLY. Two reasons:
 *  - `/api/nlp/parse` used to call `createClient()` at MODULE SCOPE with the env
 *    read once into `''` fallbacks, so a process without the Supabase env threw at
 *    import (supabase-js refuses an empty URL) and every bearer request in it was
 *    dead on arrival. Lazy + null means such a process still serves the dev-key path
 *    and reports `auth_unavailable` for bearers instead of failing to load the route.
 *  - Memoising only a successfully built client means an env that arrives later
 *    (tests, a hot reload) is picked up on the next call rather than latched as absent.
 *
 * Returns null — never throws — when neither URL/key pair is present. The
 * service-role key is preferred for `getUser(jwt)`; the anon key also works for it
 * (the JWT itself is the credential being checked), which is why both pairs are read.
 */
let client: SupabaseClient | null = null;

export function getSupabaseAuthClient(): SupabaseClient | null {
  if (client) return client;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client = createClient(url, key);
  return client;
}

/** Test seam: drop the memoised client so the next call re-reads the env. */
export function resetSupabaseAuthClientForTests(): void {
  client = null;
}
