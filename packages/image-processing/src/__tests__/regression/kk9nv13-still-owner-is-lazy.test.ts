import { describe, expect, it, vi } from 'vitest';

/**
 * The sweep's table of sized-still owners names `schema` columns, and is read
 * when a sweep asks, not when the module loads (Codex-kk9nv.13). Read eagerly,
 * it made every test that mocks `@codex/database` without `schema`, and
 * imports anything that reaches this package, fail before it ran: ecom-api's
 * webhook handler tests, in #631's CI.
 */
vi.mock('@codex/database', () => ({}));

describe('the sized-still owner table', () => {
  it('loads with @codex/database mocked without schema', async () => {
    await expect(import('../../orphaned-file-service')).resolves.toBeDefined();
  });
});
