/**
 * Unit tests for the per-environment Stripe seed cleanup (Codex-1ilxl).
 *
 * The Stripe SDK is mocked — no network. These pin the ownership model:
 *   - an own-env product (referenced before TRUNCATE, or stale) is archived
 *   - another live environment's product is NEVER archived
 *   - an untagged legacy product is NEVER archived
 *   - a `ci-*` namespace older than 24h is swept (products + customers)
 *   - search pagination walks every page, not just the first 100
 */

import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import {
  cleanupStripeSeedObjects,
  resolveSeedEnv,
  STRIPE_SEED_CLEANUP_MIN_AGE_MS,
} from '../stripe-cleanup';

const NOW_MS = Date.UTC(2026, 8, 24, 12, 0, 0);
const NOW_SEC = Math.floor(NOW_MS / 1000);
const STALE_SEC = NOW_SEC - STRIPE_SEED_CLEANUP_MIN_AGE_MS / 1000 - 3600;
const FRESH_SEC = NOW_SEC - 600;

const MY_ENV = 'local-aaaaaaaaaaaa';
const OTHER_ENV = 'local-bbbbbbbbbbbb';

interface FakeObject {
  id: string;
  created: number;
  active?: boolean;
  metadata: Record<string, string>;
}

function product(
  id: string,
  created: number,
  env: string | undefined
): FakeObject {
  return {
    id,
    created,
    active: true,
    metadata: env
      ? { codex_seed: 'true', codex_seed_env: env }
      : { codex_seed: 'true' },
  };
}

/** A search mock that serves `pages` in order, following `next_page`. */
function pagedSearch(pages: FakeObject[][]) {
  return vi.fn(async (params: { page?: string }) => {
    const index = params.page ? Number(params.page.replace('page_', '')) : 0;
    const hasMore = index < pages.length - 1;
    return {
      object: 'search_result',
      data: pages[index] ?? [],
      has_more: hasMore,
      next_page: hasMore ? `page_${index + 1}` : null,
    };
  });
}

function buildMockStripe(opts: {
  productPages?: FakeObject[][];
  customerPages?: FakeObject[][];
  retrievable?: FakeObject[];
}) {
  const retrievable = new Map(
    (opts.retrievable ?? []).map((p) => [p.id, p] as const)
  );
  return {
    products: {
      search: pagedSearch(opts.productPages ?? [[]]),
      retrieve: vi.fn(async (id: string) => {
        const found = retrievable.get(id);
        if (!found) {
          throw Object.assign(new Error('No such product'), {
            code: 'resource_missing',
          });
        }
        return found;
      }),
      update: vi.fn(async (id: string) => ({ id, active: false })),
    },
    prices: {
      list: vi.fn(async ({ product: productId }: { product: string }) => ({
        object: 'list',
        data: [{ id: `${productId}_price_m` }, { id: `${productId}_price_y` }],
        has_more: false,
      })),
      update: vi.fn(async (id: string) => ({ id, active: false })),
    },
    customers: {
      search: pagedSearch(opts.customerPages ?? [[]]),
      del: vi.fn(async (id: string) => ({ id, deleted: true })),
    },
  };
}

type MockStripe = ReturnType<typeof buildMockStripe>;

function asStripe(mock: MockStripe): Stripe {
  return mock as unknown as Stripe;
}

function archivedProductIds(mock: MockStripe): string[] {
  return mock.products.update.mock.calls.map(([id]) => id);
}

