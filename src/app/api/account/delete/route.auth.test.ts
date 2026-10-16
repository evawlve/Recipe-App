/**
 * `/api/account/delete` — WHO may call it, and in what ORDER it deletes.
 *
 * Until 2026-10-05 the route took no request, authenticated with the WEB cookie session
 * only (so the mobile app's Supabase bearer was a 401), deleted the Prisma rows first and
 * then let a failed Supabase auth deletion fall through to `{ success: true }`. Now a bearer
 * OR a cookie through the shared authenticateRequest() chokepoint (NOT the dev key — a
 * deletion must name a person), the Supabase auth user goes FIRST and a failure there is a
 * non-2xx with a string `error`, and the Prisma half is reported, never faked.
 *
 * What is pinned: the three 401/503 auth answers; `admin.deleteUser` is called with the
 * caller's id and NOTHING Prisma-side runs when it fails; a mobile-only user (no Prisma
 * `User` row) is a 200 with `appDataFound: false` and never a 404; a failed Prisma
 * transaction after a successful auth deletion is a 200 with `appDataDeleted: false`; the
 * route's own no-admin-client check is a 503; and a cookie user still passes.
 *
 * Harness: the supabase-js mock the barcode/parse/search auth suites use, extended with
 * `auth.admin.deleteUser`; `@/lib/auth` mocked for the cookie arm; `@/lib/db` mocked with a
 * `$transaction` that runs its callback against a stub `tx`.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://unit.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-test';

import { NextRequest } from 'next/server';
import { DELETE } from './route';
import { resetSupabaseAuthClientForTests } from '@/lib/supabase/admin';

const mockGetUser = jest.fn();
const mockDeleteUser = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: {
      getUser: (...a: unknown[]) => mockGetUser(...a),
      admin: { deleteUser: (...a: unknown[]) => mockDeleteUser(...a) },
    },
  })),
}));

const mockGetCurrentUser = jest.fn();
jest.mock('@/lib/auth', () => ({
  getCurrentUser: (...a: unknown[]) => mockGetCurrentUser(...a),
}));

const mockFindUnique = jest.fn();
const mockTransaction = jest.fn();
jest.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: (...a: unknown[]) => mockFindUnique(...a) },
    $transaction: (...a: unknown[]) => mockTransaction(...a),
  },
}));

/** A stub `tx` with every delegate the transaction body touches. */
function makeTx() {
  const deleteMany = () => jest.fn().mockResolvedValue({ count: 0 });
  return {
    ingredient: { deleteMany: deleteMany() },
    nutrition: { deleteMany: deleteMany() },
    photo: { deleteMany: deleteMany() },
    recipeTag: { deleteMany: deleteMany() },
    collectionRecipe: { deleteMany: deleteMany() },
    comment: { deleteMany: deleteMany() },
    like: { deleteMany: deleteMany() },
    recipe: { deleteMany: deleteMany() },
    collection: { deleteMany: deleteMany() },
    follow: { deleteMany: deleteMany() },
    user: { delete: jest.fn().mockResolvedValue({ id: 'user-1' }) },
  };
}

/** The shape `prisma.user.findUnique({ include })` returns for a web user with one recipe. */
const webUserRow = {
  id: 'user-1',
  email: 'someone@example.org',
  recipes: [{ id: 'recipe-1', photos: [], ingredients: [], nutrition: null, tags: [], comments: [], likes: [], collections: [] }],
  collections: [],
  comments: [],
  likes: [],
  followedBy: [],
  following: [],
};

