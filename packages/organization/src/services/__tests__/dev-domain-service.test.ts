/**
 * Unit tests for DevDomainService — closes the C5 coverage gap identified
 * in the routing-centralization epic's test audit (Codex-rscgk).
 *
 * Before WP-6, DevDomainService had ZERO unit-test coverage. These tests:
 *  - Pin the hostname format (snapshot via `ENV_HOSTS.dev.orgHost` alignment)
 *  - Cover ensureDevDomain / removeDevDomain / renameDevDomain happy paths
 *  - Verify the no-op guards (env=dev required, Cloudflare creds required)
 *  - Verify error handling (Cloudflare 5xx logged + swallowed, not thrown)
 *  - Mock the Cloudflare Workers Domains API via global fetch
 *
 * The service is fire-and-forget: org create/rename/delete operations
 * MUST NOT throw because of Cloudflare API hiccups. These tests enforce
 * that contract for every failure mode (network throw, non-2xx response,
 * malformed JSON body).
 *
 * Implementation note on the obs mock: BaseService's constructor
 * unconditionally creates its own ObservabilityClient — there's no
 * obs-injection path through config, and `vi.mock`'s lazy-factory
 * `vi.fn()` calls don't reliably register with vitest's spy matcher
 * (you get "Function info is not a spy" on `toHaveBeenCalledWith`).
 *
 * Workaround: let BaseService build the real client, then overwrite
 * `svc.obs` with a fresh `{ info, warn, error }` mock right after
 * construction. `protected obs` is mutable (no `readonly`), so the
 * service's internal `this.obs.info(...)` calls land on the mock.
 */

import { ENV_HOSTS } from '@codex/urls';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevDomainService } from '../dev-domain-service';

interface MockObs {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
}

function mockFetchOk(body: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response);
}

function mockFetchFail(
  status: number,
  body: string = '{}'
): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => JSON.parse(body),
    text: async () => body,
  } as unknown as Response);
}

interface MakeServiceOpts {
  environment?: string;
  apiToken?: string;
  accountId?: string;
}

function makeService(opts: MakeServiceOpts = {}): {
  svc: DevDomainService;
  obs: MockObs;
} {
  const svc = new DevDomainService({
    // DevDomainService doesn't query the DB — undefined is safe.
    db: undefined as never,
    environment: opts.environment ?? 'dev',
    // `in` check (not `??`) so callers can pass `apiToken: undefined`
    // explicitly to simulate "no creds" — `??` collapses explicit
    // undefined to the default, masking the missing-creds branch.
    cloudflareApiToken: 'apiToken' in opts ? opts.apiToken : 'test-token',
    cloudflareAccountId:
      'accountId' in opts ? opts.accountId : 'test-account-id',
    webWorkerName: 'codex-web-dev',
  });
  // Overwrite the real ObservabilityClient created by BaseService with
  // a fresh mock. `obs` is `protected` (not `readonly`), so subsequent
  // `this.obs.info(...)` calls inside the service hit our mock.
  const obs: MockObs = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  (svc as unknown as { obs: MockObs }).obs = obs;
  return { svc, obs };
}

describe('DevDomainService — hostname derivation (snapshot)', () => {
  it('hostnameFor produces ENV_HOSTS.dev.orgHost output for every slug shape', () => {
    // Pins THREE invariants at once for the WP-6 rewire:
    //   1. `DevDomainService.hostnameFor(slug)` (private, crossed via cast)
    //      returns `{slug}.dev.revelations.studio` — the OLD template's
    //      byte-equal output.
    //   2. That output equals `ENV_HOSTS.dev.orgHost(slug)` — proving the
    //      service is actually delegating to the centralized builder.
    //   3. The builder is stable across slug shapes (single char,
    //      reserved-ish words, multi-hyphen).
    // A future refactor that accidentally swapped `ENV_HOSTS.dev` for
    // `ENV_HOSTS.production` would orphan every dev custom domain — this
    // test catches that drift before it ships.
    const { svc } = makeService();
    const hostnameFor = (
      svc as unknown as { hostnameFor(slug: string): string }
    ).hostnameFor.bind(svc);
    const slugs = [
      'studio-alpha',
      'yoga-school',
      'cooking-101',
      'a',
      'creators',
      'admin',
      'multi-hyphen-slug-here',
    ];
    for (const slug of slugs) {
      const expected = `${slug}.dev.revelations.studio`;
      expect(hostnameFor(slug)).toBe(expected);
      expect(hostnameFor(slug)).toBe(ENV_HOSTS.dev.orgHost(slug));
    }
  });
});

