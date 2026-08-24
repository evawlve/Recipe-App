import type { NextRequest } from 'next/server';
import { getSupabaseAuthClient } from '@/lib/supabase/admin';

/**
 * ONE way for an API route to answer "who is calling?".
 *
 * Three credentials, evaluated in a FIXED order — key, then bearer, then cookie —
 * and each route says which of them it accepts:
 *
 *   key     `x-api-key` header or `?api_key=` matching `DEV_API_KEY`. The dev /
 *           eval bypass. No network, no user. FAILS CLOSED: an unset or empty
 *           `DEV_API_KEY` authorizes nothing — there is deliberately no fallback
 *           literal here or anywhere (doc-check claim `dev-api-key-no-fallback-sites`).
 *   bearer  `Authorization: Bearer <supabase jwt>`, validated by one GoTrue round
 *           trip (`auth.getUser(jwt)`). The mobile client's path.
 *   cookie  the web app's Supabase session cookie, read through `getCurrentUser()`.
 *           Loaded DYNAMICALLY, because `@/lib/auth` pulls in `next/headers` and
 *           Prisma — a route that never accepts cookies must not pay for them.
 *
 * Two rules the order encodes:
 *  - A matching key short-circuits everything: it is a bypass, and it must keep
 *    working in a process with no Supabase env at all.
 *  - A bearer header that is PRESENT and accepted is decisive. An invalid one is
 *    `invalid_bearer`; it NEVER falls through to the cookie path, so a stale mobile
 *    token cannot silently authenticate as whatever web session the cookies carry.
 *
 * Failure reasons are the three the parse route has always distinguished, so its
 * 401 bodies stay byte-identical: `missing_credentials` (nothing usable was sent),
 * `invalid_bearer` (GoTrue rejected the token), `auth_unavailable` (the validator
 * could not run — no Supabase env, or the round trip threw).
 */
export type AuthVia = 'key' | 'bearer' | 'cookie';

export type AuthFailureReason = 'missing_credentials' | 'invalid_bearer' | 'auth_unavailable';

export interface RequestAuth {
  via: AuthVia;
  /** The Supabase user id. null ONLY for `via: 'key'` — the bypass has no user. */
  userId: string | null;
  email: string | null;
}

export interface AuthFailure {
  via: null;
  reason: AuthFailureReason;
}

export type AuthOutcome = RequestAuth | AuthFailure;

export interface AuthenticateOptions {
  /** Which credentials this route accepts. Order here is irrelevant — evaluation order is fixed. */
  accept: readonly AuthVia[];
}

/** The dev key as presented: `x-api-key` header first, `?api_key=` second. */
export function readDevApiKey(req: NextRequest): string | null {
  return req.headers.get('x-api-key') || req.nextUrl.searchParams.get('api_key');
}

/**
 * True only when BOTH sides are non-empty and equal. `!!expected` is the fail-closed
 * half: with `DEV_API_KEY` unset or '' nothing matches, the retired literals included.
 */
export function matchesDevApiKey(req: NextRequest): boolean {
  const expected = process.env.DEV_API_KEY;
  const presented = readDevApiKey(req);
  return !!expected && !!presented && presented === expected;
}

/**
 * The token after `Bearer ` in the `Authorization` header, trimmed. null when the
 * header is absent, carries another scheme, or the token is empty.
 */
export function readBearerToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization');
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

export async function authenticateRequest(
  req: NextRequest,
  opts: AuthenticateOptions,
): Promise<AuthOutcome> {
  const { accept } = opts;

  if (accept.includes('key') && matchesDevApiKey(req)) {
    return { via: 'key', userId: null, email: null };
  }

  // A bearer the route does not accept is treated as not sent: the remaining
  // accepted paths still get their turn. A bearer the route DOES accept is decisive.
  const token = readBearerToken(req);
  if (token !== null && accept.includes('bearer')) {
    const client = getSupabaseAuthClient();
    if (!client) return { via: null, reason: 'auth_unavailable' };
    try {
      const { data, error } = await client.auth.getUser(token);
      const user = data?.user;
      if (error || !user) return { via: null, reason: 'invalid_bearer' };
      return { via: 'bearer', userId: user.id, email: user.email || null };
    } catch (err) {
      console.warn('[request-auth] bearer validation threw:', err);
      return { via: null, reason: 'auth_unavailable' };
    }
  }

  if (accept.includes('cookie')) {
    try {
      const { getCurrentUser } = await import('@/lib/auth');
      const user = await getCurrentUser();
      if (user?.id) return { via: 'cookie', userId: user.id, email: user.email || null };
    } catch (err) {
      console.warn('[request-auth] cookie session lookup threw:', err);
      return { via: null, reason: 'auth_unavailable' };
    }
  }

  return { via: null, reason: 'missing_credentials' };
}
