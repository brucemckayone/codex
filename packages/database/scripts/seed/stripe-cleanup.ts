/**
 * Per-environment ownership of seed-created Stripe objects (Codex-1ilxl).
 *
 * THE PROBLEM. There is ONE Stripe test-mode account, shared by every
 * developer machine, every worktree, `seed-dev-db.yml`, and every CI run of
 * `testing.yml`. The seed used to tag its objects with `codex_seed: 'true'`
 * only, and its cleanup archived every active `codex_seed` product in the
 * WHOLE account. A seed run in one environment therefore archived the
 * products and prices that other live databases still referenced, and the
 * next subscription checkout there died with Stripe's
 * `The price specified is inactive` (a 500 on the Subscribe button). A 24h
 * age floor narrowed the window but could not close it: "my seed" and "your
 * seed" were indistinguishable.
 *
 * THE OWNERSHIP MODEL.
 *   - Every product, price, customer and subscription the seed creates carries
 *     `codex_seed_env: <env id>` (see `resolveSeedEnv` for the derivation).
 *   - A seed run archives ONLY objects tagged with its OWN env id:
 *       a) precisely the products its database referenced before TRUNCATE
 *          (no age floor — this database is about to be re-pointed at new
 *          products, so the old ones are provably ours and provably dead);
 *       b) any other own-env product older than 24h (recovers objects leaked
 *          by a run that created Stripe objects and then rolled back its
 *          transaction; the floor guards against an env-id collision).
 *   - A separate sweep reclaims `ci-*` namespaces older than 24h. CI
 *     databases are ephemeral Neon branches deleted at the end of the job, so
 *     nothing can still reference their objects after a day. Their customers
 *     are deleted too, which cancels the seed subscriptions hanging off them.
 *   - UNTAGGED objects (created before this model existed) are NEVER touched.
 *     We cannot know who owns them, and archiving the wrong one is exactly
 *     the bug this file exists to prevent. They are inert test-mode clutter.
 *   - Connect accounts are deliberately NOT namespaced — see
 *     `ensureSeededConnectAccount` in commerce.ts for why they stay shared.
 */

import { createHash } from 'node:crypto';
import { hostname as osHostname } from 'node:os';
import type Stripe from 'stripe';

/** Metadata key naming the environment that created a seed Stripe object. */
export const SEED_ENV_METADATA_KEY = 'codex_seed_env';

/** Env ids with this prefix belong to ephemeral CI databases. */
export const CI_SEED_ENV_PREFIX = 'ci-';

/**
 * Minimum age before a seed object is archived by the leak-recovery pass or
 * the CI sweep. A CI E2E job lives ~15 minutes, so a day is far beyond any
 * in-flight use of the objects it created.
 */
export const STRIPE_SEED_CLEANUP_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * The env id is interpolated into Stripe search queries, so it is held to a
 * charset that needs no escaping. An operator-supplied `CODEX_SEED_ENV`
 * outside it is refused rather than silently rewritten.
 */
const SEED_ENV_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}

/**
 * Identify the database a seed run writes to WITHOUT exposing credentials:
 * only host + database name are hashed. The URL itself is never returned or
 * logged. A local host (`localhost`) is not unique across machines — two
 * developers' `localhost/main` would otherwise share an env id and archive
 * each other's products — so the machine hostname is mixed in for those.
 */
