/**
 * `/api/account/delete` — the two leftovers cloud-26's reviewer found in the bearer route
 * (mobile punch #345 (b) and (4)), pinned here and NOT in `route.auth.test.ts`, whose
 * `@/lib/db` mock has no `nlpRequestLog` and must keep passing unedited.
 *
 * ROW 1 — the scrub. `NlpRequestLog` is the parse route's rate-limit counter (a timestamp
 * per paid parse, no text), keyed on the Supabase user id with no relation to `User`, so a
 * deletion used to leave the rows behind — and a mobile user, who has no `User` row, has no
 * other backend row at all. After the auth deletion has succeeded the route now runs
 * `prisma.nlpRequestLog.deleteMany({ where: { userId } })` unconditionally, before and
 * independently of the `User` lookup, and reports the count as `requestLogRowsDeleted`
 * (`null` when the scrub failed). It never runs when the auth deletion failed or was never
 * attempted.
 *
 * ROW 2 — the fix-forward. The Prisma import and `user.findUnique` used to sit outside any
 * inner try, so a database failure there fell to the outer catch: a 500 "Please try again"
 * over an account that was already gone (the retry is a 401). They are now reported like a
 * failed transaction — 200, `authDeleted: true`, `appDataDeleted: false`, an `appDataError`
 * string — with `appDataFound: null` when the lookup itself failed (whether a `User` row
 * exists is then unknown).
 *
 * Harness: the auth suite's, plus `nlpRequestLog.deleteMany` on the `@/lib/db` mock. The
 * `mock` prefix on the `jest.fn()`s is what lets the hoisted `jest.mock` factories see them.
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
const mockDeleteMany = jest.fn();
// A function declaration, not a const: `jest.mock` is hoisted above this line and reads the
// reference eagerly. Named because (g) swaps in a throwing factory and must put this one back.
function mockDbModule() {
  return {
    prisma: {
      user: { findUnique: (...a: unknown[]) => mockFindUnique(...a) },
      nlpRequestLog: { deleteMany: (...a: unknown[]) => mockDeleteMany(...a) },
      $transaction: (...a: unknown[]) => mockTransaction(...a),
    },
  };
}
jest.mock('@/lib/db', mockDbModule);

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
  id: 'cookie-user',
  email: 'web@example.org',
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

describe('/api/account/delete request-log scrub + fix-forward', () => {
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
    mockDeleteMany.mockResolvedValue({ count: 3 });
    mockTransaction.mockImplementation(async (fn: (tx: ReturnType<typeof makeTx>) => Promise<void>) => fn(makeTx()));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    // (c4) deletes these; reassign them so the memoised admin client can be rebuilt.
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    resetSupabaseAuthClientForTests();
  });

  // (a) ROW 1 for the user it exists for: a mobile-only bearer, no Prisma `User` row.
  test('a mobile-only bearer user has their rate-limit rows scrubbed by THEIR id, reported on the 200', async () => {
    const res = await DELETE(req({ authorization: 'Bearer good-jwt' }));
    expect(res.status).toBe(200);
    expect(mockDeleteUser).toHaveBeenCalledWith('user-1');
    expect(mockDeleteMany).toHaveBeenCalledTimes(1);
    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    // After the auth deletion, before the `User` lookup.
    expect(mockDeleteMany.mock.invocationCallOrder[0]).toBeGreaterThan(mockDeleteUser.mock.invocationCallOrder[0]);
    expect(mockDeleteMany.mock.invocationCallOrder[0]).toBeLessThan(mockFindUnique.mock.invocationCallOrder[0]);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, authDeleted: true, requestLogRowsDeleted: 3, appDataFound: false, appDataDeleted: false });
    expect(body.appDataError).toBeUndefined();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  // (b) A web user has a `User` row and, having never held a bearer, no rate-limit rows.
  test('a cookie user with a Prisma row gets BOTH the scrub (count 0) and the transaction', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'cookie-user', email: 'web@example.org' });
    mockFindUnique.mockResolvedValue(webUserRow);
    mockDeleteMany.mockResolvedValue({ count: 0 });
    const res = await DELETE(req());
    expect(res.status).toBe(200);
    expect(mockDeleteUser).toHaveBeenCalledWith('cookie-user');
    expect(mockDeleteMany).toHaveBeenCalledTimes(1);
    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { userId: 'cookie-user' } });
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, authDeleted: true, requestLogRowsDeleted: 0, appDataFound: true, appDataDeleted: true });
    expect(body.appDataError).toBeUndefined();
  });

  // (c) The scrub never runs unless the auth deletion SUCCEEDED.
  test('(c1) a refused Supabase deletion (502) scrubs nothing', async () => {
    mockDeleteUser.mockResolvedValue({ data: { user: null }, error: { message: 'boom' } });
    const res = await DELETE(req({ authorization: 'Bearer good-jwt' }));
    expect(res.status).toBe(502);
    expect(mockDeleteMany).not.toHaveBeenCalled();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  test('(c2) a Supabase deletion that throws (502) scrubs nothing', async () => {
    mockDeleteUser.mockRejectedValue(new Error('gotrue down'));
    const res = await DELETE(req({ authorization: 'Bearer good-jwt' }));
    expect(res.status).toBe(502);
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  test('(c3) 401 missing_credentials and 401 invalid_bearer scrub nothing', async () => {
    const none = await DELETE(req());
    expect(none.status).toBe(401);
    expect((await none.json()).reason).toBe('missing_credentials');

    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad jwt' } });
    const bad = await DELETE(req({ authorization: 'Bearer stale-jwt' }));
    expect(bad.status).toBe(401);
    expect((await bad.json()).reason).toBe('invalid_bearer');

    expect(mockDeleteUser).not.toHaveBeenCalled();
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  test('(c4) the chokepoint\'s 503 auth_unavailable (bearer validation threw) scrubs nothing', async () => {
    mockGetUser.mockRejectedValue(new Error('gotrue unreachable'));
    const res = await DELETE(req({ authorization: 'Bearer good-jwt' }));
    expect(res.status).toBe(503);
    expect((await res.json()).reason).toBe('auth_unavailable');
    expect(mockDeleteUser).not.toHaveBeenCalled();
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  // (c5) The route's OWN step-(1) check — the auth suite's (h) harness, verbatim. A bearer with
  // no Supabase env is refused by the chokepoint first, so this authenticates through the
  // COOKIE arm, which needs no Supabase env.
  test('(c5) the route\'s own 503 auth_unavailable (no admin client) scrubs nothing', async () => {
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
    expect(mockDeleteMany).not.toHaveBeenCalled();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  // (d) A failed scrub is its own field, and nothing else.
  test('(d1) a rejected deleteMany is a 200 with requestLogRowsDeleted null; the lookup still runs', async () => {
    mockDeleteMany.mockRejectedValue(new Error('relation does not exist'));
    const res = await DELETE(req({ authorization: 'Bearer good-jwt' }));
    expect(res.status).toBe(200);
    expect(mockFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'user-1' } }));
    const body = await res.json();
    expect(body).toMatchObject({ success: true, authDeleted: true, requestLogRowsDeleted: null, appDataFound: false, appDataDeleted: false });
    expect(body.appDataError).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith('[account.delete] request-log scrub failed after auth deletion:', 'relation does not exist');
  });

  test('(d2) a rejected deleteMany for a web user still runs the transaction and reports it deleted', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'cookie-user', email: 'web@example.org' });
    mockFindUnique.mockResolvedValue(webUserRow);
    mockDeleteMany.mockRejectedValue(new Error('relation does not exist'));
    const res = await DELETE(req());
    expect(res.status).toBe(200);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, authDeleted: true, requestLogRowsDeleted: null, appDataFound: true, appDataDeleted: true });
    expect(body.appDataError).toBeUndefined();
  });

  // (e) ROW 2: the lookup failing after the auth deletion is reported, not a 500.
  test('(e) a rejected findUnique is a 200 with appDataFound null and an appDataError, never 500', async () => {
    mockFindUnique.mockRejectedValue(new Error('Can\'t reach database server'));
    const res = await DELETE(req({ authorization: 'Bearer good-jwt' }));
    expect(res.status).toBe(200);
    expect(mockDeleteUser).toHaveBeenCalledWith('user-1');
    const body = await res.json();
    expect(body).toMatchObject({ success: true, authDeleted: true, requestLogRowsDeleted: 3, appDataFound: null, appDataDeleted: false });
    expect(typeof body.appDataError).toBe('string');
    expect(body.appDataError).toBe('Can\'t reach database server');
    expect(body.error).toBeUndefined();
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith('[account.delete] app-data cleanup failed after auth deletion:', 'Can\'t reach database server');
  });

  // (e') The transaction arm is unchanged: appDataFound stays TRUE when the lookup answered.
  test('(e2) a failed transaction keeps appDataFound true — null is for a failed LOOKUP only', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'cookie-user', email: 'web@example.org' });
    mockFindUnique.mockResolvedValue(webUserRow);
    mockTransaction.mockRejectedValue(new Error('deadlock detected'));
    const res = await DELETE(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true, authDeleted: true, requestLogRowsDeleted: 3, appDataFound: true, appDataDeleted: false, appDataError: 'deadlock detected',
    });
  });

  // (g) ROW 2 for the import itself: `@/lib/db` failing to load after the auth deletion. Not
  // the (c5) harness: the route's `await import()` runs after `isolateModules`' synchronous
  // callback has returned, so it would see the outer registry. Instead the registry is reset,
  // a THROWING factory registered for `@/lib/db`, the route required fresh, and the normal
  // factory put back afterwards. Last in the file on purpose.
  test('(g) a failed Prisma import is a 200 with appDataFound null and requestLogRowsDeleted null, never 500', async () => {
    jest.resetModules();
    jest.doMock('@/lib/db', () => { throw new Error('PrismaClientInitializationError: DATABASE_URL unset'); });
    try {
      const { DELETE: freshDelete } = require('./route') as { DELETE: typeof DELETE };
      const res = await freshDelete(req({ authorization: 'Bearer good-jwt' }));

      expect(res.status).toBe(200);
      expect(mockDeleteUser).toHaveBeenCalledWith('user-1');
      const body = await res.json();
      expect(body).toMatchObject({ success: true, authDeleted: true, requestLogRowsDeleted: null, appDataFound: null, appDataDeleted: false });
      expect(typeof body.appDataError).toBe('string');
      expect(body.appDataError).toContain('PrismaClientInitializationError');
      expect(body.error).toBeUndefined();
      expect(mockDeleteMany).not.toHaveBeenCalled();
      expect(mockFindUnique).not.toHaveBeenCalled();
    } finally {
      jest.resetModules();
      jest.doMock('@/lib/db', mockDbModule);
    }
  });
});
