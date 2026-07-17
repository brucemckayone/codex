/**
 * Category Remote Functions Tests
 *
 * Export smoke tests for the studio categories management remote functions.
 * Mocks are centralized in src/tests/mocks.ts ($app/server + $lib/server/api).
 * Behavioural forwarding is exercised by the integration path (the studio
 * categories page + content-api integration tests), not here — full
 * remote-function runtime mocking is fragile (see content.remote.test.ts).
 */

import { beforeAll, describe, expect, it } from 'vitest';

describe('remote/categories.remote', () => {
  // Pre-warm dynamic imports (slow on first load).
  beforeAll(async () => {
    await import('./categories.remote');
  }, 30_000);

  it('exports getCategories query', async () => {
    const { getCategories } = await import('./categories.remote');
    expect(getCategories).toBeDefined();
  });

  it('exports createCategoryForm form', async () => {
    const { createCategoryForm } = await import('./categories.remote');
    expect(createCategoryForm).toBeDefined();
  });

  it('exports updateCategoryForm form', async () => {
    const { updateCategoryForm } = await import('./categories.remote');
    expect(updateCategoryForm).toBeDefined();
  });

  it('exports deleteCategory command', async () => {
    const { deleteCategory } = await import('./categories.remote');
    expect(deleteCategory).toBeDefined();
  });

  it('exports reorderCategories command', async () => {
    const { reorderCategories } = await import('./categories.remote');
    expect(reorderCategories).toBeDefined();
  });

  it('exports uploadCategoryCoverForm form', async () => {
    const { uploadCategoryCoverForm } = await import('./categories.remote');
    expect(uploadCategoryCoverForm).toBeDefined();
  });
});
