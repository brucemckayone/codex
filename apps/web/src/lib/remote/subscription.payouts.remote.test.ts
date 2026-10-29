// @vitest-environment node

/**
 * `listPayouts` (Org Studio → Payouts): what it forwards to ecom-api.
 *
 * Held reads the organisation's paid rows by TRANSFER date (R2-L3): a backlog
 * sale released late has an old sale date and a bank day still to come, so a
 * sale-date window would drop it. The remote must pass `transferredFrom` on.
 *
 * `$app/server` is mocked so the remote runs as a plain function that
 * validates its input with its own schema, as kit does.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ listPayouts: vi.fn() }));

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({ subscription: api })),
}));

type Standard = {
  '~standard': {
    validate: (
      value: unknown
    ) =>
      | { issues?: unknown[]; value?: unknown }
      | Promise<{ issues?: unknown[]; value?: unknown }>;
  };
};

// The handler is the last argument; a schema, when there is one, the first.
// The `__` tag is what kit checks every export of a .remote.ts file has.
const makeRemote = (type: string, args: unknown[]) => {
  const handler = args[args.length - 1] as (arg: unknown) => unknown;
  const schema = args.length > 1 ? (args[0] as Standard) : null;
  return Object.assign(
    async (arg?: unknown) => {
      if (!schema) return handler(arg);
      const result = await schema['~standard'].validate(arg);
      if (result.issues) {
        throw { status: 400, body: { message: 'Invalid input' } };
      }
      return handler(result.value);
    },
    { __: { type, id: '', name: '' }, schema }
  );
};
vi.mock('$app/server', () => ({
  command: vi.fn((...args: unknown[]) => makeRemote('command', args)),
  form: vi.fn((...args: unknown[]) => makeRemote('form', args)),
  query: vi.fn((...args: unknown[]) => makeRemote('query', args)),
  getRequestEvent: vi.fn(() => ({
    platform: { env: {} },
    cookies: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
    locals: {},
  })),
}));

const { listPayouts } = (await import('./subscription.remote')) as unknown as {
  listPayouts: (input: unknown) => Promise<unknown>;
};

const ORG = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  api.listPayouts.mockReset();
  api.listPayouts.mockResolvedValue({ items: [], pagination: {} });
});

describe('listPayouts', () => {
  it('forwards transferredFrom, so Held reaches a backlog sale released late (R2-L3)', async () => {
    const transferredFrom = '2026-10-13T00:00:00.000Z';
    await listPayouts({
      organizationId: ORG,
      status: 'paid',
      page: 1,
      limit: 100,
      transferredFrom,
    });
    const [orgId, params] = api.listPayouts.mock.calls[0] as [
      string,
      URLSearchParams,
    ];
    expect(orgId).toBe(ORG);
    expect(params.get('transferredFrom')).toBe(transferredFrom);
    expect(params.has('fromDate')).toBe(false);
  });

  it('a transferredFrom that is not a date is refused before anything is asked', async () => {
    await expect(
      listPayouts({ organizationId: ORG, transferredFrom: 'yesterday' })
    ).rejects.toMatchObject({ status: 400 });
    expect(api.listPayouts).not.toHaveBeenCalled();
  });
});
