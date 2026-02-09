/**
 * Content Remote Functions Tests
 *
 * Tests for content browsing remote functions.
 */

import { describe, expect, it, vi } from 'vitest';

// Mock SvelteKit server modules before importing
vi.mock('$app/server', () => ({
  query: Object.assign(
    vi.fn((_schema, fn) => fn),
    { batch: vi.fn((_schema, fn) => fn) }
  ),
  getRequestEvent: vi.fn(() => ({
    platform: { env: {} },
    cookies: { get: vi.fn() },
  })),
}));

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    content: { list: vi.fn(), get: vi.fn() },
    org: { getBySlug: vi.fn() },
  })),
}));

describe('remote/content.remote', () => {
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
