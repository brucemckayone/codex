/**
 * Creator Studio → Sales server load (Codex-2hxff.21).
 *
 * The URL filters reach `/sales/me` sanitised, both reads stream, and a
 * failed read resolves to `null` (the page's "couldn't load") rather than
 * rejecting or posing as an empty list.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

const remote = vi.hoisted(() => ({
  listMySales: vi.fn(),
  getMySalesStats: vi.fn(),
}));
vi.mock('$lib/remote/sales.remote', () => remote);
vi.mock('$lib/observability', () => ({ logger: { error: vi.fn() } }));

import { load } from '../+page.server';

type LoadEvent = Parameters<typeof load>[0];

function run(search = '') {
  return load({
    url: new URL(`https://creators.revelations.studio/studio/sales${search}`),
    locals: { user: { id: 'rowan' }, requestId: 'req-1' },
    depends: vi.fn(),
  } as unknown as LoadEvent) as Promise<{
    filters: { page: number; range: string; status: string };
    sales: Promise<unknown>;
    stats: Promise<unknown>;
  }>;
}

const EMPTY = {
  items: [],
  pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
};
const STATS = {
  grossCents: 0,
  netCents: 0,
  refundedCents: 0,
  count: 0,
  currency: 'gbp',
};

beforeEach(() => {
  remote.listMySales.mockReset().mockResolvedValue(EMPTY);
  remote.getMySalesStats.mockReset().mockResolvedValue(STATS);
});

describe('filters', () => {
  test('defaults: page 1, the last 30 days, every status', async () => {
    const before = Date.now();
    const result = await run();

    expect(result.filters).toEqual({ page: 1, range: '30', status: 'all' });
    const args = remote.listMySales.mock.calls[0][0];
    expect(args).toMatchObject({ page: 1, limit: 20 });
    expect(args).not.toHaveProperty('status');
    const days = (before - Date.parse(args.fromDate)) / 86_400_000;
    expect(Math.round(days)).toBe(30);
    expect(remote.getMySalesStats).toHaveBeenCalledWith({
      fromDate: args.fromDate,
    });
  });

  test('passes a known status and page, and drops fromDate for all time', async () => {
    const result = await run('?page=3&status=refunded&range=all');

    expect(result.filters).toEqual({
      page: 3,
      range: 'all',
      status: 'refunded',
    });
    expect(remote.listMySales).toHaveBeenCalledWith({
      page: 3,
      limit: 20,
      status: 'refunded',
    });
    expect(remote.getMySalesStats).toHaveBeenCalledWith({});
  });

  test('an unknown status, range or page falls back to the default', async () => {
    const result = await run('?page=-4&status=stolen&range=365');

    expect(result.filters).toEqual({ page: 1, range: '30', status: 'all' });
    expect(remote.listMySales.mock.calls[0][0]).not.toHaveProperty('status');
  });
});

describe('streaming', () => {
  test('a failed read resolves to null, never rejects', async () => {
    remote.listMySales.mockRejectedValue(new Error('ecom down'));
    remote.getMySalesStats.mockRejectedValue(new Error('ecom down'));
    const result = await run();

    await expect(result.sales).resolves.toBeNull();
    await expect(result.stats).resolves.toBeNull();
  });

  test('a successful read streams the worker response through', async () => {
    const result = await run();

    await expect(result.sales).resolves.toEqual(EMPTY);
    await expect(result.stats).resolves.toEqual(STATS);
  });
});
