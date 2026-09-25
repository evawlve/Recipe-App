/**
 * POST /api/recipes/[id]/ingredients deletes every ingredient of a recipe and recreates
 * them from the body. It was anonymous until the 2026-09-24 security review; these pins
 * keep it author-only and bounded. GET is unchanged and not asserted here.
 */

const mockGetCurrentUser = jest.fn();
const mockFindUnique = jest.fn();
const mockUpsert = jest.fn();

jest.mock('@/lib/auth', () => ({ getCurrentUser: () => mockGetCurrentUser() }));
jest.mock('@/lib/db', () => ({
  prisma: { recipe: { findUnique: (...a: unknown[]) => mockFindUnique(...a) } },
}));
jest.mock('@/lib/recipes/ingredients.server', () => ({
  upsertRecipeIngredients: (...a: unknown[]) => mockUpsert(...a),
  getRecipeIngredients: jest.fn(),
}));

import { POST } from './route';

// Mirrors the route's private MAX_INGREDIENT_ITEMS (Next rejects extra route.ts exports).
const MAX_INGREDIENT_ITEMS = 200;

function post(body: unknown, id = 'recipe-1') {
  const req = new Request(`http://localhost/api/recipes/${id}/ingredients`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id }) });
}

const ITEM = { name: 'flour', qty: 1, unit: 'cup' };

beforeEach(() => {
  mockGetCurrentUser.mockReset();
  mockFindUnique.mockReset();
  mockUpsert.mockReset().mockResolvedValue({ ok: true });
});

test('anonymous caller is 401 and nothing is written', async () => {
  mockGetCurrentUser.mockResolvedValue(null);
  const res = await post({ items: [ITEM] });
  expect(res.status).toBe(401);
  expect(mockUpsert).not.toHaveBeenCalled();
});

test("another user's recipe is 403 and nothing is written", async () => {
  mockGetCurrentUser.mockResolvedValue({ id: 'attacker' });
  mockFindUnique.mockResolvedValue({ authorId: 'author' });
  const res = await post({ items: [ITEM] });
  expect(res.status).toBe(403);
  expect(mockUpsert).not.toHaveBeenCalled();
});

test('unknown recipe is 404', async () => {
  mockGetCurrentUser.mockResolvedValue({ id: 'author' });
  mockFindUnique.mockResolvedValue(null);
  expect((await post({ items: [ITEM] })).status).toBe(404);
  expect(mockUpsert).not.toHaveBeenCalled();
});

test('more than MAX_INGREDIENT_ITEMS items is 400', async () => {
  mockGetCurrentUser.mockResolvedValue({ id: 'author' });
  mockFindUnique.mockResolvedValue({ authorId: 'author' });
  const items = Array.from({ length: MAX_INGREDIENT_ITEMS + 1 }, () => ITEM);
  expect((await post({ items })).status).toBe(400);
  expect((await post({ items: 'not-an-array' })).status).toBe(400);
  expect(mockUpsert).not.toHaveBeenCalled();
});

test('the author may replace their own ingredients', async () => {
  mockGetCurrentUser.mockResolvedValue({ id: 'author' });
  mockFindUnique.mockResolvedValue({ authorId: 'author' });
  const res = await post({ items: [ITEM] });
  expect(res.status).toBe(200);
  expect(mockUpsert).toHaveBeenCalledWith('recipe-1', [ITEM]);
});
