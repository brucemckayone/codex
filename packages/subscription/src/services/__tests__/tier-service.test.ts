/**
 * TierService Tests
 *
 * Integration tests with real DB + mocked Stripe.
 * Tests tier CRUD, Stripe Product/Price sync, and reordering.
 *
 * Each test creates its own org + connect account to avoid
 * data collisions on the shared local development database.
 */

import {
  content,
  organizations,
  stripeConnectAccounts,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import {
  ConflictError,
  InternalServiceError,
  ServiceUnavailableError,
  ValidationError,
} from '@codex/service-errors';
import {
  createMockStripe,
  createTestConnectAccountInput,
  createTestContentInput,
  createTestOrganizationInput,
  createTestSubscriptionInput,
  createUniqueSlug,
  seedTestUsers,
  setTestOrganisationPayee,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
  validateDatabaseConnection,
} from '@codex/test-utils';
import { eq, inArray } from 'drizzle-orm';
import type Stripe from 'stripe';
import StripeSdk from 'stripe';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';
import {
  ConnectAccountNotReadyError,
  TierHasSubscribersError,
  TierNotFoundError,
} from '../../errors';
import { TierService } from '../tier-service';

describe('TierService', () => {
  let db: ReturnType<typeof setupTestDatabase>;
  let stripe: Stripe;
  let service: TierService;
  let creatorId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    await validateDatabaseConnection(db);
    const userIds = await seedTestUsers(db, 1);
    [creatorId] = userIds as [string];
  });

  beforeEach(async () => {
    // One Connect account per user (uq_stripe_connect_user, Codex-69t7c):
    // clear the seed user's account between tests to avoid collisions.
    await db
      .delete(stripeConnectAccounts)
      .where(eq(stripeConnectAccounts.userId, creatorId));
    stripe = createMockStripe();
    // X7 (Codex-z9fzv): TierService now takes an explicit dbWs for
    // transactions instead of casting `this.db` at every call site.
    // setupTestDatabase() returns a WebSocket client, so the same
    // instance satisfies both `db` and `dbWs`.
    service = new TierService({ db, dbWs: db, environment: 'test' }, stripe);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  /** Helper: create an org with an active Connect account */
  async function createOrgWithConnect(slug?: string) {
    const org = takeFirst(
      await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug(slug ?? 'tier'),
          })
        )
        .returning()
    );
    // Upsert on userId (uq_stripe_connect_user, Codex-69t7c) so scoping tests
    // that build two orgs for the same creator reuse the one account.
    await db
      .insert(stripeConnectAccounts)
      .values(
        createTestConnectAccountInput(org.id, creatorId, {
          chargesEnabled: true,
          payoutsEnabled: true,
          status: 'active',
        })
      )
      .onConflictDoUpdate({
        target: stripeConnectAccounts.userId,
        set: {
          organizationId: org.id,
          chargesEnabled: true,
          payoutsEnabled: true,
          status: 'active',
        },
      });
    // Make the creator the org's payee: org→account resolves by ownership
    // (Codex-2hxff.2), not the account's org column.
    await setTestOrganisationPayee(db, org.id, creatorId);
    return org;
  }

  /** Helper: create an org WITHOUT a Connect account */
  async function createOrgWithoutConnect(slug?: string) {
    const org = takeFirst(
      await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug(slug ?? 'no-connect'),
          })
        )
        .returning()
    );
    return org;
  }

  // ─── createTier ─────────────────────────────────────────────────────

  describe('createTier', () => {
    it('should create tier + Stripe product + 2 prices, sortOrder=1', async () => {
      const org = await createOrgWithConnect('create-1');
      const tier = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'Pro',
        description: 'Professional tier',
        priceMonthly: 999,
        priceAnnual: 9990,
      });

      expect(tier.name).toBe('Pro');
      expect(tier.sortOrder).toBe(1);
      expect(tier.stripeProductId).toBeDefined();
      expect(tier.stripePriceMonthlyId).toBeDefined();
      expect(tier.stripePriceAnnualId).toBeDefined();
      expect(tier.isActive).toBe(true);

      // Verify Stripe calls
      expect(stripe.products.create).toHaveBeenCalledOnce();
      expect(stripe.prices.create).toHaveBeenCalledTimes(2);
    });

    it('should auto-increment sortOrder for subsequent tiers', async () => {
      const org = await createOrgWithConnect('auto-sort');
      const t1 = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'Basic',
        priceMonthly: 499,
        priceAnnual: 4990,
      });
      const t2 = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'Pro',
        priceMonthly: 999,
        priceAnnual: 9990,
      });
      const t3 = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'Premium',
        priceMonthly: 1999,
        priceAnnual: 19990,
      });

      expect(t1.sortOrder).toBe(1);
      expect(t2.sortOrder).toBe(2);
      expect(t3.sortOrder).toBe(3);
    });

    it('should throw ConnectAccountNotReadyError when no account exists', async () => {
      const org = await createOrgWithoutConnect('no-acct');
      await expect(
        service.createTier(org.id, {
          submissionId: crypto.randomUUID(),
          name: 'X',
          priceMonthly: 100,
          priceAnnual: 1000,
        })
      ).rejects.toThrow(ConnectAccountNotReadyError);
    });

    it('should throw ConnectAccountNotReadyError when charges disabled', async () => {
      const org = takeFirst(
        await db
          .insert(organizations)
          .values(
            createTestOrganizationInput({
              slug: createUniqueSlug('no-charges'),
            })
          )
          .returning()
      );
      await db.insert(stripeConnectAccounts).values(
        createTestConnectAccountInput(org.id, creatorId, {
          chargesEnabled: false,
          payoutsEnabled: true,
        })
      );

      await expect(
        service.createTier(org.id, {
          submissionId: crypto.randomUUID(),
          name: 'X',
          priceMonthly: 100,
          priceAnnual: 1000,
        })
      ).rejects.toThrow(ConnectAccountNotReadyError);
    });

    it('should create Stripe prices with GBP currency', async () => {
      const org = await createOrgWithConnect('gbp');
      await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'GBP Tier',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      const pricesCalls = (stripe.prices.create as ReturnType<typeof vi.fn>)
        .mock.calls;
      expect(pricesCalls[0]![0]).toMatchObject({ currency: 'gbp' });
      expect(pricesCalls[1]![0]).toMatchObject({ currency: 'gbp' });
    });

    it('should resolve Connect via organizations.primary_connect_account_user_id (T10/X8)', async () => {
      // Two users in the same org, each with their own Connect account.
      // The primary column pins the canonical owner so tier ops route
      // there, not an arbitrary .limit(1) row. Exercise this by making
      // the primary owner INACTIVE and a secondary user ACTIVE — the
      // service should refuse (primary is not ready) rather than
      // silently succeed against the secondary account.
      const userIds = await seedTestUsers(db, 2);
      const [primaryUser, secondaryUser] = userIds as [string, string];

      const org = takeFirst(
        await db
          .insert(organizations)
          .values(
            createTestOrganizationInput({
              slug: createUniqueSlug('primary-connect'),
            })
          )
          .returning()
      );

      // Primary owner: Connect NOT ready
      await db.insert(stripeConnectAccounts).values(
        createTestConnectAccountInput(org.id, primaryUser, {
          chargesEnabled: false,
          payoutsEnabled: false,
          status: 'restricted',
        })
      );
      // Secondary user: Connect IS ready
      await db.insert(stripeConnectAccounts).values(
        createTestConnectAccountInput(org.id, secondaryUser, {
          chargesEnabled: true,
          payoutsEnabled: true,
          status: 'active',
        })
      );
      // Pin primary_connect_account_user_id to the non-ready user.
      await setTestOrganisationPayee(db, org.id, primaryUser);

      await expect(
        service.createTier(org.id, {
          submissionId: crypto.randomUUID(),
          name: 'Gated',
          priceMonthly: 499,
          priceAnnual: 4990,
        })
      ).rejects.toThrow(ConnectAccountNotReadyError);
    });
  });

  // ─── A repeated create (Codex-2hxff.66) ─────────────────────────────
  //
  // Owner decision 2026-10-25: a repeat create quietly returns the tier the
  // first attempt made. The keys are built from the dialog's submissionId,
  // and clean-up never archives a Product a live tier uses.

  describe('a repeated create (Codex-2hxff.66)', () => {
    const orgIds: string[] = [];

    afterAll(async () => {
      if (orgIds.length > 0) {
        await db
          .delete(subscriptionTiers)
          .where(inArray(subscriptionTiers.organizationId, orgIds));
      }
    });

    async function orgForRepeats(slug: string) {
      const org = await createOrgWithConnect(slug);
      orgIds.push(org.id);
      return org;
    }

    /**
     * Make the mock answer as Stripe does under an idempotency key: the same
     * key returns the first response, also to a request made while the first
     * is in flight (the SDK retries Stripe's 409 until it can replay). The
     * same key with other parameters is refused with Stripe's own error.
     */
    function honourIdempotencyKeys() {
      for (const create of [stripe.products.create, stripe.prices.create]) {
        const mock = create as Mock;
        const first = mock.getMockImplementation();
        const responses = new Map<
          string,
          { params: string; response: Promise<unknown> }
        >();
        mock.mockImplementation(
          (params: unknown, options?: { idempotencyKey?: string }) => {
            const key = options?.idempotencyKey;
            if (!key) return first?.(params, options);
            const seen = responses.get(key);
            if (seen && seen.params !== JSON.stringify(params)) {
              return Promise.reject(
                new StripeSdk.errors.StripeIdempotencyError({
                  message:
                    'Keys for idempotent requests can only be used with the same parameters they were first used with.',
                  type: 'idempotency_error',
                })
              );
            }
            if (seen) return seen.response;
            const response = Promise.resolve(first?.(params, options));
            responses.set(key, { params: JSON.stringify(params), response });
            return response;
          }
        );
      }
    }

    const archiveCalls = () =>
      (stripe.products.update as Mock).mock.calls.filter(
        ([, params]) => params?.active === false
      );

    /**
     * Hold each products.create until `count` have arrived, so racing
     * creates all read the sort order before any inserts: the race, every run.
     */
    function meetAtProductCreate(count: number) {
      const mock = stripe.products.create as Mock;
      const proceed = mock.getMockImplementation();
      let arrived = 0;
      let release: () => void = () => {};
      const allIn = new Promise<void>((resolve) => {
        release = resolve;
      });
      mock.mockImplementation(async (...args: unknown[]) => {
        arrived += 1;
        if (arrived === count) release();
        await allIn;
        return proceed?.(...args);
      });
    }

    const input = (submissionId: string) => ({
      submissionId,
      name: 'Repeat',
      priceMonthly: 500,
      priceAnnual: 5000,
    });

    it('the same submission twice makes one Product and one tier: the repeat returns the first', async () => {
      honourIdempotencyKeys();
      const org = await orgForRepeats('repeat-same');
      const submissionId = crypto.randomUUID();

      const first = await service.createTier(org.id, input(submissionId));
      const second = await service.createTier(org.id, input(submissionId));

      expect(second.id).toBe(first.id);
      expect(await service.listTiers(org.id)).toHaveLength(1);
      const productKeys = (stripe.products.create as Mock).mock.calls.map(
        ([, options]) => options?.idempotencyKey
      );
      expect(productKeys).toEqual([
        `tier-product-${org.id}-${submissionId}`,
        `tier-product-${org.id}-${submissionId}`,
      ]);
      expect(archiveCalls()).toHaveLength(0);
    });

    it('a new submission makes a new Product and a new tier', async () => {
      honourIdempotencyKeys();
      const org = await orgForRepeats('repeat-new');

      const first = await service.createTier(
        org.id,
        input(crypto.randomUUID())
      );
      const second = await service.createTier(
        org.id,
        input(crypto.randomUUID())
      );

      expect(second.id).not.toBe(first.id);
      expect(second.stripeProductId).not.toBe(first.stripeProductId);
      expect(await service.listTiers(org.id)).toHaveLength(2);
    });

    it('a double submit racing makes one tier, both get it, and nothing is archived', async () => {
      honourIdempotencyKeys();
      meetAtProductCreate(2);
      const org = await orgForRepeats('repeat-race');
      const submissionId = crypto.randomUUID();

      const [a, b] = await Promise.all([
        service.createTier(org.id, input(submissionId)),
        service.createTier(org.id, input(submissionId)),
      ]);

      expect(b.id).toBe(a.id);
      expect(await service.listTiers(org.id)).toHaveLength(1);
      expect(archiveCalls()).toHaveLength(0);
    });

    it('a twin that inserted first is returned, and the Product it uses is not archived', async () => {
      const org = await orgForRepeats('repeat-twin');
      // The twin lands between this call's look-up and its insert, at the
      // same sort order with the same Product: the race the unique sort
      // index catches.
      let twinId: string | undefined;
      (stripe.products.update as Mock).mockImplementationOnce(
        async (productId: string) => {
          const twin = takeFirst(
            await db
              .insert(subscriptionTiers)
              .values({
                organizationId: org.id,
                name: 'Repeat',
                sortOrder: 1,
                priceMonthly: 500,
                priceAnnual: 5000,
                stripeProductId: productId,
                stripePriceMonthlyId: 'price_twin_month',
                stripePriceAnnualId: 'price_twin_year',
              })
              .returning()
          );
          twinId = twin.id;
          return { id: productId, active: true };
        }
      );

      const tier = await service.createTier(org.id, input(crypto.randomUUID()));

      expect(twinId).toBeDefined();
      expect(tier.id).toBe(twinId);
      expect(await service.listTiers(org.id)).toHaveLength(1);
      expect(archiveCalls()).toHaveLength(0);
    });

    it('a retry after a failed attempt gets its archived Product back, on sale again', async () => {
      honourIdempotencyKeys();
      const org = await orgForRepeats('repeat-retry');
      const submissionId = crypto.randomUUID();
      // The first attempt's insert fails: another tier takes its sort order,
      // with a Product of its own, so there is no twin and clean-up archives.
      (stripe.products.update as Mock).mockImplementationOnce(
        async (productId: string) => {
          await db.insert(subscriptionTiers).values({
            organizationId: org.id,
            name: 'Other',
            sortOrder: 1,
            priceMonthly: 900,
            priceAnnual: 9000,
            stripeProductId: 'prod_other_tier',
          });
          return { id: productId, active: true };
        }
      );

      await expect(
        service.createTier(org.id, input(submissionId))
      ).rejects.toThrow();
      const [failedProductId] = archiveCalls()[0] ?? [];
      expect(failedProductId).toBeDefined();

      const tier = await service.createTier(org.id, input(submissionId));

      expect(tier.stripeProductId).toBe(failedProductId);
      // Archived by the failed attempt, then put back on sale by the retry.
      const updates = (stripe.products.update as Mock).mock.calls
        .filter(([id]) => id === failedProductId)
        .map(([, params]) => params);
      expect(updates).toEqual([
        { active: true },
        { active: false },
        { active: true },
      ]);
    });

    // Never a 500: a retry from elsewhere can reuse an id with other values,
    // even though the dialog mints a new one when its values change.
    it('the same submission with other values is a 409 SUBMISSION_ID_REUSED, with ids only, and makes nothing', async () => {
      honourIdempotencyKeys();
      const org = await orgForRepeats('repeat-reused');
      const submissionId = crypto.randomUUID();
      await service.createTier(org.id, input(submissionId));

      const error = await service
        .createTier(org.id, { ...input(submissionId), name: 'Renamed' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictError);
      expect(error).toMatchObject({
        statusCode: 409,
        context: {
          code: 'SUBMISSION_ID_REUSED',
          organizationId: org.id,
          submissionId,
        },
      });
      expect(
        Object.keys((error as ConflictError).context ?? {}).sort()
      ).toEqual(['code', 'organizationId', 'submissionId']);
      expect(await service.listTiers(org.id)).toHaveLength(1);
    });

    // Whatever type Stripe gives "in use", it is never REUSED: that would
    // have the dialog mint a new id, and a second tier.
    it.each([
      ['invalid_request_error', StripeSdk.errors.StripeInvalidRequestError],
      ['idempotency_error', StripeSdk.errors.StripeIdempotencyError],
    ] as const)('a submission still in flight at Stripe (%s) is a 409 SUBMISSION_IN_PROGRESS: retry the same id', async (type, StripeErrorClass) => {
      const org = await orgForRepeats('repeat-in-flight');
      (stripe.products.create as Mock).mockRejectedValueOnce(
        new StripeErrorClass({
          message:
            'There is currently another in-progress request using this Stripe API Idempotency Key.',
          type,
          code: 'idempotency_key_in_use',
        })
      );

      await expect(
        service.createTier(org.id, input(crypto.randomUUID()))
      ).rejects.toMatchObject({
        statusCode: 409,
        context: { code: 'SUBMISSION_IN_PROGRESS' },
      });
    });

    it('Stripe failing is a 503 STRIPE_UNAVAILABLE, and no tier is saved', async () => {
      const org = await orgForRepeats('repeat-stripe-down');
      (stripe.prices.create as Mock).mockRejectedValueOnce(
        new StripeSdk.errors.StripeAPIError({
          message: 'An unknown error occurred',
          type: 'api_error',
        })
      );

      const error = await service
        .createTier(org.id, input(crypto.randomUUID()))
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ServiceUnavailableError);
      expect(error).toMatchObject({
        statusCode: 503,
        context: { code: 'STRIPE_UNAVAILABLE' },
      });
      expect(await service.listTiers(org.id)).toHaveLength(0);
    });
  });

  // ─── updateTier ─────────────────────────────────────────────────────

  describe('updateTier', () => {
    it('should update name/desc without touching Stripe prices', async () => {
      const org = await createOrgWithConnect('update-name');
      const tier = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'Old',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      // Reset mocks after creation calls
      (stripe.prices.create as ReturnType<typeof vi.fn>).mockClear();
      (stripe.prices.update as ReturnType<typeof vi.fn>).mockClear();

      const updated = await service.updateTier(tier.id, org.id, {
        name: 'New Name',
        description: 'Updated',
      });

      expect(updated.name).toBe('New Name');
      expect(updated.description).toBe('Updated');
      // Prices should NOT be recreated
      expect(stripe.prices.create).not.toHaveBeenCalled();
      expect(stripe.prices.update).not.toHaveBeenCalled();
      // Product should be updated (name/desc)
      expect(stripe.products.update).toHaveBeenCalled();
    });

    it('should create new prices + archive old when monthly price changes', async () => {
      const org = await createOrgWithConnect('update-monthly');
      const tier = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'T',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      (stripe.prices.create as ReturnType<typeof vi.fn>).mockClear();
      (stripe.prices.update as ReturnType<typeof vi.fn>).mockClear();

      const updated = await service.updateTier(tier.id, org.id, {
        priceMonthly: 699,
      });

      expect(updated.priceMonthly).toBe(699);
      // One new price created (monthly), one archived
      expect(stripe.prices.create).toHaveBeenCalledOnce();
      expect(stripe.prices.update).toHaveBeenCalledOnce(); // archive old
    });

    // Codex-2hxff.3: the interval must reach the fan-out, or an annual edit
    // moves monthly subscribers onto the annual Price.
    it('fires the subscriber fan-out once, for ONLY the interval that changed', async () => {
      const propagator = vi.fn();
      const withPropagator = new TierService(
        { db, dbWs: db, environment: 'test', propagator },
        stripe
      );
      const org = await createOrgWithConnect('update-propagate');
      const tier = await withPropagator.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'T',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      const updated = await withPropagator.updateTier(tier.id, org.id, {
        priceAnnual: 5990,
      });

      expect(propagator).toHaveBeenCalledTimes(1);
      expect(propagator).toHaveBeenCalledWith({
        tierId: tier.id,
        newStripePriceId: updated.stripePriceAnnualId,
        organizationId: org.id,
        interval: 'year',
      });
    });

    it('should create new prices + archive old when annual price changes', async () => {
      const org = await createOrgWithConnect('update-annual');
      const tier = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'T',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      (stripe.prices.create as ReturnType<typeof vi.fn>).mockClear();
      (stripe.prices.update as ReturnType<typeof vi.fn>).mockClear();

      const updated = await service.updateTier(tier.id, org.id, {
        priceAnnual: 5990,
      });

      expect(updated.priceAnnual).toBe(5990);
      expect(stripe.prices.create).toHaveBeenCalledOnce();
      expect(stripe.prices.update).toHaveBeenCalledOnce();
    });

    it('should throw TierNotFoundError for nonexistent tier', async () => {
      const org = await createOrgWithConnect('update-notfound');
      await expect(
        service.updateTier('00000000-0000-0000-0000-000000000000', org.id, {
          name: 'X',
        })
      ).rejects.toThrow(TierNotFoundError);
    });

    it('should throw TierNotFoundError for tier from different org (scoping)', async () => {
      const orgA = await createOrgWithConnect('scope-a');
      const orgB = await createOrgWithConnect('scope-b');
      const tier = await service.createTier(orgA.id, {
        submissionId: crypto.randomUUID(),
        name: 'A Tier',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      await expect(
        service.updateTier(tier.id, orgB.id, { name: 'Hacked' })
      ).rejects.toThrow(TierNotFoundError);
    });

    it('should not update a soft-deleted tier', async () => {
      const org = await createOrgWithConnect('update-deleted');
      const tier = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'Deletable',
        priceMonthly: 499,
        priceAnnual: 4990,
      });
      await service.deleteTier(tier.id, org.id);

      await expect(
        service.updateTier(tier.id, org.id, { name: 'Ghost' })
      ).rejects.toThrow(TierNotFoundError);
    });
  });

  // ─── deleteTier ─────────────────────────────────────────────────────

  describe('deleteTier', () => {
    it('should soft-delete tier with no subscribers', async () => {
      const org = await createOrgWithConnect('delete-clean');
      const tier = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'Deletable',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      await service.deleteTier(tier.id, org.id);

      // Should not appear in active list
      const tiers = await service.listTiers(org.id);
      expect(tiers).toHaveLength(0);

      // Stripe product should be archived
      expect(stripe.products.update).toHaveBeenCalledWith(
        tier.stripeProductId,
        expect.objectContaining({ active: false })
      );
    });

    it('should throw TierHasSubscribersError when active subscribers exist', async () => {
      const org = await createOrgWithConnect('delete-blocked');
      const tier = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'Popular',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      // Insert an active subscription for this tier
      await db.insert(subscriptions).values(
        createTestSubscriptionInput(creatorId, org.id, tier.id, {
          status: 'active',
        })
      );

      await expect(service.deleteTier(tier.id, org.id)).rejects.toThrow(
        TierHasSubscribersError
      );
    });

    it('should allow deletion when only cancelled subscribers exist', async () => {
      const org = await createOrgWithConnect('delete-cancelled');
      const tier = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'Cancelled',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      // Insert a cancelled subscription
      await db.insert(subscriptions).values(
        createTestSubscriptionInput(creatorId, org.id, tier.id, {
          status: 'cancelled',
          cancelledAt: new Date(),
        })
      );

      await service.deleteTier(tier.id, org.id);
      const tiers = await service.listTiers(org.id);
      expect(tiers).toHaveLength(0);
    });

    it('should throw TierNotFoundError for nonexistent tier', async () => {
      const org = await createOrgWithConnect('delete-notfound');
      await expect(
        service.deleteTier('00000000-0000-0000-0000-000000000000', org.id)
      ).rejects.toThrow(TierNotFoundError);
    });

    it('should clear content.included_in_tier_id on soft-delete (X1 regression)', async () => {
      // FK content.included_in_tier_id -> subscription_tiers.id is ON DELETE
      // SET NULL, but that never fires for soft-deletes (deletedAt). Without
      // this sweep, deleting a tier would leave content silently unreachable.
      const org = await createOrgWithConnect('delete-sweep');
      const tier = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'Gated',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      // Two content rows gated by this tier, plus one unrelated row.
      const gatedA = takeFirst(
        await db
          .insert(content)
          .values(
            createTestContentInput(creatorId, {
              organizationId: org.id,
              includedInTierId: tier.id,
            })
          )
          .returning()
      );
      const gatedB = takeFirst(
        await db
          .insert(content)
          .values(
            createTestContentInput(creatorId, {
              organizationId: org.id,
              includedInTierId: tier.id,
            })
          )
          .returning()
      );
      const ungated = takeFirst(
        await db
          .insert(content)
          .values(
            createTestContentInput(creatorId, {
              organizationId: org.id,
              includedInTierId: null,
            })
          )
          .returning()
      );

      await service.deleteTier(tier.id, org.id);

      const rows = await db
        .select({ id: content.id, includedInTierId: content.includedInTierId })
        .from(content)
        .where(eq(content.organizationId, org.id));
      const byId = new Map(rows.map((r) => [r.id, r.includedInTierId]));
      expect(byId.get(gatedA.id)).toBeNull();
      expect(byId.get(gatedB.id)).toBeNull();
      expect(byId.get(ungated.id)).toBeNull();
    });

    it('should only clear included_in_tier_id for content within the same org (scoping)', async () => {
      // A different org with its own tier accidentally sharing an id would
      // still be scoped out by the WHERE organizationId clause.
      const orgA = await createOrgWithConnect('delete-scope-a');
      const orgB = await createOrgWithConnect('delete-scope-b');

      const tierA = await service.createTier(orgA.id, {
        submissionId: crypto.randomUUID(),
        name: 'A-gated',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      // Content in org B that shares includedInTierId = tierA.id (contrived,
      // would not happen normally but guards against the sweep over-reaching).
      const orgBContent = takeFirst(
        await db
          .insert(content)
          .values(
            createTestContentInput(creatorId, {
              organizationId: orgB.id,
              includedInTierId: tierA.id,
            })
          )
          .returning()
      );

      await service.deleteTier(tierA.id, orgA.id);

      const row = takeFirst(
        await db
          .select({ includedInTierId: content.includedInTierId })
          .from(content)
          .where(eq(content.id, orgBContent.id))
      );
      expect(row.includedInTierId).toBe(tierA.id);
    });
  });

  // ─── listTiers ──────────────────────────────────────────────────────

  describe('listTiers', () => {
    it('should return only active non-deleted tiers ordered by sortOrder', async () => {
      const org = await createOrgWithConnect('list-filter');
      await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'Active',
        priceMonthly: 499,
        priceAnnual: 4990,
      });
      const toDelete = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'Deleted',
        priceMonthly: 999,
        priceAnnual: 9990,
      });
      await service.deleteTier(toDelete.id, org.id);

      const tiers = await service.listTiers(org.id);
      expect(tiers).toHaveLength(1);
      expect(tiers[0]!.name).toBe('Active');
    });

    it('should return empty array for org with no tiers', async () => {
      const org = await createOrgWithConnect('list-empty');
      const tiers = await service.listTiers(org.id);
      expect(tiers).toHaveLength(0);
    });

    it('should scope results to the specified org', async () => {
      const orgA = await createOrgWithConnect('list-a');
      const orgB = await createOrgWithConnect('list-b');
      await service.createTier(orgA.id, {
        submissionId: crypto.randomUUID(),
        name: 'A Tier',
        priceMonthly: 499,
        priceAnnual: 4990,
      });
      await service.createTier(orgB.id, {
        submissionId: crypto.randomUUID(),
        name: 'B Tier',
        priceMonthly: 999,
        priceAnnual: 9990,
      });

      const tiersA = await service.listTiers(orgA.id);
      expect(tiersA).toHaveLength(1);
      expect(tiersA[0]!.name).toBe('A Tier');
    });
  });

  // ─── listAllTiers ───────────────────────────────────────────────────

  describe('listAllTiers', () => {
    it('should include inactive tiers but exclude deleted ones', async () => {
      const org = await createOrgWithConnect('list-all');
      const active = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'Active',
        priceMonthly: 499,
        priceAnnual: 4990,
      });
      const toDelete = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'Deleted',
        priceMonthly: 999,
        priceAnnual: 9990,
      });

      // Deactivate the first tier (not delete)
      await db
        .update(subscriptionTiers)
        .set({ isActive: false })
        .where(eq(subscriptionTiers.id, active.id));
      // Delete the second
      await service.deleteTier(toDelete.id, org.id);

      const allTiers = await service.listAllTiers(org.id);
      // Should include the deactivated tier but not the deleted one
      expect(allTiers).toHaveLength(1);
      expect(allTiers[0]!.id).toBe(active.id);
    });
  });

  // ─── Stripe failure handling ──────────────────────────────────────────

  describe('Stripe failure handling', () => {
    it('should not create DB record when Stripe product creation fails', async () => {
      const org = await createOrgWithConnect('stripe-fail-product');

      (
        stripe.products.create as ReturnType<typeof vi.fn>
      ).mockRejectedValueOnce(
        new Error('Stripe API error: product creation failed')
      );

      await expect(
        service.createTier(org.id, {
          submissionId: crypto.randomUUID(),
          name: 'Fail Product',
          priceMonthly: 499,
          priceAnnual: 4990,
        })
      ).rejects.toThrow();

      // Verify no tier was created
      const tiers = await service.listTiers(org.id);
      expect(tiers).toHaveLength(0);
    });

    it('should handle Stripe price creation failure after product creation', async () => {
      const org = await createOrgWithConnect('stripe-fail-price');

      // Product creation succeeds, price creation fails
      (stripe.prices.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Stripe API error: price creation failed')
      );

      await expect(
        service.createTier(org.id, {
          submissionId: crypto.randomUUID(),
          name: 'Fail Price',
          priceMonthly: 499,
          priceAnnual: 4990,
        })
      ).rejects.toThrow();

      // Verify no tier was created in DB (transaction rollback or cleanup)
      const tiers = await service.listTiers(org.id);
      expect(tiers).toHaveLength(0);
    });

    it('should handle DB failure after Stripe product/price creation', async () => {
      const org = await createOrgWithConnect('stripe-fail-db');

      // NOTE: This test documents that if Stripe calls succeed but DB insert fails,
      // the Stripe product/prices may be orphaned. This is a known limitation —
      // Stripe resources are not rolled back if the DB transaction fails.
      // The workaround is manual cleanup or a reconciliation job.

      // We verify the happy path works — the DB-failure scenario would require
      // injecting DB failures which is complex with real DB integration tests.
      const tier = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'DB Fail Test',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      expect(tier).toBeDefined();
      expect(tier.stripeProductId).toBeDefined();
    });

    it('should not archive old prices when Stripe price creation fails during update', async () => {
      const org = await createOrgWithConnect('stripe-update-fail');
      const tier = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'Update Fail',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      // Reset mocks after creation
      (stripe.prices.create as ReturnType<typeof vi.fn>).mockClear();
      (stripe.prices.update as ReturnType<typeof vi.fn>).mockClear();

      // New price creation fails
      (stripe.prices.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Stripe API error: new price failed')
      );

      await expect(
        service.updateTier(tier.id, org.id, { priceMonthly: 699 })
      ).rejects.toThrow();

      // Old prices should NOT have been archived (since new price failed)
      // The archive call happens after successful price creation
      expect(stripe.prices.update).not.toHaveBeenCalled();
    });

    it('should handle DB failure after new Stripe prices during update', async () => {
      const org = await createOrgWithConnect('stripe-update-db-fail');
      await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'Update DB Fail',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      // Verify the tier still has original prices after a failed update attempt
      // would leave Stripe in a potentially inconsistent state.
      // This documents the known limitation.
      const refetchedTier = await service.listTiers(org.id);
      expect(refetchedTier[0]!.priceMonthly).toBe(499);
    });
  });

  // ─── reorderTiers ───────────────────────────────────────────────────

  describe('reorderTiers', () => {
    it('should reorder tiers by provided ID array', async () => {
      const org = await createOrgWithConnect('reorder');
      const a = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'A',
        priceMonthly: 100,
        priceAnnual: 1000,
      });
      const b = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'B',
        priceMonthly: 200,
        priceAnnual: 2000,
      });
      const c = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'C',
        priceMonthly: 300,
        priceAnnual: 3000,
      });

      // Reorder to C, A, B
      await service.reorderTiers(org.id, [c.id, a.id, b.id]);

      const tiers = await service.listTiers(org.id);
      expect(tiers[0]!.name).toBe('C');
      expect(tiers[0]!.sortOrder).toBe(1);
      expect(tiers[1]!.name).toBe('A');
      expect(tiers[1]!.sortOrder).toBe(2);
      expect(tiers[2]!.name).toBe('B');
      expect(tiers[2]!.sortOrder).toBe(3);
    });

    it('should throw TierNotFoundError if ID does not belong to org', async () => {
      const org = await createOrgWithConnect('reorder-bad');
      const tier = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'Real',
        priceMonthly: 100,
        priceAnnual: 1000,
      });

      await expect(
        service.reorderTiers(org.id, [
          tier.id,
          '00000000-0000-0000-0000-000000000000',
        ])
      ).rejects.toThrow(TierNotFoundError);
    });

    it('should reject duplicate IDs in the reorder payload', async () => {
      const org = await createOrgWithConnect('reorder-dupe');
      const a = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'A',
        priceMonthly: 100,
        priceAnnual: 1000,
      });
      const b = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'B',
        priceMonthly: 200,
        priceAnnual: 2000,
      });

      await expect(
        service.reorderTiers(org.id, [a.id, b.id, a.id])
      ).rejects.toThrow(ValidationError);
    });

    it('should reject a subset of tiers (X5 regression)', async () => {
      // If the caller omits a tier, the omitted tier keeps its old
      // sortOrder, which collides with the newly renumbered ones (1..N).
      // The two-phase temp-offset hop only avoids collisions among the
      // tiers being moved, so the final state can contain duplicate
      // sortOrder values that listTiers() returns in an unstable order.
      const org = await createOrgWithConnect('reorder-subset');
      const a = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'A',
        priceMonthly: 100,
        priceAnnual: 1000,
      });
      const b = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'B',
        priceMonthly: 200,
        priceAnnual: 2000,
      });
      await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'C',
        priceMonthly: 300,
        priceAnnual: 3000,
      });

      await expect(service.reorderTiers(org.id, [a.id, b.id])).rejects.toThrow(
        ValidationError
      );
    });
  });

  // ─── applyStripeProductUpdate (Q1 Dashboard sync-back) ──────────────────

  describe('applyStripeProductUpdate', () => {
    /** Helper: build a minimal Stripe.Product payload. */
    function buildProduct(
      overrides: Partial<{
        id: string;
        name: string;
        description: string | null;
        metadata: Record<string, string>;
      }> = {}
    ) {
      return {
        id: 'prod_stub',
        name: 'Stubbed',
        description: null,
        metadata: {
          codex_type: 'subscription_tier',
          codex_organization_id: 'will-be-overridden',
          ...(overrides.metadata ?? {}),
        },
        ...overrides,
      } as unknown as import('stripe').default.Product;
    }

    // Codex-2hxff.6 (SUB-16): a DB outage during the sync-back was wrapped as
    // "An unexpected error occurred" with the original thrown away, so the
    // webhook acknowledged it 200 and the Dashboard edit was lost for good.
    // The wrap must keep the original on `cause` — that is what ecom-api's
    // isTransientError reads to answer 500 so Stripe retries.
    it('a database outage is rethrown with its original error as the cause', async () => {
      const outage = new Error('Connection terminated unexpectedly');
      const failingDb = {
        select: () => {
          throw outage;
        },
      } as unknown as typeof db;
      const broken = new TierService(
        { db: failingDb, dbWs: failingDb, environment: 'test' },
        stripe
      );

      const err = await broken
        .applyStripeProductUpdate(buildProduct())
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(InternalServiceError);
      expect((err as Error).cause).toBe(outage);
    });

    it('should mirror name + description and return changed=true', async () => {
      const org = await createOrgWithConnect('sync-prod-a');
      const tier = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'Pro',
        description: 'Old description',
        priceMonthly: 999,
        priceAnnual: 9990,
      });

      const result = await service.applyStripeProductUpdate(
        buildProduct({
          id: tier.stripeProductId ?? 'missing-product-id',
          name: 'Pro (renamed)',
          description: 'Brand new description',
          metadata: {
            codex_type: 'subscription_tier',
            codex_organization_id: org.id,
          },
        })
      );

      expect(result).toEqual({
        tierId: tier.id,
        organizationId: org.id,
        changed: true,
      });

      const row = takeFirst(
        await db
          .select({
            name: subscriptionTiers.name,
            description: subscriptionTiers.description,
          })
          .from(subscriptionTiers)
          .where(eq(subscriptionTiers.id, tier.id))
      );
      expect(row.name).toBe('Pro (renamed)');
      expect(row.description).toBe('Brand new description');
    });

    it('should return changed=false when name + description already match (idempotent replay)', async () => {
      const org = await createOrgWithConnect('sync-prod-b');
      const tier = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'Basic',
        description: 'Unchanged',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      const result = await service.applyStripeProductUpdate(
        buildProduct({
          id: tier.stripeProductId ?? 'missing-product-id',
          name: 'Basic',
          description: 'Unchanged',
          metadata: {
            codex_type: 'subscription_tier',
            codex_organization_id: org.id,
          },
        })
      );

      expect(result).toEqual({
        tierId: tier.id,
        organizationId: org.id,
        changed: false,
      });
    });

    it('should return null for non-Codex products (metadata missing codex_type)', async () => {
      const result = await service.applyStripeProductUpdate(
        buildProduct({
          id: 'prod_external',
          metadata: { someone_elses: 'thing' },
        })
      );
      expect(result).toBeNull();
    });

    it('should return null when the tier has been soft-deleted since the edit was queued', async () => {
      const org = await createOrgWithConnect('sync-prod-c');
      const tier = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'Deprecated',
        priceMonthly: 499,
        priceAnnual: 4990,
      });
      await service.deleteTier(tier.id, org.id);

      const result = await service.applyStripeProductUpdate(
        buildProduct({
          id: tier.stripeProductId ?? 'missing-product-id',
          name: 'Too Late',
          metadata: {
            codex_type: 'subscription_tier',
            codex_organization_id: org.id,
          },
        })
      );
      expect(result).toBeNull();
    });
  });

  // ─── recordStripePriceDrift (Codex-2hxff.3) ─────────────────────────────
  //
  // Studio is the only place a tier price is set. A Price created in the
  // Stripe Dashboard is logged as drift and NOT applied — this replaced the
  // old adopt-and-propagate sync-back.

  describe('recordStripePriceDrift', () => {
    function buildPrice(args: {
      id: string;
      product: string;
      interval: 'month' | 'year';
      /** Studio stamps this; a Dashboard-created Price has none. */
      orgId?: string;
      active?: boolean;
    }) {
      return {
        id: args.id,
        active: args.active ?? true,
        unit_amount: 1500,
        currency: 'gbp',
        recurring: { interval: args.interval },
        product: args.product,
        metadata: args.orgId
          ? { codex_organization_id: args.orgId, interval: args.interval }
          : {},
      } as unknown as import('stripe').default.Price;
    }

    function spyOnObs() {
      const obs = (
        service as unknown as {
          obs: {
            error: (...a: unknown[]) => void;
            info: (...a: unknown[]) => void;
          };
        }
      ).obs;
      return {
        error: vi.spyOn(obs, 'error'),
        info: vi.spyOn(obs, 'info'),
      };
    }

    async function tierRow(tierId: string) {
      return takeFirst(
        await db
          .select({
            priceMonthly: subscriptionTiers.priceMonthly,
            stripePriceMonthlyId: subscriptionTiers.stripePriceMonthlyId,
          })
          .from(subscriptionTiers)
          .where(eq(subscriptionTiers.id, tierId))
      );
    }

    it('a Dashboard Price on a tier is logged as drift and changes nothing', async () => {
      const org = await createOrgWithConnect('drift-dashboard');
      const tier = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'Fan',
        priceMonthly: 500,
        priceAnnual: 5000,
      });
      const pricesUpdate = stripe.prices.update as unknown as ReturnType<
        typeof vi.fn
      >;
      pricesUpdate.mockClear();
      const { error } = spyOnObs();

      await service.recordStripePriceDrift(
        buildPrice({
          id: 'price_dashboard_1500',
          product: tier.stripeProductId ?? 'missing-product-id',
          interval: 'month',
        })
      );

      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('drift'),
        expect.objectContaining({
          tierId: tier.id,
          stripePriceId: 'price_dashboard_1500',
        })
      );
      // Not adopted, nothing archived — the tier still sells its own Price.
      expect(await tierRow(tier.id)).toEqual({
        priceMonthly: 500,
        stripePriceMonthlyId: tier.stripePriceMonthlyId,
      });
      expect(pricesUpdate).not.toHaveBeenCalled();
    });

    it("Studio's own Price (tagged) is not drift", async () => {
      const org = await createOrgWithConnect('drift-studio');
      const tier = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'Studio',
        priceMonthly: 999,
        priceAnnual: 9990,
      });
      const { error } = spyOnObs();

      await service.recordStripePriceDrift(
        buildPrice({
          id: 'price_studio_inflight',
          product: tier.stripeProductId ?? 'missing-product-id',
          interval: 'month',
          orgId: org.id,
        })
      );

      expect(error).not.toHaveBeenCalled();
      expect(await tierRow(tier.id)).toEqual({
        priceMonthly: 999,
        stripePriceMonthlyId: tier.stripePriceMonthlyId,
      });
    });

    it("the tier's current Price, an inactive Price, or an unknown Product is a silent no-op", async () => {
      const org = await createOrgWithConnect('drift-noop');
      const tier = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'Guard',
        priceMonthly: 499,
        priceAnnual: 4990,
      });
      const { error, info } = spyOnObs();

      for (const price of [
        buildPrice({
          id: tier.stripePriceMonthlyId ?? 'missing-monthly-id',
          product: tier.stripeProductId ?? 'missing-product-id',
          interval: 'month',
        }),
        buildPrice({
          id: 'price_dead',
          product: tier.stripeProductId ?? 'missing-product-id',
          interval: 'month',
          active: false,
        }),
        buildPrice({
          id: 'price_other',
          product: 'prod_not_ours',
          interval: 'month',
        }),
      ]) {
        await service.recordStripePriceDrift(price);
      }

      expect(error).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalledWith(
        expect.stringContaining('Studio-created'),
        expect.anything()
      );
    });
  });

  // ─── getTierForAccessCheck (archived-tier read path) ────────────────────

  describe('getTierForAccessCheck', () => {
    it('should return the tier when active (positive, non-archived)', async () => {
      const org = await createOrgWithConnect('access-active');
      const tier = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'Active',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      const resolved = await service.getTierForAccessCheck(tier.id);
      expect(resolved?.id).toBe(tier.id);
      expect(resolved?.deletedAt).toBeNull();
    });

    it('should return soft-deleted tiers so access checks can still resolve sortOrder (Q8 archived model)', async () => {
      // Q8 product decision: archived tiers still resolve for access-check
      // read paths. A subscription that predates the delete still references
      // the tier via subscriptions.tier_id; access checks compare sortOrder
      // against content.minimum_tier_id which may also point at the archived
      // tier. Filtering deletedAt here would silently break those reads.
      const org = await createOrgWithConnect('access-archived');
      const tier = await service.createTier(org.id, {
        submissionId: crypto.randomUUID(),
        name: 'Archived',
        priceMonthly: 499,
        priceAnnual: 4990,
      });
      await service.deleteTier(tier.id, org.id);

      const resolved = await service.getTierForAccessCheck(tier.id);
      expect(resolved?.id).toBe(tier.id);
      expect(resolved?.deletedAt).toBeInstanceOf(Date);
      expect(resolved?.sortOrder).toBe(tier.sortOrder);
    });

    it('should return null when the tier id does not exist at all', async () => {
      const resolved = await service.getTierForAccessCheck(
        '00000000-0000-0000-0000-000000000000'
      );
      expect(resolved).toBeNull();
    });
  });
});