function databaseFingerprint(
  databaseUrl: string | undefined,
  machineHostname: string
): string {
  if (!databaseUrl) {
    return shortHash(`no-database-url|${machineHostname}`);
  }
  let host: string;
  let dbName: string;
  try {
    const url = new URL(databaseUrl);
    host = url.hostname.toLowerCase();
    dbName = url.pathname.replace(/^\//, '');
  } catch {
    // Unparseable URL: fall back to the machine alone. Never echo the input.
    return shortHash(`unparseable-database-url|${machineHostname}`);
  }
  const machine = LOCAL_DB_HOSTS.has(host) ? machineHostname : '';
  return shortHash(`${host}|${dbName}|${machine}`);
}

/**
 * Resolve the env id stamped on (and used to scope cleanup of) every seed
 * Stripe object. Precedence:
 *
 *   1. `CODEX_SEED_ENV` — explicit, for long-lived shared databases such as
 *      the dev Neon branch (`seed-dev-db.yml` sets it).
 *   2. `ci-<GITHUB_RUN_ID>-<db hash>` when running in GitHub Actions. The run
 *      id alone is not enough: several jobs of one run can each seed their
 *      own Neon branch. The `ci-` prefix is what the stale-CI sweep keys on.
 *   3. `local-<db hash>` otherwise.
 */
export function resolveSeedEnv(
  env: NodeJS.ProcessEnv = process.env,
  machineHostname: string = osHostname()
): string {
  const explicit = env.CODEX_SEED_ENV?.trim();
  if (explicit) {
    if (!SEED_ENV_PATTERN.test(explicit)) {
      throw new Error(
        'CODEX_SEED_ENV must match /^[A-Za-z0-9_-]{1,64}$/ — it is used as a Stripe metadata search value.'
      );
    }
    return explicit;
  }

  const fingerprint = databaseFingerprint(env.DATABASE_URL, machineHostname);
  const runId = env.GITHUB_RUN_ID?.trim();
  if (runId && /^[0-9]+$/.test(runId)) {
    return `${CI_SEED_ENV_PREFIX}${runId}-${fingerprint}`;
  }
  return `local-${fingerprint}`;
}

// ── Pagination ──────────────────────────────────────────────────────────────

/** Walk every page of a Stripe search (`has_more` / `next_page`). */
async function searchAll<T>(
  search: (params: {
    query: string;
    limit: number;
    page?: string;
  }) => Promise<Stripe.ApiSearchResult<T>>,
  query: string
): Promise<T[]> {
  const results: T[] = [];
  let page: string | undefined;
  do {
    const res = await search({ query, limit: 100, page });
    results.push(...res.data);
    page = res.has_more && res.next_page ? res.next_page : undefined;
  } while (page);
  return results;
}

/** Walk every page of a product's active prices (`has_more` / cursor). */
async function listAllActivePrices(
  stripe: Stripe,
  productId: string
): Promise<Stripe.Price[]> {
  const results: Stripe.Price[] = [];
  let startingAfter: string | undefined;
  for (;;) {
    const res = await stripe.prices.list({
      product: productId,
      active: true,
      limit: 100,
      starting_after: startingAfter,
    });
    results.push(...res.data);
    const last = res.data.at(-1);
    if (!res.has_more || !last) break;
    startingAfter = last.id;
  }
  return results;
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

interface CleanupOptions {
  /** This run's env id, from `resolveSeedEnv`. */
  seedEnv: string;
  /**
   * `subscription_tiers.stripe_product_id` values this database held BEFORE
   * the seed truncated it. Only those tagged with `seedEnv` are archived.
   */
  previousProductIds?: readonly string[];
  /** Injectable clock for tests. */
  nowMs?: number;
}

export interface CleanupSummary {
  /** Own-env products this database referenced before TRUNCATE. */
  archivedOwnReferenced: number;
  /** Own-env products older than 24h that nothing referenced (leaks). */
  archivedOwnStale: number;
  /** Products from `ci-*` namespaces older than 24h. */
  archivedStaleCi: number;
  /** Customers from `ci-*` namespaces older than 24h (cancels their subs). */
  deletedStaleCiCustomers: number;
  /** Active seed products carrying no `codex_seed_env` tag — left alone. */
  skippedUntagged: number;
}

function envOf(obj: { metadata?: Stripe.Metadata | null }): string | undefined {
  const value = obj.metadata?.[SEED_ENV_METADATA_KEY];
  return value ? value : undefined;
}

function isStaleCiEnv(
  objEnv: string | undefined,
  seedEnv: string,
  created: number,
  cutoffSec: number
): boolean {
  return (
    objEnv !== undefined &&
    objEnv !== seedEnv &&
    objEnv.startsWith(CI_SEED_ENV_PREFIX) &&
    created < cutoffSec
  );
}

async function archiveProduct(
  stripe: Stripe,
  productId: string
): Promise<void> {
  // Stripe cannot delete a product that has prices, so archive both.
  for (const price of await listAllActivePrices(stripe, productId)) {
    await stripe.prices.update(price.id, { active: false });
  }
  await stripe.products.update(productId, { active: false });
}

function isResourceMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'resource_missing'
  );
}