describe('cleanupStripeSeedObjects', () => {
  it('archives an own-env product the database referenced, regardless of age', async () => {
    const mine = product('prod_mine_fresh', FRESH_SEC, MY_ENV);
    const mock = buildMockStripe({
      productPages: [[mine]],
      retrievable: [mine],
    });

    const summary = await cleanupStripeSeedObjects(asStripe(mock), {
      seedEnv: MY_ENV,
      previousProductIds: ['prod_mine_fresh'],
      nowMs: NOW_MS,
    });

    expect(archivedProductIds(mock)).toEqual(['prod_mine_fresh']);
    expect(summary.archivedOwnReferenced).toBe(1);
    // Its prices are archived before the product.
    expect(mock.prices.update.mock.calls.map(([id]) => id)).toEqual([
      'prod_mine_fresh_price_m',
      'prod_mine_fresh_price_y',
    ]);
  });

  it('archives a stale own-env product nothing references (leak recovery)', async () => {
    const mock = buildMockStripe({
      productPages: [[product('prod_mine_stale', STALE_SEC, MY_ENV)]],
    });

    const summary = await cleanupStripeSeedObjects(asStripe(mock), {
      seedEnv: MY_ENV,
      nowMs: NOW_MS,
    });

    expect(archivedProductIds(mock)).toEqual(['prod_mine_stale']);
    expect(summary.archivedOwnStale).toBe(1);
  });

  it('does NOT archive another live environment’s product, even when stale', async () => {
    const theirs = product('prod_other_stale', STALE_SEC, OTHER_ENV);
    const mock = buildMockStripe({
      productPages: [[theirs]],
      // Even if this database somehow referenced it, the tag says not ours.
      retrievable: [theirs],
    });

    await cleanupStripeSeedObjects(asStripe(mock), {
      seedEnv: MY_ENV,
      previousProductIds: ['prod_other_stale'],
      nowMs: NOW_MS,
    });

    expect(mock.products.update).not.toHaveBeenCalled();
    expect(mock.prices.update).not.toHaveBeenCalled();
  });

  it('does NOT archive an untagged legacy product, even when stale or referenced', async () => {
    const legacy = product('prod_legacy', STALE_SEC, undefined);
    const mock = buildMockStripe({
      productPages: [[legacy]],
      retrievable: [legacy],
    });

    const summary = await cleanupStripeSeedObjects(asStripe(mock), {
      seedEnv: MY_ENV,
      previousProductIds: ['prod_legacy'],
      nowMs: NOW_MS,
    });

    expect(mock.products.update).not.toHaveBeenCalled();
    expect(summary.skippedUntagged).toBe(1);
  });

  it('sweeps stale ci-* products and customers, sparing fresh ones', async () => {
    const mock = buildMockStripe({
      productPages: [
        [
          product('prod_ci_stale', STALE_SEC, 'ci-111-aaaaaaaaaaaa'),
          product('prod_ci_fresh', FRESH_SEC, 'ci-222-bbbbbbbbbbbb'),
        ],
      ],
      customerPages: [
        [
          product('cus_ci_stale', STALE_SEC, 'ci-111-aaaaaaaaaaaa'),
          product('cus_ci_fresh', FRESH_SEC, 'ci-222-bbbbbbbbbbbb'),
          product('cus_local_stale', STALE_SEC, OTHER_ENV),
          product('cus_legacy', STALE_SEC, undefined),
        ],
      ],
    });

    const summary = await cleanupStripeSeedObjects(asStripe(mock), {
      seedEnv: MY_ENV,
      nowMs: NOW_MS,
    });

    expect(archivedProductIds(mock)).toEqual(['prod_ci_stale']);
    expect(mock.customers.del.mock.calls.map(([id]) => id)).toEqual([
      'cus_ci_stale',
    ]);
    expect(summary.archivedStaleCi).toBe(1);
    expect(summary.deletedStaleCiCustomers).toBe(1);
  });

  it('walks every page of the product search', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) =>
      product(`prod_other_${i}`, STALE_SEC, OTHER_ENV)
    );
    const page2 = [product('prod_mine_page2', STALE_SEC, MY_ENV)];
    const page3 = [product('prod_ci_page3', STALE_SEC, 'ci-9-cccccccccccc')];
    const mock = buildMockStripe({ productPages: [page1, page2, page3] });

    await cleanupStripeSeedObjects(asStripe(mock), {
      seedEnv: MY_ENV,
      nowMs: NOW_MS,
    });

    expect(mock.products.search).toHaveBeenCalledTimes(3);
    expect(mock.products.search.mock.calls[1][0]).toMatchObject({
      page: 'page_1',
    });
    expect(archivedProductIds(mock).sort()).toEqual([
      'prod_ci_page3',
      'prod_mine_page2',
    ]);
  });

  it('walks every page of a product’s active prices', async () => {
    const mine = product('prod_many_prices', STALE_SEC, MY_ENV);
    const mock = buildMockStripe({ productPages: [[mine]] });
    mock.prices.list
      .mockResolvedValueOnce({
        object: 'list',
        data: [{ id: 'price_1' }, { id: 'price_2' }],
        has_more: true,
      })
      .mockResolvedValueOnce({
        object: 'list',
        data: [{ id: 'price_3' }],
        has_more: false,
      });

    await cleanupStripeSeedObjects(asStripe(mock), {
      seedEnv: MY_ENV,
      nowMs: NOW_MS,
    });

    expect(mock.prices.list).toHaveBeenCalledTimes(2);
    expect(mock.prices.list.mock.calls[1][0]).toMatchObject({
      starting_after: 'price_2',
    });
    expect(mock.prices.update.mock.calls.map(([id]) => id)).toEqual([
      'price_1',
      'price_2',
      'price_3',
    ]);
  });

  it('skips a referenced product that no longer exists in Stripe', async () => {
    const mock = buildMockStripe({ productPages: [[]] });

    await expect(
      cleanupStripeSeedObjects(asStripe(mock), {
        seedEnv: MY_ENV,
        previousProductIds: ['prod_gone'],
        nowMs: NOW_MS,
      })
    ).resolves.toMatchObject({ archivedOwnReferenced: 0 });
    expect(mock.products.update).not.toHaveBeenCalled();
  });
});

