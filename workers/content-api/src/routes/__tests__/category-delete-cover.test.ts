/**
 * DELETE /api/categories/:id takes the category's cover with it
 * (Codex-kk9nv.14, owner: "Delete in the same request").
 *
 * The route soft-deletes the row, which reports the cover key it held, then
 * deletes that folder. Before this, the cover's files stayed public for good.
 * What can silently break here is the WIRING: a dropped call, the wrong
 * entity id (the ownership guard then deletes nothing, without an error), or
 * a delete that runs when the soft delete was refused.
 *
 * SHAPE. Real `procedure()` resolver, real Hono routing and the real service
 * registry. Stubbed: `CategoriesService` and `ImageProcessingService` (no
 * Neon, no R2), and `createDbClient`. A personal-space delete (no
 * `organizationId`) resolves without a membership lookup.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER = {
  id: '7a1d0f2e-3b4c-4d5e-8f60-112233445566',
  email: 'creator@test.com',
  role: 'creator',
};
const CATEGORY_ID = '4c222222-2222-4222-8222-222222222222';
const COVER_KEY = `categories/${CATEGORY_ID}/cover/1600x900-0a1b2c3d`;

const categorySpies = { softDelete: vi.fn() };
const imageSpies = { deleteDroppedStill: vi.fn() };

vi.mock('@codex/content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/content')>();
  return { ...actual, CategoriesService: vi.fn(() => categorySpies) };
});

vi.mock('@codex/image-processing', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@codex/image-processing')>();
  return { ...actual, ImageProcessingService: vi.fn(() => imageSpies) };
});

vi.mock('@codex/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/database')>();
  return { ...actual, createDbClient: vi.fn(() => ({})) };
});

// Below the mocks on purpose: biome's organizeImports never moves an import
// across a statement, so this stays after `vi.mock` and the real service
// registry resolves the mocked classes.
import { CategoryNotFoundError } from '@codex/content';
import categories from '../categories';

const testEnv = {
  ...env,
  ENVIRONMENT: 'development',
} as unknown as typeof env;

async function deleteCategory(): Promise<Response> {
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.set('user', USER);
    c.set('session', { id: 'sess_test', userId: USER.id });
    await next();
  });
  app.route('/api/categories', categories);
  const ec = createExecutionContext();
  const res = await app.fetch(
    new Request(`http://content-api.test/api/categories/${CATEGORY_ID}`, {
      method: 'DELETE',
    }),
    testEnv,
    ec
  );
  await waitOnExecutionContext(ec);
  return res;
}

describe('DELETE /api/categories/:id deletes the cover it held', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    imageSpies.deleteDroppedStill.mockResolvedValue(undefined);
  });

  it("deletes the folder the row held, under the category's own id, after the soft delete", async () => {
    categorySpies.softDelete.mockResolvedValue({
      droppedCoverImageKey: COVER_KEY,
    });

    const res = await deleteCategory();

    expect(res.status).toBe(204);
    expect(categorySpies.softDelete).toHaveBeenCalledWith(CATEGORY_ID, {
      creatorId: USER.id,
    });
    expect(imageSpies.deleteDroppedStill).toHaveBeenCalledTimes(1);
    expect(imageSpies.deleteDroppedStill).toHaveBeenCalledWith({
      imageType: 'category_cover',
      entityType: 'category',
      entityId: CATEGORY_ID,
      droppedKey: COVER_KEY,
    });
    const softDeletedAt = categorySpies.softDelete.mock.invocationCallOrder[0];
    expect(
      imageSpies.deleteDroppedStill.mock.invocationCallOrder[0]
    ).toBeGreaterThan(softDeletedAt ?? Number.POSITIVE_INFINITY);
  });

  it('deletes nothing when the soft delete is refused', async () => {
    categorySpies.softDelete.mockRejectedValue(
      new CategoryNotFoundError(CATEGORY_ID)
    );

    const res = await deleteCategory();

    expect(res.status).toBe(404);
    expect(imageSpies.deleteDroppedStill).not.toHaveBeenCalled();
  });
});