const req = (headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost:3000/api/account/delete', { method: 'DELETE', headers });

const ENV_KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const;

describe('/api/account/delete auth + order', () => {
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    jest.clearAllMocks();
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'someone@example.org', email_confirmed_at: '2026-01-01T00:00:00Z' } },
      error: null,
    });
    mockDeleteUser.mockResolvedValue({ data: { user: null }, error: null });
    mockGetCurrentUser.mockResolvedValue(null);
    mockFindUnique.mockResolvedValue(null);
    mockTransaction.mockImplementation(async (fn: (tx: ReturnType<typeof makeTx>) => Promise<void>) => fn(makeTx()));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    // (h) deletes these; reassign them so the memoised admin client can be rebuilt.
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    resetSupabaseAuthClientForTests();
  });

  // (a)
  test('no credentials at all is a 401 missing_credentials and touches nothing', async () => {
    const res = await DELETE(req());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized', reason: 'missing_credentials' });
    expect(mockDeleteUser).not.toHaveBeenCalled();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  // (b)
  test('a bad bearer is a 401 invalid_bearer and never falls through to the cookie', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad jwt' } });
    mockGetCurrentUser.mockResolvedValue({ id: 'cookie-user', email: 'web@example.org' });
    const res = await DELETE(req({ authorization: 'Bearer stale-jwt' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized', reason: 'invalid_bearer' });
    expect(mockDeleteUser).not.toHaveBeenCalled();
    expect(mockGetCurrentUser).not.toHaveBeenCalled();
  });

  // (c) The mobile-only case: a valid bearer, no Prisma row.
  test('a valid bearer deletes THAT user from Supabase; no Prisma row is a 200 with appDataFound false', async () => {
    const res = await DELETE(req({ authorization: 'Bearer good-jwt' }));
    expect(res.status).toBe(200);
    expect(mockGetUser).toHaveBeenCalledWith('good-jwt');
    expect(mockDeleteUser).toHaveBeenCalledTimes(1);
    expect(mockDeleteUser).toHaveBeenCalledWith('user-1');
    const body = await res.json();
    expect(body).toMatchObject({ success: true, authDeleted: true, appDataFound: false, appDataDeleted: false });
    expect(body.appDataError).toBeUndefined();
    expect(mockFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'user-1' } }));
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  // (d) The cloud-23 finding: a refused auth deletion used to be a 200.
  test('a refused Supabase deletion is a 502 auth_delete_failed and Prisma is never read', async () => {
    mockDeleteUser.mockResolvedValue({ data: { user: null }, error: { message: 'boom' } });
    const res = await DELETE(req({ authorization: 'Bearer good-jwt' }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Auth deletion failed', reason: 'auth_delete_failed', detail: 'boom' });
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  // (e)
  test('a Supabase deletion that throws is the same 502', async () => {
    mockDeleteUser.mockRejectedValue(new Error('gotrue down'));
    const res = await DELETE(req({ authorization: 'Bearer good-jwt' }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('Auth deletion failed');
    expect(body.reason).toBe('auth_delete_failed');
    expect(body.detail).toBe('gotrue down');
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  // (f) A web user with Prisma rows.
  test('a valid bearer with a Prisma row runs the transaction and reports appDataDeleted true', async () => {
    mockFindUnique.mockResolvedValue(webUserRow);
    const res = await DELETE(req({ authorization: 'Bearer good-jwt' }));
    expect(res.status).toBe(200);
    expect(mockDeleteUser).toHaveBeenCalledWith('user-1');
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, authDeleted: true, appDataFound: true, appDataDeleted: true });
    expect(body.appDataError).toBeUndefined();
  });

  // (g) The auth user is already gone, so this is a 200 with the flag false, never a 500.
  test('a failed transaction after a successful auth deletion is a 200 with appDataDeleted false', async () => {
    mockFindUnique.mockResolvedValue(webUserRow);
    mockTransaction.mockRejectedValue(new Error('deadlock detected'));
    const res = await DELETE(req({ authorization: 'Bearer good-jwt' }));
    expect(res.status).toBe(200);
    expect(mockDeleteUser).toHaveBeenCalledWith('user-1');
    expect(await res.json()).toMatchObject({
      success: true, authDeleted: true, appDataFound: true, appDataDeleted: false, appDataError: 'deadlock detected',
    });
  });

  // (h) The route's OWN step-(1) check. A bearer with no Supabase env is refused by the
  // chokepoint first (request-auth's bearer arm returns auth_unavailable before the route
  // runs), so this authenticates through the COOKIE arm, which needs no Supabase env.
  test('no admin client (no Supabase env) is a 503 auth_unavailable and deleteUser is never called', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'cookie-user', email: 'web@example.org' });
    for (const k of ENV_KEYS) delete process.env[k];

    let res!: Response;
    await new Promise<void>((resolve, reject) => {
      jest.isolateModules(() => {
        // A fresh module registry: admin.ts has no memoised client to serve.
        const { DELETE: isolatedDelete } = require('./route') as { DELETE: typeof DELETE };
        isolatedDelete(req()).then((r: Response) => { res = r; resolve(); }, reject);
      });
    });

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Auth deletion unavailable', reason: 'auth_unavailable' });
    expect(mockDeleteUser).not.toHaveBeenCalled();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  // (i) The web page keeps working.
  test('a cookie session with no bearer still deletes — the web page\'s path', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'cookie-user', email: 'web@example.org' });
    mockFindUnique.mockResolvedValue({ ...webUserRow, id: 'cookie-user' });
    const res = await DELETE(req());
    expect(res.status).toBe(200);
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockDeleteUser).toHaveBeenCalledWith('cookie-user');
    expect(await res.json()).toMatchObject({ success: true, authDeleted: true, appDataFound: true, appDataDeleted: true });
  });
});