describe('resolveSeedEnv', () => {
  const DB_URL = 'postgresql://user:s3cret@ep-cool-db.neon.tech/neondb';

  it('prefers an explicit CODEX_SEED_ENV', () => {
    expect(
      resolveSeedEnv({ CODEX_SEED_ENV: 'dev-neon', GITHUB_RUN_ID: '42' }, 'mac')
    ).toBe('dev-neon');
  });

  it('rejects a CODEX_SEED_ENV that would need query escaping', () => {
    expect(() => resolveSeedEnv({ CODEX_SEED_ENV: "x' OR 'y" }, 'mac')).toThrow(
      /CODEX_SEED_ENV/
    );
  });

  it('uses ci-<run id>-<db hash> in GitHub Actions', () => {
    const env = resolveSeedEnv(
      { GITHUB_RUN_ID: '123456', DATABASE_URL: DB_URL },
      'runner'
    );
    expect(env).toMatch(/^ci-123456-[0-9a-f]{12}$/);
  });

  it('gives each database of one CI run its own namespace', () => {
    const a = resolveSeedEnv(
      { GITHUB_RUN_ID: '1', DATABASE_URL: DB_URL },
      'runner'
    );
    const b = resolveSeedEnv(
      {
        GITHUB_RUN_ID: '1',
        DATABASE_URL: 'postgresql://user:pw@ep-other.neon.tech/neondb',
      },
      'runner'
    );
    expect(a).not.toBe(b);
  });

  it('is stable locally and never contains credentials', () => {
    const a = resolveSeedEnv({ DATABASE_URL: DB_URL }, 'mac');
    const b = resolveSeedEnv({ DATABASE_URL: DB_URL }, 'mac');
    expect(a).toBe(b);
    expect(a).toMatch(/^local-[0-9a-f]{12}$/);
    expect(a).not.toContain('s3cret');
    // Password changes do not move the namespace (host + db name only).
    expect(
      resolveSeedEnv(
        {
          DATABASE_URL: 'postgresql://user:rotated@ep-cool-db.neon.tech/neondb',
        },
        'mac'
      )
    ).toBe(a);
  });

  it('separates two machines that both seed localhost', () => {
    const url = 'postgresql://postgres:pw@localhost:5432/main';
    expect(resolveSeedEnv({ DATABASE_URL: url }, 'alice')).not.toBe(
      resolveSeedEnv({ DATABASE_URL: url }, 'bob')
    );
  });
});
