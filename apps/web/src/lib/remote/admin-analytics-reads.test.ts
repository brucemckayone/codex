// @vitest-environment node

/**
 * The Studio reads a page shows as "We couldn't load …" (review H1, M4, N-3;
 * Codex-2hxff.74's pattern): each REJECTS on failure, after logging the raw
 * error, because the alert never shows it. Revenue by creator, subscribers,
 * followers and top content used to reject with nothing logged.
 *
 * Mocked like `admin-dashboard-stats.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/errors';

const api = vi.hoisted(() => ({
  analytics: {
    getRevenue: vi.fn(),
    getRevenueByCreator: vi.fn(),
    getSubscribers: vi.fn(),
    getFollowers: vi.fn(),
    getTopContent: vi.fn(),
  },
  admin: { getActivity: vi.fn() },
}));
const loggerError = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => api),
  serverApiUrl: vi.fn(() => 'http://localhost:42073'),
}));

vi.mock('$lib/observability', () => ({
  logger: { error: loggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// The global `$app/server` mock is one-arg; these remotes are (schema, fn).
// Kit's remote-module check wants every export tagged with `__`.
const makeRemote = (type: string, fn: (...args: unknown[]) => unknown) =>
  Object.assign((...args: unknown[]) => fn(...args), {
    __: { type, id: '', name: '' },
  });
const lastArg = (args: unknown[]) =>
  args[args.length - 1] as (...args: unknown[]) => unknown;
vi.mock('$app/server', () => ({
  command: vi.fn((...args: unknown[]) => makeRemote('command', lastArg(args))),
  form: vi.fn((...args: unknown[]) => makeRemote('form', lastArg(args))),
  query: vi.fn((...args: unknown[]) => makeRemote('query', lastArg(args))),
  getRequestEvent: vi.fn(() => ({
    platform: { env: {} },
    cookies: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
  })),
}));

type Read = (params: Record<string, unknown>) => Promise<unknown>;
const remotes = (await import('./admin.remote')) as unknown as Record<
  string,
  Read
>;

const ORG_ID = '33333333-3333-4333-8333-333333333333';

const CASES = [
  {
    remote: 'getAnalyticsRevenue',
    mock: api.analytics.getRevenue,
    params: { organizationId: ORG_ID },
    label: '[Analytics] Failed to fetch revenue',
  },
  {
    remote: 'getAnalyticsRevenueByCreator',
    mock: api.analytics.getRevenueByCreator,
    params: { organizationId: ORG_ID },
    label: '[Analytics] Failed to fetch revenue by creator',
  },
  {
    remote: 'getAnalyticsSubscribers',
    mock: api.analytics.getSubscribers,
    params: { organizationId: ORG_ID },
    label: '[Analytics] Failed to fetch subscribers',
  },
  {
    remote: 'getAnalyticsFollowers',
    mock: api.analytics.getFollowers,
    params: { organizationId: ORG_ID },
    label: '[Analytics] Failed to fetch followers',
  },
  {
    remote: 'getAnalyticsTopContent',
    mock: api.analytics.getTopContent,
    params: { organizationId: ORG_ID, limit: 10 },
    label: '[Analytics] Failed to fetch top content',
  },
  {
    remote: 'getActivityFeed',
    mock: api.admin.getActivity,
    params: { organizationId: ORG_ID, page: 1, limit: 12, type: 'all' },
    label: '[Dashboard] Failed to fetch activity feed',
  },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe.each(CASES)('$remote', ({ remote, mock, params, label }) => {
  it('rejects a failed read, after logging the raw error', async () => {
    const failure = new ApiError(503, 'Service unavailable', 'UNAVAILABLE');
    mock.mockRejectedValue(failure);

    await expect(remotes[remote](params)).rejects.toBe(failure);
    expect(loggerError).toHaveBeenCalledWith(label, {
      reason: String(failure),
    });
  });

  it('returns a read that loaded, and logs nothing', async () => {
    const body = { items: [] };
    mock.mockResolvedValue(body);

    await expect(remotes[remote](params)).resolves.toBe(body);
    expect(loggerError).not.toHaveBeenCalled();
  });
});
