/**
 * Content Remote Functions Tests
 *
 * Tests for content browsing remote functions.
 * Mocks are centralized in src/tests/mocks.ts
 */

import { beforeAll, describe, expect, it } from 'vitest';

describe('remote/content.remote', () => {
  // Pre-warm dynamic imports (slow on first load)
  beforeAll(async () => {
    await import('./content.remote');
  }, 30_000);

  it('exports listContent query', async () => {
    const { listContent } = await import('./content.remote');
    expect(listContent).toBeDefined();
  });

  it('exports getContent query', async () => {
    const { getContent } = await import('./content.remote');
    expect(getContent).toBeDefined();
  });

  it('exports getContentBySlug query', async () => {
    const { getContentBySlug } = await import('./content.remote');
    expect(getContentBySlug).toBeDefined();
  });

  it('exports getContentBatch batched query', async () => {
    const { getContentBatch } = await import('./content.remote');
    expect(getContentBatch).toBeDefined();
  });
});
