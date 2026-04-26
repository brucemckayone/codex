/**
 * Test that createWebhookDbClient forwards the canonical
 * { DATABASE_URL, DATABASE_URL_LOCAL_PROXY, DB_METHOD } triple to
 * createPerRequestDbClient unchanged.
 *
 * The point of the helper is to *guarantee* that triple — a future env
 * binding rename will break exactly one site, not five.
 */
import { describe, expect, it, vi } from 'vitest';

const createPerRequestDbClient = vi.fn(() => ({
  db: {} as unknown,
  cleanup: vi.fn(async () => {}),
}));

vi.mock('@codex/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/database')>();
  return {
    ...actual,
    createPerRequestDbClient: (env: unknown) =>
      createPerRequestDbClient(env as never),
  };
});

describe('createWebhookDbClient', () => {
  it('forwards DATABASE_URL, DATABASE_URL_LOCAL_PROXY, and DB_METHOD', async () => {
    const { createWebhookDbClient } = await import('../webhook-db-client');

    createPerRequestDbClient.mockClear();

    createWebhookDbClient({
      DATABASE_URL: 'postgres://prod',
      DATABASE_URL_LOCAL_PROXY: 'postgres://proxy',
      DB_METHOD: 'NEON_HTTP',
    });

    expect(createPerRequestDbClient).toHaveBeenCalledTimes(1);
    expect(createPerRequestDbClient).toHaveBeenCalledWith({
      DATABASE_URL: 'postgres://prod',
      DATABASE_URL_LOCAL_PROXY: 'postgres://proxy',
      DB_METHOD: 'NEON_HTTP',
    });
  });

  it('passes through optional fields as undefined when absent', async () => {
    const { createWebhookDbClient } = await import('../webhook-db-client');

    createPerRequestDbClient.mockClear();

    createWebhookDbClient({ DATABASE_URL: 'postgres://prod' });

    expect(createPerRequestDbClient).toHaveBeenCalledWith({
      DATABASE_URL: 'postgres://prod',
      DATABASE_URL_LOCAL_PROXY: undefined,
      DB_METHOD: undefined,
    });
  });

  it('returns the {db, cleanup} pair from createPerRequestDbClient', async () => {
    const { createWebhookDbClient } = await import('../webhook-db-client');

    const result = createWebhookDbClient({
      DATABASE_URL: 'postgres://prod',
    });

    expect(result).toHaveProperty('db');
    expect(result).toHaveProperty('cleanup');
    expect(typeof result.cleanup).toBe('function');
  });
});
