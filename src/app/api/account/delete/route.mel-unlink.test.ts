/**
 * `/api/account/delete` — the MappingEventLog unlink, step (3a') (s457 UID-1).
 *
 * After the auth deletion, the caller's keyed `userHash` rows are re-tagged 'deleted' and the
 * count reported as `eventLogRowsUnlinked` (null when no secret is configured or the update
 * failed). It never runs when the auth deletion was refused. Its own try/catch: a failure
 * changes neither the status nor `requestLogRowsDeleted`.
 *
 * Harness: route.scrub.test.ts's, plus `mappingEventLog.updateMany` on the `@/lib/db` mock.
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
const mockUpdateMany = jest.fn();
// A function declaration, not a const: `jest.mock` is hoisted above this line and reads the
// reference eagerly. Named because (g) swaps in a throwing factory and must put this one back.
function mockDbModule() {
  return {
    prisma: {
      user: { findUnique: (...a: unknown[]) => mockFindUnique(...a) },
      nlpRequestLog: { deleteMany: (...a: unknown[]) => mockDeleteMany(...a) },
      mappingEventLog: { updateMany: (...a: unknown[]) => mockUpdateMany(...a) },
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

const req = (headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost:3000/api/account/delete', { method: 'DELETE', headers });

const ENV_KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const;

describe('/api/account/delete MappingEventLog unlink', () => {
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
    mockUpdateMany.mockResolvedValue({ count: 0 });
    process.env.TELEMETRY_USER_HASH_SECRET = 'k'.repeat(32);
    mockTransaction.mockImplementation(async (fn: (tx: ReturnType<typeof makeTx>) => Promise<void>) => fn(makeTx()));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.TELEMETRY_USER_HASH_SECRET;
    // (c4) deletes these; reassign them so the memoised admin client can be rebuilt.
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    resetSupabaseAuthClientForTests();
  });

  const ID = 'b3f1c2d4-0000-4000-8000-00000000abcd';
  const bearer = () => ({ authorization: 'Bearer good-jwt' });
  const asId = () =>
    mockGetUser.mockResolvedValue({
      data: { user: { id: ID, email: 'someone@example.org', email_confirmed_at: '2026-01-01T00:00:00Z' } },
      error: null,
    });

  test("d1: a bearer's rows are re-tagged 'deleted' by their hash, and the count is reported", async () => {
    asId();
    mockUpdateMany.mockResolvedValue({ count: 5 });
    const res = await DELETE(req(bearer()));
    expect(res.status).toBe(200);
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockUpdateMany).toHaveBeenCalledWith({ where: { userHash: '3e2705a4de1d0d10' }, data: { userHash: 'deleted' } });
    expect(mockUpdateMany.mock.invocationCallOrder[0]).toBeGreaterThan(mockDeleteUser.mock.invocationCallOrder[0]);
    expect((await res.json()).eventLogRowsUnlinked).toBe(5);
  });

  test('d2: with no secret nothing is hashed, the update is skipped, eventLogRowsUnlinked is null', async () => {
    asId();
    delete process.env.TELEMETRY_USER_HASH_SECRET;
    const res = await DELETE(req(bearer()));
    expect(res.status).toBe(200);
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect((await res.json()).eventLogRowsUnlinked).toBeNull();
  });

  test('d3: a rejected updateMany is a 200 with eventLogRowsUnlinked null; the request-log scrub is unaffected', async () => {
    asId();
    mockUpdateMany.mockRejectedValue(new Error('relation does not exist'));
    const res = await DELETE(req(bearer()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.eventLogRowsUnlinked).toBeNull();
    expect(typeof body.requestLogRowsDeleted).toBe('number');
  });

  test('d4: a refused Supabase deletion (502) unlinks nothing', async () => {
    asId();
    mockDeleteUser.mockResolvedValue({ data: { user: null }, error: { message: 'boom' } });
    const res = await DELETE(req(bearer()));
    expect(res.status).toBe(502);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});
