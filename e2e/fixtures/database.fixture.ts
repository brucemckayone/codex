/**
 * Database fixture for e2e tests
 * Integrates with @codex/database for database setup and service instantiation
 * Uses REAL services with actual R2, Stripe, etc. - NO MOCKS
 */

import { ContentAccessService } from '@codex/access';
import {
  createR2SigningClientFromEnv,
  type R2SigningClient,
} from '@codex/cloudflare-clients';
import { ContentService, MediaItemService } from '@codex/content';
import { closeDbPool, type DatabaseWs, dbWs } from '@codex/database';
import { OrganizationService } from '@codex/identity';
import { ObservabilityClient } from '@codex/observability';
import { createStripeClient, PurchaseService } from '@codex/purchase';

export interface DatabaseFixture {
  db: DatabaseWs;
  contentService: ContentService;
  mediaService: MediaItemService;
  orgService: OrganizationService;
  accessService: ContentAccessService;
  r2Client: R2SigningClient;
}

let fixtureInstance: DatabaseFixture | null = null;

/**
 * Setup database and instantiate services with REAL dependencies
 * Reuses existing instance if already set up
 */
export async function setupDatabaseFixture(): Promise<DatabaseFixture> {
  if (fixtureInstance) {
    return fixtureInstance;
  }

  // Use dbWs directly - already configured with environment variables
  const db = dbWs;
  const config = { db, environment: 'test' as const };

  // Real R2 client from environment variables
  const r2Client = createR2SigningClientFromEnv();

  // Real observability client
  const obs = new ObservabilityClient('e2e-tests', 'test');
  // MAY NOT BE RIGHT
  const stripe = createStripeClient(process.env.STRIPE_SECRET_KEY!);

  fixtureInstance = {
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

  return fixtureInstance;
}

/**
 * Teardown database connection
 */
export async function teardownDatabaseFixture(): Promise<void> {
  if (fixtureInstance) {
    await closeDbPool();
    fixtureInstance = null;
  }
}
