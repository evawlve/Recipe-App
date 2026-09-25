/**
 * /api/health is anonymous. A failed DB ping must not put the driver's error text
 * (which names the database host and port) in the response body.
 */

const mockQueryRaw = jest.fn();
jest.mock('@/lib/db', () => ({ prisma: { $queryRaw: (...a: unknown[]) => mockQueryRaw(...a) } }));

import { GET } from './route';

test('a healthy ping is 200 {ok:true}', async () => {
  mockQueryRaw.mockResolvedValue([{ '?column?': 1 }]);
  const res = await GET();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

test('a failed ping is 500 with a fixed body and no driver text', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  mockQueryRaw.mockRejectedValue(new Error("Can't reach database server at `db.internal.example:5432`"));
  const res = await GET();
  expect(res.status).toBe(500);
  const body = await res.json();
  expect(body).toEqual({ ok: false, error: 'db' });
  expect(JSON.stringify(body)).not.toContain('db.internal.example');
  spy.mockRestore();
});