describe('DevDomainService — guards (shouldRun)', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('ensureDevDomain is a no-op outside dev env', async () => {
    const fetchMock = mockFetchOk({});
    globalThis.fetch = fetchMock as never;

    const { svc, obs } = makeService({ environment: 'production' });
    await svc.ensureDevDomain('studio-alpha');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(obs.info).not.toHaveBeenCalled();
  });

  it('removeDevDomain is a no-op outside dev env', async () => {
    const fetchMock = mockFetchOk({});
    globalThis.fetch = fetchMock as never;

    const { svc } = makeService({ environment: 'development' });
    await svc.removeDevDomain('studio-alpha');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renameDevDomain is a no-op outside dev env', async () => {
    const fetchMock = mockFetchOk({});
    globalThis.fetch = fetchMock as never;

    const { svc } = makeService({ environment: 'staging' });
    await svc.renameDevDomain('old-slug', 'new-slug');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ensureDevDomain warns and no-ops when API token missing', async () => {
    const fetchMock = mockFetchOk({});
    globalThis.fetch = fetchMock as never;

    const { svc, obs } = makeService({ apiToken: undefined });
    await svc.ensureDevDomain('studio-alpha');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(obs.warn).toHaveBeenCalledWith(
      expect.stringContaining('Cloudflare creds missing'),
      expect.objectContaining({ slug: 'studio-alpha' })
    );
  });

  it('ensureDevDomain warns and no-ops when account ID missing', async () => {
    const fetchMock = mockFetchOk({});
    globalThis.fetch = fetchMock as never;

    const { svc } = makeService({ accountId: undefined });
    await svc.ensureDevDomain('studio-alpha');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renameDevDomain with equal slugs is a no-op (even in dev env)', async () => {
    const fetchMock = mockFetchOk({});
    globalThis.fetch = fetchMock as never;

    const { svc } = makeService();
    await svc.renameDevDomain('same-slug', 'same-slug');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('DevDomainService — ensureDevDomain (happy paths)', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('creates the Custom Domain when none exists', async () => {
    // First call: findDomain (list) → empty array (no match)
    // Second call: resolveZoneId → returns id
    // Third call: createDomain → 200 OK
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, result: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: [{ id: 'zone-abc-123' }],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{}',
      } as Response);
    globalThis.fetch = fetchMock as never;

    const { svc, obs } = makeService();
    await svc.ensureDevDomain('studio-alpha');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(obs.info).toHaveBeenCalledWith(
      'Dev custom domain created',
      expect.objectContaining({
        slug: 'studio-alpha',
        hostname: 'studio-alpha.dev.revelations.studio',
      })
    );
  });

  it('is idempotent — no-op when domain already exists', async () => {
    // findDomain returns the existing domain → skip create
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        result: [
          {
            id: 'existing-domain-id',
            hostname: 'studio-alpha.dev.revelations.studio',
            service: 'codex-web-dev',
          },
        ],
      }),
    } as Response);
    globalThis.fetch = fetchMock as never;

    const { svc, obs } = makeService();
    await svc.ensureDevDomain('studio-alpha');

    // Only ONE call (findDomain) — no create, no zone-id resolve
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(obs.info).toHaveBeenCalledWith(
      'Dev custom domain already exists',
      expect.objectContaining({ slug: 'studio-alpha' })
    );
  });
});

