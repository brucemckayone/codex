/**
 * Database fixture for e2e tests
 * Integrates with @codex/database for database setup and service instantiation
 * Uses REAL services with actual R2, Stripe, etc. - NO MOCKS
 *
 * NOTE: This uses a factory pattern for parallel test execution.
 * Each test file gets its own fixture instance.
 */

import { ContentAccessService } from '@codex/access';
import {
  createR2SigningClientFromEnv,
  type R2SigningClient,
} from '@codex/cloudflare-clients';
import { ContentService, MediaItemService } from '@codex/content';
import { closeDbPool, type DatabaseWs, dbWs } from '@codex/database';
import { ObservabilityClient } from '@codex/observability';
import { OrganizationService } from '@codex/organization';
import { createStripeClient, PurchaseService } from '@codex/purchase';

export interface DatabaseFixture {
  db: DatabaseWs;
  contentService: ContentService;
  mediaService: MediaItemService;
  orgService: OrganizationService;
  accessService: ContentAccessService;
  r2Client: R2SigningClient;
}

/**
 * Factory function to create a new database fixture instance.
 * Each test file should call this to get its own isolated fixture.
 *
 * NOTE: The underlying dbWs connection is shared (connection pool),
 * but the service instances are unique per fixture.
 */
export function createDatabaseFixture(): DatabaseFixture {
  // Use dbWs directly - already configured with environment variables
  const db = dbWs;
  const config = { db, environment: 'test' as const };

  // Real R2 client from environment variables
  const r2Client = createR2SigningClientFromEnv();

  // Real observability client
  const obs = new ObservabilityClient('e2e-tests', 'test');

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    throw new Error('STRIPE_SECRET_KEY is not set');
  }

  const stripe = createStripeClient(stripeSecretKey);

  return {
    db,
    r2Client,
    contentService: new ContentService(config),
    mediaService: new MediaItemService(config),
    orgService: new OrganizationService(config),
    accessService: new ContentAccessService({
      db: db,
      r2: r2Client,
      obs,
      purchaseService: new PurchaseService({ db, environment: 'test' }, stripe),
    }),
  };
}

// Legacy singleton for backward compatibility
// TODO: Migrate all tests to use createDatabaseFixture() directly
let fixtureInstance: DatabaseFixture | null = null;

/**
 * Setup database and instantiate services with REAL dependencies
 * Reuses existing instance if already set up (legacy behavior)
 *
 * @deprecated Use createDatabaseFixture() for parallel test execution
 */
export async function setupDatabaseFixture(): Promise<DatabaseFixture> {
  if (fixtureInstance) {
    return fixtureInstance;
  }

  fixtureInstance = createDatabaseFixture();
  return fixtureInstance;
}

/**
 * Teardown database connection
 *
 * @deprecated Use closeDbPool() directly for cleanup
 */
export async function teardownDatabaseFixture(): Promise<void> {
  if (fixtureInstance) {
    await closeDbPool();
    fixtureInstance = null;
  }
}