/**
 * Archive the seed Stripe objects THIS environment owns, plus stale `ci-*`
 * namespaces. Never touches another live environment's objects or untagged
 * legacy objects. See the file header for the full ownership model.
 */
export async function cleanupStripeSeedObjects(
  stripe: Stripe,
  { seedEnv, previousProductIds = [], nowMs = Date.now() }: CleanupOptions
): Promise<CleanupSummary> {
  const summary: CleanupSummary = {
    archivedOwnReferenced: 0,
    archivedOwnStale: 0,
    archivedStaleCi: 0,
    deletedStaleCiCustomers: 0,
    skippedUntagged: 0,
  };
  const cutoffSec = Math.floor((nowMs - STRIPE_SEED_CLEANUP_MIN_AGE_MS) / 1000);
  const archived = new Set<string>();

  // (a) Precisely the products this database pointed at before TRUNCATE —
  // but only if they carry OUR tag. A shared database may have been seeded
  // by a different env id (e.g. a developer seeding the dev branch locally),
  // and an untagged product predates ownership entirely.
  for (const productId of new Set(previousProductIds)) {
    let product: Stripe.Product;
    try {
      product = await stripe.products.retrieve(productId);
    } catch (error) {
      if (isResourceMissing(error)) continue;
      throw error;
    }
    if (!product.active || envOf(product) !== seedEnv) continue;
    await archiveProduct(stripe, product.id);
    archived.add(product.id);
    summary.archivedOwnReferenced++;
  }

  // (b) + (c) One paginated walk over every active seed product.
  const seedProducts = await searchAll(
    (params) => stripe.products.search(params),
    "metadata['codex_seed']:'true' AND active:'true'"
  );
  for (const product of seedProducts) {
    if (archived.has(product.id)) continue;
    const productEnv = envOf(product);
    if (productEnv === undefined) {
      summary.skippedUntagged++;
      continue;
    }
    if (productEnv === seedEnv && product.created < cutoffSec) {
      await archiveProduct(stripe, product.id);
      archived.add(product.id);
      summary.archivedOwnStale++;
    } else if (isStaleCiEnv(productEnv, seedEnv, product.created, cutoffSec)) {
      await archiveProduct(stripe, product.id);
      archived.add(product.id);
      summary.archivedStaleCi++;
    }
  }

  // Stale CI customers. Deleting a customer cancels its subscriptions, which
  // would otherwise keep renewing on archived prices forever. Only `ci-*`
  // namespaces: a local or shared env reuses its customers on the next seed.
  const seedCustomers = await searchAll(
    (params) => stripe.customers.search(params),
    "metadata['codex_seed']:'true'"
  );
  for (const customer of seedCustomers) {
    if (isStaleCiEnv(envOf(customer), seedEnv, customer.created, cutoffSec)) {
      await stripe.customers.del(customer.id);
      summary.deletedStaleCiCustomers++;
    }
  }

  const ownTotal = summary.archivedOwnReferenced + summary.archivedOwnStale;
  if (ownTotal > 0) {
    console.log(
      `  🧹 Archived ${ownTotal} Stripe product(s) + prices owned by this environment`
    );
  }
  if (summary.archivedStaleCi > 0 || summary.deletedStaleCiCustomers > 0) {
    console.log(
      `  🧹 Swept stale CI seed objects (>24h): ${summary.archivedStaleCi} product(s), ${summary.deletedStaleCiCustomers} customer(s)`
    );
  }
  if (summary.skippedUntagged > 0) {
    console.log(
      `  ⏭ Left ${summary.skippedUntagged} untagged legacy seed product(s) alone — owner unknown`
    );
  }

  return summary;
}