describe('DevDomainService — removeDevDomain', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('deletes the Custom Domain when it exists', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: [
            {
              id: 'domain-to-delete',
              hostname: 'studio-alpha.dev.revelations.studio',
              service: 'codex-web-dev',
            },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{}',
      } as Response);
    globalThis.fetch = fetchMock as never;

    const { svc, obs } = makeService();
    await svc.removeDevDomain('studio-alpha');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(obs.info).toHaveBeenCalledWith(
      'Dev custom domain removed',
      expect.objectContaining({ slug: 'studio-alpha' })
    );
  });

  it('no-ops silently when the domain does not exist', async () => {
    const fetchMock = mockFetchOk({ success: true, result: [] });
    globalThis.fetch = fetchMock as never;

    const { svc, obs } = makeService();
    await svc.removeDevDomain('studio-alpha');

    // Only ONE call (findDomain) — no delete
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(obs.info).not.toHaveBeenCalled();
  });
});

describe('DevDomainService — renameDevDomain', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('removes old slug and creates new slug', async () => {
    // removeDevDomain: findDomain → result (exists), then delete → ok
    // ensureDevDomain: findDomain → empty, resolveZoneId → id, create → ok
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: [
            {
              id: 'old-domain-id',
              hostname: 'old-slug.dev.revelations.studio',
              service: 'codex-web-dev',
            },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{}',
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, result: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: [{ id: 'zone-abc-123' }],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{}',
      } as Response);
    globalThis.fetch = fetchMock as never;

    const { svc, obs } = makeService();
    await svc.renameDevDomain('old-slug', 'new-slug');

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(obs.info).toHaveBeenCalledWith(
      'Dev custom domain removed',
      expect.objectContaining({ slug: 'old-slug' })
    );
    expect(obs.info).toHaveBeenCalledWith(
      'Dev custom domain created',
      expect.objectContaining({ slug: 'new-slug' })
    );
  });
});

describe('DevDomainService — error handling (logged + swallowed)', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('ensureDevDomain swallows network errors (does not throw)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('Network down'));
    globalThis.fetch = fetchMock as never;

    const { svc, obs } = makeService();
    // MUST NOT throw — org creation cannot depend on Cloudflare being up
    await expect(svc.ensureDevDomain('studio-alpha')).resolves.toBeUndefined();
    expect(obs.warn).toHaveBeenCalledWith(
      expect.stringContaining('ensureDevDomain failed'),
      expect.objectContaining({
        slug: 'studio-alpha',
        hostname: 'studio-alpha.dev.revelations.studio',
        error: 'Network down',
      })
    );
  });

  it('ensureDevDomain swallows Cloudflare 5xx (logged not thrown)', async () => {
    const fetchMock = vi
      .fn()
      // findDomain: empty result
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, result: [] }),
      } as Response)
      // resolveZoneId: success
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, result: [{ id: 'zone-1' }] }),
      } as Response)
      // createDomain: 502
      .mockResolvedValueOnce(mockFetchFail(502, '{"error":"bad gateway"}')());
    globalThis.fetch = fetchMock as never;

    const { svc, obs } = makeService();
    await expect(svc.ensureDevDomain('studio-alpha')).resolves.toBeUndefined();
    expect(obs.warn).toHaveBeenCalledWith(
      expect.stringContaining('ensureDevDomain failed'),
      expect.objectContaining({ slug: 'studio-alpha' })
    );
  });

  it('removeDevDomain swallows Cloudflare delete failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: [
            {
              id: 'd1',
              hostname: 'studio-alpha.dev.revelations.studio',
              service: 'codex-web-dev',
            },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce(mockFetchFail(500, 'Internal Server Error')());
    globalThis.fetch = fetchMock as never;

    const { svc, obs } = makeService();
    await expect(svc.removeDevDomain('studio-alpha')).resolves.toBeUndefined();
    expect(obs.warn).toHaveBeenCalledWith(
      expect.stringContaining('removeDevDomain failed'),
      expect.objectContaining({ slug: 'studio-alpha' })
    );
  });

  it('ensureDevDomain handles malformed zone-list response', async () => {
    const fetchMock = vi
      .fn()
      // findDomain: empty
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, result: [] }),
      } as Response)
      // resolveZoneId: success=false (Cloudflare returned an error envelope)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: false,
          errors: [{ message: 'Authentication failed' }],
        }),
      } as Response);
    globalThis.fetch = fetchMock as never;

    const { svc, obs } = makeService();
    await expect(svc.ensureDevDomain('studio-alpha')).resolves.toBeUndefined();
    expect(obs.warn).toHaveBeenCalled();
  });
});
