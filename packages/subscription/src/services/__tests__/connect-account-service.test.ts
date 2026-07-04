/**
 * ConnectAccountService Tests
 *
 * Integration tests with real DB + mocked Stripe.
 * Tests the full Connect account lifecycle:
 * - Account creation and onboarding
 * - Account status transitions (webhook handler)
 * - Dashboard link generation
 * - Readiness checks
 *
 * Verified against Stripe Connect testing best practices:
 * - Controller properties (not legacy types)
 * - GB country + card_payments/transfers capabilities
 * - All 4 status transitions (onboarding → active/restricted/disabled)
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import {
  organizationMemberships,
  organizations,
  stripeConnectAccounts,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import {
  createMockStripe,
  createTestConnectAccountInput,
  createTestOrganizationInput,
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
  validateDatabaseConnection,
} from '@codex/test-utils';
import { eq, inArray } from 'drizzle-orm';
import type Stripe from 'stripe';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  ConnectAccountNotFoundError,
  ConnectAccountNotReadyError,
  ConnectPlatformNotConfiguredError,
} from '../../errors';
import { ConnectAccountService } from '../connect-account-service';
import { SubscriptionService } from '../subscription-service';
import { TierService } from '../tier-service';

describe('ConnectAccountService', () => {
  let db: ReturnType<typeof setupTestDatabase>;
  let stripe: Stripe;
  let service: ConnectAccountService;
  let creatorId: string;
  let otherCreatorId: string;
  let orgId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    await validateDatabaseConnection(db);
    const userIds = await seedTestUsers(db, 2);
    [creatorId, otherCreatorId] = userIds;

    // Create a test org
    const orgInput = createTestOrganizationInput({
      slug: createUniqueSlug('connect-test'),
      creatorId,
    });
    const [org] = await db.insert(organizations).values(orgInput).returning();
    orgId = org.id;
  });

  beforeEach(async () => {
    // One Connect account per user (Codex-69t7c uq_stripe_connect_user): this
    // suite reuses the same two seed users across many tests, so clear their
    // accounts between tests to avoid cross-test unique(userId) collisions.
    await db
      .delete(stripeConnectAccounts)
      .where(
        inArray(stripeConnectAccounts.userId, [creatorId, otherCreatorId])
      );
    // Don't reset IDs — unique constraint on stripeAccountId means IDs must be globally unique
    stripe = createMockStripe();
    // createMockStripe() does not ship `accounts.retrieve` — install a spy
    // so tests that assert `.not.toHaveBeenCalled()` work (and per-test
    // mockResolvedValue / mockRejectedValue overrides apply on top).
    stripe.accounts.retrieve = vi.fn();
    service = new ConnectAccountService({ db, environment: 'test' }, stripe);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  // ─── createAccount ──────────────────────────────────────────────────

  describe('createAccount', () => {
    it('should create Express account + onboarding URL with DB record', async () => {
      // Fresh org to avoid leftover data from previous test runs
      const [freshOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('create-new'),
            creatorId,
          })
        )
        .returning();

      const result = await service.createAccount(
        freshOrg.id,
        creatorId,
        'https://example.com/return',
        'https://example.com/refresh'
      );

      expect(result.accountId).toBeDefined();
      expect(result.onboardingUrl).toBeDefined();

      // Verify Stripe API call
      expect(stripe.accounts.create).toHaveBeenCalledWith(
        expect.objectContaining({
          country: 'GB',
          controller: expect.objectContaining({
            stripe_dashboard: { type: 'express' },
            fees: { payer: 'application' },
          }),
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          // Onboarding is userId-centric (Codex-69t7c.2) — no org metadata;
          // the org→account link is materialised at activation via the pin.
          metadata: {
            codex_user_id: creatorId,
          },
        }),
        // Replay-safe: keyed on the user so a retry reuses the same account.
        expect.objectContaining({
          idempotencyKey: `connect_acct_${creatorId}`,
        })
      );

      // Verify DB record
      const account = await service.getAccount(freshOrg.id, creatorId);
      expect(account).not.toBeNull();
      expect(account?.status).toBe('onboarding');
      expect(account?.chargesEnabled).toBe(false);
      expect(account?.payoutsEnabled).toBe(false);
    });

    it('should resume onboarding if account exists but not complete', async () => {
      // Fresh org to avoid leftover data
      const [resumeOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('resume'),
            creatorId,
          })
        )
        .returning();

      // Insert incomplete account
      await db.insert(stripeConnectAccounts).values(
        createTestConnectAccountInput(resumeOrg.id, otherCreatorId, {
          chargesEnabled: false,
          payoutsEnabled: false,
          status: 'onboarding',
        })
      );

      const result = await service.createAccount(
        resumeOrg.id,
        otherCreatorId,
        'https://example.com/return',
        'https://example.com/refresh'
      );

      // Should NOT create a new Stripe account
      expect(stripe.accounts.create).not.toHaveBeenCalled();
      // Should generate new onboarding link
      expect(stripe.accountLinks.create).toHaveBeenCalled();
      expect(result.onboardingUrl).toBeDefined();
    });

    it('should return returnUrl if already fully onboarded', async () => {
      // Create a new org for isolation
      const [isolatedOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('onboarded'),
            creatorId,
          })
        )
        .returning();

      await db.insert(stripeConnectAccounts).values(
        createTestConnectAccountInput(isolatedOrg.id, creatorId, {
          chargesEnabled: true,
          payoutsEnabled: true,
          status: 'active',
        })
      );

      const returnUrl = 'https://example.com/return';
      const result = await service.createAccount(
        isolatedOrg.id,
        creatorId,
        returnUrl,
        'https://example.com/refresh'
      );

      expect(result.onboardingUrl).toBe(returnUrl);
      expect(stripe.accounts.create).not.toHaveBeenCalled();
      expect(stripe.accountLinks.create).not.toHaveBeenCalled();
    });

    it('should store correct metadata on Stripe account', async () => {
      const [metaOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('meta'),
            creatorId,
          })
        )
        .returning();

      await service.createAccount(
        metaOrg.id,
        creatorId,
        'https://example.com/return',
        'https://example.com/refresh'
      );

      expect(stripe.accounts.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // userId-centric onboarding (Codex-69t7c.2): metadata carries only
          // the user; there is no single owning org for a user account.
          metadata: {
            codex_user_id: creatorId,
          },
        }),
        expect.objectContaining({
          idempotencyKey: `connect_acct_${creatorId}`,
        })
      );
    });

    it('should create account with GB country and correct capabilities', async () => {
      const [gbOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('gb'),
            creatorId,
          })
        )
        .returning();

      await service.createAccount(
        gbOrg.id,
        creatorId,
        'https://example.com/return',
        'https://example.com/refresh'
      );

      expect(stripe.accounts.create).toHaveBeenCalledWith(
        expect.objectContaining({
          country: 'GB',
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
        }),
        expect.objectContaining({
          idempotencyKey: `connect_acct_${creatorId}`,
        })
      );
    });

    // ─── hardening: orphan prevention + platform-config error mapping ───

    it('persists the account row BEFORE the onboarding link, so a link failure is recoverable without a duplicate account', async () => {
      const [org] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('orphan'),
            creatorId,
          })
        )
        .returning();

      // Attempt 1: Stripe account + DB row are created, then link generation
      // fails. The account row must survive the throw.
      stripe.accountLinks.create = vi
        .fn()
        .mockRejectedValue(new Error('stripe down'));

      await expect(
        service.createAccount(
          org.id,
          creatorId,
          'https://example.com/return',
          'https://example.com/refresh'
        )
      ).rejects.toThrow();

      const afterFailure = await service.getAccount(org.id, creatorId);
      expect(afterFailure).not.toBeNull();
      expect(afterFailure?.status).toBe('onboarding');

      // Attempt 2 (link now succeeds): resumes the SAME account via the
      // existing-row branch — no second Stripe account is minted.
      stripe.accountLinks.create = vi
        .fn()
        .mockResolvedValue({ url: 'https://connect.stripe.com/setup/retry' });

      const resumed = await service.createAccount(
        org.id,
        creatorId,
        'https://example.com/return',
        'https://example.com/refresh'
      );

      expect(resumed.accountId).toBe(afterFailure?.stripeAccountId);
      expect(resumed.onboardingUrl).toBe(
        'https://connect.stripe.com/setup/retry'
      );
      expect(stripe.accounts.create).toHaveBeenCalledTimes(1);
    });

    it('resolves a concurrent race to a single row via onConflictDoNothing', async () => {
      const [org] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('race'),
            creatorId,
          })
        )
        .returning();

      // The winner of a concurrent race: a row already committed for this user
      // by the time our insert runs.
      const [winner] = await db
        .insert(stripeConnectAccounts)
        .values(
          createTestConnectAccountInput(org.id, creatorId, {
            status: 'onboarding',
            chargesEnabled: false,
            payoutsEnabled: false,
          })
        )
        .returning();

      // Force our call PAST the existing-check (as if the winner committed
      // after we looked) so it reaches the insert and hits uq_stripe_connect_user.
      vi.spyOn(service, 'getAccountForUser')
        .mockResolvedValueOnce(null)
        .mockResolvedValue(winner);

      const result = await service.createAccount(
        org.id,
        creatorId,
        'https://example.com/return',
        'https://example.com/refresh'
      );

      // Resolves to the WINNER's account, not the row our racing insert tried.
      expect(result.accountId).toBe(winner.stripeAccountId);

      // Exactly one row for the user — no duplicate leaked into our DB.
      const rows = await db
        .select()
        .from(stripeConnectAccounts)
        .where(eq(stripeConnectAccounts.userId, creatorId));
      expect(rows).toHaveLength(1);
    });

    it('maps Stripe "not signed up for Connect" to ConnectPlatformNotConfiguredError', async () => {
      const [org] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('noconnect'),
            creatorId,
          })
        )
        .returning();

      const stripeErr = Object.assign(
        new Error(
          "You can only create new accounts if you've signed up for Connect, which you can do at https://dashboard.stripe.com/connect."
        ),
        { type: 'StripeInvalidRequestError' }
      );
      stripe.accounts.create = vi.fn().mockRejectedValue(stripeErr);

      const err = await service
        .createAccount(
          org.id,
          creatorId,
          'https://example.com/return',
          'https://example.com/refresh'
        )
        .catch((e) => e);

      expect(err).toBeInstanceOf(ConnectPlatformNotConfiguredError);
      expect(err.code).toBe('CONNECT_PLATFORM_NOT_CONFIGURED');
      expect(err.statusCode).toBe(500);

      // Account creation failed before any DB write — nothing persisted.
      const account = await service.getAccount(org.id, creatorId);
      expect(account).toBeNull();
    });

    it('does NOT map unrelated invalid-request errors to the platform-not-configured error', async () => {
      const [org] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('otherinvalid'),
            creatorId,
          })
        )
        .returning();

      // A different StripeInvalidRequestError (bad param) must NOT be swallowed
      // as "platform not configured" — the discriminator is deliberately narrow.
      const stripeErr = Object.assign(new Error('Invalid country: XX'), {
        type: 'StripeInvalidRequestError',
      });
      stripe.accounts.create = vi.fn().mockRejectedValue(stripeErr);

      const err = await service
        .createAccount(
          org.id,
          creatorId,
          'https://example.com/return',
          'https://example.com/refresh'
        )
        .catch((e) => e);

      expect(err).not.toBeInstanceOf(ConnectPlatformNotConfiguredError);
    });
  });

  // ─── getAccount ─────────────────────────────────────────────────────

  describe('getAccount', () => {
    it('should return account for matching org', async () => {
      const [getOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('get'),
            creatorId,
          })
        )
        .returning();

      await db
        .insert(stripeConnectAccounts)
        .values(createTestConnectAccountInput(getOrg.id, creatorId));
      await db
        .update(organizations)
        .set({ primaryConnectAccountUserId: creatorId })
        .where(eq(organizations.id, getOrg.id));

      const account = await service.getAccount(getOrg.id);
      expect(account).not.toBeNull();
      expect(account?.organizationId).toBe(getOrg.id);
    });

    it('should return null when no account exists', async () => {
      const [emptyOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('empty'),
            creatorId,
          })
        )
        .returning();

      const account = await service.getAccount(emptyOrg.id);
      expect(account).toBeNull();
    });
  });

  // ─── refreshOnboardingLink ──────────────────────────────────────────

  describe('refreshOnboardingLink', () => {
    it('should generate new link for existing account', async () => {
      const [refreshOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('refresh'),
            creatorId,
          })
        )
        .returning();

      await db.insert(stripeConnectAccounts).values(
        createTestConnectAccountInput(refreshOrg.id, creatorId, {
          status: 'onboarding',
          chargesEnabled: false,
          payoutsEnabled: false,
        })
      );

      const result = await service.refreshOnboardingLink(
        refreshOrg.id,
        creatorId,
        'https://example.com/return',
        'https://example.com/refresh'
      );

      expect(result.onboardingUrl).toBeDefined();
      expect(stripe.accountLinks.create).toHaveBeenCalled();
    });

    it('should throw ConnectAccountNotFoundError when none exists', async () => {
      const [missingOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('missing'),
            creatorId,
          })
        )
        .returning();

      await expect(
        service.refreshOnboardingLink(
          missingOrg.id,
          creatorId,
          'https://example.com/return',
          'https://example.com/refresh'
        )
      ).rejects.toThrow(ConnectAccountNotFoundError);
    });
  });

  // ─── handleAccountUpdated ───────────────────────────────────────────

  describe('handleAccountUpdated', () => {
    it('should set status to active when charges and payouts enabled', async () => {
      const [activeOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('active'),
            creatorId,
          })
        )
        .returning();

      const [inserted] = await db
        .insert(stripeConnectAccounts)
        .values(
          createTestConnectAccountInput(activeOrg.id, creatorId, {
            status: 'onboarding',
            chargesEnabled: false,
            payoutsEnabled: false,
          })
        )
        .returning();

      await service.handleAccountUpdated({
        id: inserted.stripeAccountId,
        charges_enabled: true,
        payouts_enabled: true,
        requirements: { currently_due: [], disabled_reason: null },
      } as unknown as Stripe.Account);

      const updated = await service.getAccount(activeOrg.id, creatorId);
      expect(updated!.status).toBe('active');
      expect(updated!.chargesEnabled).toBe(true);
      expect(updated!.payoutsEnabled).toBe(true);
      expect(updated!.onboardingCompletedAt).not.toBeNull();
    });

    it('should set status to disabled when disabled_reason present', async () => {
      const [disOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('disabled'),
            creatorId,
          })
        )
        .returning();

      const [inserted] = await db
        .insert(stripeConnectAccounts)
        .values(createTestConnectAccountInput(disOrg.id, creatorId))
        .returning();

      await service.handleAccountUpdated({
        id: inserted.stripeAccountId,
        charges_enabled: false,
        payouts_enabled: false,
        requirements: {
          currently_due: [],
          disabled_reason: 'rejected.fraud',
        },
      } as unknown as Stripe.Account);

      const updated = await service.getAccount(disOrg.id, creatorId);
      expect(updated!.status).toBe('disabled');
    });

    it('should set status to restricted when currently_due has items', async () => {
      const [resOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('restricted'),
            creatorId,
          })
        )
        .returning();

      const [inserted] = await db
        .insert(stripeConnectAccounts)
        .values(createTestConnectAccountInput(resOrg.id, creatorId))
        .returning();

      await service.handleAccountUpdated({
        id: inserted.stripeAccountId,
        charges_enabled: true,
        payouts_enabled: false,
        requirements: {
          currently_due: ['external_account'],
          disabled_reason: null,
        },
      } as unknown as Stripe.Account);

      const updated = await service.getAccount(resOrg.id, creatorId);
      expect(updated!.status).toBe('restricted');
    });

    it('should set status to onboarding when still in progress', async () => {
      const [obOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('onboard'),
            creatorId,
          })
        )
        .returning();

      const [inserted] = await db
        .insert(stripeConnectAccounts)
        .values(
          createTestConnectAccountInput(obOrg.id, creatorId, {
            status: 'onboarding',
            chargesEnabled: false,
            payoutsEnabled: false,
          })
        )
        .returning();

      await service.handleAccountUpdated({
        id: inserted.stripeAccountId,
        charges_enabled: false,
        payouts_enabled: false,
        requirements: { currently_due: [], disabled_reason: null },
      } as unknown as Stripe.Account);

      const updated = await service.getAccount(obOrg.id, creatorId);
      expect(updated!.status).toBe('onboarding');
    });

    it('should log warning for unknown stripe account ID', async () => {
      // Should not throw — just logs a warning and returns
      await service.handleAccountUpdated({
        id: 'acct_unknown_12345',
        charges_enabled: true,
        payouts_enabled: true,
        requirements: { currently_due: [], disabled_reason: null },
      } as unknown as Stripe.Account);
    });

    // ─── Capability loss (Codex-fynnr) ────────────────────────────────
    //
    // Regression guard for the active-onwards branch (line ~341). When a
    // previously-active Connect account loses a capability (charges_enabled
    // flips true → false), Stripe almost always also sets a
    // requirements.disabled_reason or repopulates requirements.currently_due.
    // The local row MUST drop out of `'active'` so subsequent
    // createCheckoutSession resolves to ConnectAccountNotReadyError. A regression
    // that left status at `'active'` after the flip would silently allow new
    // checkouts against a broken Connect account.

    it('should flip status active → restricted when charges_enabled drops with currently_due', async () => {
      const [lossOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('capability-loss-restricted'),
            creatorId,
          })
        )
        .returning();

      const [inserted] = await db
        .insert(stripeConnectAccounts)
        .values(
          createTestConnectAccountInput(lossOrg.id, creatorId, {
            status: 'active',
            chargesEnabled: true,
            payoutsEnabled: true,
            onboardingCompletedAt: new Date(),
          })
        )
        .returning();

      // Stripe fires account.updated with capabilities revoked and new
      // requirements (e.g. updated KYC info needed).
      await service.handleAccountUpdated({
        id: inserted.stripeAccountId,
        charges_enabled: false,
        payouts_enabled: true,
        requirements: {
          currently_due: ['individual.verification.document'],
          disabled_reason: null,
        },
      } as unknown as Stripe.Account);

      const updated = await service.getAccount(lossOrg.id, creatorId);
      expect(updated!.status).toBe('restricted');
      expect(updated!.chargesEnabled).toBe(false);
      expect(updated!.payoutsEnabled).toBe(true);
      // onboardingCompletedAt is cleared because the account is no longer
      // both charges_enabled AND payouts_enabled.
      expect(updated!.onboardingCompletedAt).toBeNull();
    });

    it('should flip status active → disabled when charges_enabled drops with disabled_reason', async () => {
      const [lossOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('capability-loss-disabled'),
            creatorId,
          })
        )
        .returning();

      const [inserted] = await db
        .insert(stripeConnectAccounts)
        .values(
          createTestConnectAccountInput(lossOrg.id, creatorId, {
            status: 'active',
            chargesEnabled: true,
            payoutsEnabled: true,
            onboardingCompletedAt: new Date(),
          })
        )
        .returning();

      await service.handleAccountUpdated({
        id: inserted.stripeAccountId,
        charges_enabled: false,
        payouts_enabled: false,
        requirements: {
          currently_due: [],
          disabled_reason: 'rejected.fraud',
        },
      } as unknown as Stripe.Account);

      const updated = await service.getAccount(lossOrg.id, creatorId);
      expect(updated!.status).toBe('disabled');
      expect(updated!.chargesEnabled).toBe(false);
      expect(updated!.payoutsEnabled).toBe(false);
      expect(updated!.onboardingCompletedAt).toBeNull();
    });

    it('should cause SubscriptionService.createCheckoutSession to throw ConnectAccountNotReadyError after capability loss', async () => {
      // Bootstrap: a fully active org with a tier, then strip the
      // capability via the production webhook path.
      const [crossOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('capability-loss-checkout'),
            creatorId,
          })
        )
        .returning();

      const [connectRow] = await db
        .insert(stripeConnectAccounts)
        .values(
          createTestConnectAccountInput(crossOrg.id, creatorId, {
            status: 'active',
            chargesEnabled: true,
            payoutsEnabled: true,
          })
        )
        .returning();

      const [tier] = await db
        .insert(subscriptionTiers)
        .values(createTestTierInput(crossOrg.id))
        .returning();

      // Capability flips true → false via the same handler the live
      // account.updated webhook calls.
      await service.handleAccountUpdated({
        id: connectRow.stripeAccountId,
        charges_enabled: false,
        payouts_enabled: false,
        requirements: {
          currently_due: ['individual.verification.document'],
          disabled_reason: null,
        },
      } as unknown as Stripe.Account);

      const subscriptionService = new SubscriptionService(
        { db, environment: 'test' },
        stripe
      );

      // Attach customer-resolution stubs in the shape SubscriptionService
      // expects so we exercise the Connect gate, not the Customer-create gate.
      (stripe as unknown as { customers: unknown }).customers = {
        list: vi.fn().mockResolvedValue({ data: [], has_more: false }),
        create: vi.fn().mockResolvedValue({
          id: 'cus_capability_loss',
          email: 'sub@example.com',
        }),
      };

      await expect(
        subscriptionService.createCheckoutSession(
          otherCreatorId,
          crossOrg.id,
          tier.id,
          'month',
          'https://example.com/success',
          'https://example.com/cancel'
        )
      ).rejects.toThrow(ConnectAccountNotReadyError);
    });

    it('preserves paid-tier access via TierService.getTierForAccessCheck after capability loss (Connect status ≠ subscription revocation)', async () => {
      // Subscribers already paying retain access to content they've paid for
      // even when the org's Connect account loses capability. This is the
      // crucial distinction: capability loss stops NEW transfers; it does NOT
      // retroactively revoke active subscriptions or the tier metadata they
      // join against.
      const [accessOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('capability-loss-access'),
            creatorId,
          })
        )
        .returning();

      const [connectRow] = await db
        .insert(stripeConnectAccounts)
        .values(
          createTestConnectAccountInput(accessOrg.id, creatorId, {
            status: 'active',
            chargesEnabled: true,
            payoutsEnabled: true,
          })
        )
        .returning();

      const [tier] = await db
        .insert(subscriptionTiers)
        .values(createTestTierInput(accessOrg.id))
        .returning();

      // Existing paid subscriber on this tier.
      await db.insert(subscriptions).values(
        createTestSubscriptionInput(otherCreatorId, accessOrg.id, tier.id, {
          status: 'active',
        })
      );

      // Capability is lost AFTER the subscription is in place.
      await service.handleAccountUpdated({
        id: connectRow.stripeAccountId,
        charges_enabled: false,
        payouts_enabled: false,
        requirements: {
          currently_due: [],
          disabled_reason: 'rejected.fraud',
        },
      } as unknown as Stripe.Account);

      // Sanity check: the Connect row really did move to disabled.
      const refreshed = await service.getAccount(accessOrg.id, creatorId);
      expect(refreshed!.status).toBe('disabled');

      // The access-path tier read MUST still resolve the tier so the existing
      // subscriber's content access keeps working.
      const tierService = new TierService({ db, environment: 'test' }, stripe);
      const accessTier = await tierService.getTierForAccessCheck(tier.id);
      expect(accessTier).not.toBeNull();
      expect(accessTier!.id).toBe(tier.id);
      expect(accessTier!.organizationId).toBe(accessOrg.id);
    });
  });

  // ─── handleAccountDeauthorized (Codex-fynnr) ────────────────────────
  //
  // account.application.deauthorized fires when the connected account
  // disconnects our platform via the Stripe Dashboard (or Stripe revokes us).
  // The local row MUST move to `'disabled'` so all future capability checks
  // (createCheckoutSession, transfer attempts) refuse cleanly. The handler
  // is registered in workers/ecom-api/src/handlers/connect-webhook.ts.

  describe('handleAccountDeauthorized', () => {
    it('should flip status to disabled and clear capability flags', async () => {
      const [deauthOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('deauth-disable'),
            creatorId,
          })
        )
        .returning();

      const [inserted] = await db
        .insert(stripeConnectAccounts)
        .values(
          createTestConnectAccountInput(deauthOrg.id, creatorId, {
            status: 'active',
            chargesEnabled: true,
            payoutsEnabled: true,
          })
        )
        .returning();

      await service.handleAccountDeauthorized(inserted.stripeAccountId);

      const updated = await service.getAccount(deauthOrg.id, creatorId);
      expect(updated!.status).toBe('disabled');
      expect(updated!.chargesEnabled).toBe(false);
      expect(updated!.payoutsEnabled).toBe(false);
    });

    it('should cause SubscriptionService.createCheckoutSession to throw ConnectAccountNotReadyError after deauthorization', async () => {
      const [deauthOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('deauth-checkout'),
            creatorId,
          })
        )
        .returning();

      const [connectRow] = await db
        .insert(stripeConnectAccounts)
        .values(
          createTestConnectAccountInput(deauthOrg.id, creatorId, {
            status: 'active',
            chargesEnabled: true,
            payoutsEnabled: true,
          })
        )
        .returning();

      const [tier] = await db
        .insert(subscriptionTiers)
        .values(createTestTierInput(deauthOrg.id))
        .returning();

      await service.handleAccountDeauthorized(connectRow.stripeAccountId);

      const subscriptionService = new SubscriptionService(
        { db, environment: 'test' },
        stripe
      );
      (stripe as unknown as { customers: unknown }).customers = {
        list: vi.fn().mockResolvedValue({ data: [], has_more: false }),
        create: vi.fn().mockResolvedValue({
          id: 'cus_deauth',
          email: 'sub@example.com',
        }),
      };

      await expect(
        subscriptionService.createCheckoutSession(
          otherCreatorId,
          deauthOrg.id,
          tier.id,
          'month',
          'https://example.com/success',
          'https://example.com/cancel'
        )
      ).rejects.toThrow(ConnectAccountNotReadyError);
    });

    it('should log warning for unknown stripe account ID (no throw)', async () => {
      // Deauthorize for an account we don't have — must not throw,
      // matching the unknown-account branch of handleAccountUpdated.
      await expect(
        service.handleAccountDeauthorized('acct_unknown_deauth_999')
      ).resolves.toBeUndefined();
    });
  });

  // ─── createDashboardLink ────────────────────────────────────────────

  describe('createDashboardLink', () => {
    it('should return Express dashboard URL', async () => {
      const [dashOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('dash'),
            creatorId,
          })
        )
        .returning();

      await db
        .insert(stripeConnectAccounts)
        .values(createTestConnectAccountInput(dashOrg.id, creatorId));
      await db
        .update(organizations)
        .set({ primaryConnectAccountUserId: creatorId })
        .where(eq(organizations.id, dashOrg.id));

      const result = await service.createDashboardLink(dashOrg.id);
      expect(result.url).toBeDefined();
      expect(stripe.accounts.createLoginLink).toHaveBeenCalled();
    });

    it('should throw ConnectAccountNotFoundError when none exists', async () => {
      const [noAccOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('noacc'),
            creatorId,
          })
        )
        .returning();

      await expect(service.createDashboardLink(noAccOrg.id)).rejects.toThrow(
        ConnectAccountNotFoundError
      );
    });
  });

  // ─── isReady ────────────────────────────────────────────────────────

  describe('isReady', () => {
    it('should return true when both charges and payouts enabled', async () => {
      const [readyOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('ready'),
            creatorId,
          })
        )
        .returning();

      await db.insert(stripeConnectAccounts).values(
        createTestConnectAccountInput(readyOrg.id, creatorId, {
          chargesEnabled: true,
          payoutsEnabled: true,
          status: 'active',
        })
      );
      await db
        .update(organizations)
        .set({ primaryConnectAccountUserId: creatorId })
        .where(eq(organizations.id, readyOrg.id));

      const ready = await service.isReady(readyOrg.id);
      expect(ready).toBe(true);
    });

    it('should return false when charges disabled', async () => {
      const [notReadyOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('notready'),
            creatorId,
          })
        )
        .returning();

      await db.insert(stripeConnectAccounts).values(
        createTestConnectAccountInput(notReadyOrg.id, creatorId, {
          chargesEnabled: false,
          payoutsEnabled: true,
        })
      );

      const ready = await service.isReady(notReadyOrg.id);
      expect(ready).toBe(false);
    });

    it('should return false when no account exists', async () => {
      const [noOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('noexist'),
            creatorId,
          })
        )
        .returning();

      const ready = await service.isReady(noOrg.id);
      expect(ready).toBe(false);
    });
  });

  // ─── getStatus (requirements + cache) ────────────────────────────────

  describe('getStatus', () => {
    it('returns disconnected sentinel when no DB row exists', async () => {
      const [emptyOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('status-empty'),
            creatorId,
          })
        )
        .returning();

      const result = await service.getStatus(emptyOrg.id);

      expect(result).toEqual({
        isConnected: false,
        accountId: null,
        chargesEnabled: false,
        payoutsEnabled: false,
        status: null,
        requirements: null,
      });
      // No Stripe call when there's no DB account
      expect(stripe.accounts.retrieve).not.toHaveBeenCalled();
    });

    it('returns full requirements payload when account exists', async () => {
      const [reqOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('status-req'),
            creatorId,
          })
        )
        .returning();

      const [inserted] = await db
        .insert(stripeConnectAccounts)
        .values(
          createTestConnectAccountInput(reqOrg.id, creatorId, {
            status: 'restricted',
            chargesEnabled: true,
            payoutsEnabled: false,
          })
        )
        .returning();
      await db
        .update(organizations)
        .set({ primaryConnectAccountUserId: creatorId })
        .where(eq(organizations.id, reqOrg.id));

      const deadline = 1_800_000_000;
      (stripe.accounts.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: inserted.stripeAccountId,
        charges_enabled: true,
        payouts_enabled: false,
        requirements: {
          currently_due: ['business_profile.url', 'individual.dob.day'],
          eventually_due: ['company.tax_id'],
          past_due: [],
          pending_verification: [],
          current_deadline: deadline,
          disabled_reason: null,
          errors: [
            {
              requirement: 'business_profile.url',
              code: 'invalid_url_format',
              reason: 'The provided URL is not valid.',
            },
          ],
        },
      } as unknown as Stripe.Account);

      const result = await service.getStatus(reqOrg.id);

      expect(result.isConnected).toBe(true);
      expect(result.status).toBe('restricted');
      expect(result.accountId).toBe(inserted.stripeAccountId);
      expect(result.requirements).not.toBeNull();
      expect(result.requirements?.currentlyDue).toEqual([
        'business_profile.url',
        'individual.dob.day',
      ]);
      expect(result.requirements?.eventuallyDue).toEqual(['company.tax_id']);
      expect(result.requirements?.currentDeadline).toBe(deadline);
      expect(result.requirements?.errors).toHaveLength(1);
      expect(result.requirements?.errors[0].requirement).toBe(
        'business_profile.url'
      );
    });

    it('normalises null arrays to [] so the UI can iterate without guards', async () => {
      const [normOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('status-norm'),
            creatorId,
          })
        )
        .returning();

      const [inserted] = await db
        .insert(stripeConnectAccounts)
        .values(createTestConnectAccountInput(normOrg.id, creatorId))
        .returning();
      await db
        .update(organizations)
        .set({ primaryConnectAccountUserId: creatorId })
        .where(eq(organizations.id, normOrg.id));

      (stripe.accounts.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: inserted.stripeAccountId,
        charges_enabled: true,
        payouts_enabled: true,
        // Stripe returns null arrays in real responses — must be normalised
        requirements: {
          currently_due: null,
          eventually_due: null,
          past_due: null,
          pending_verification: null,
          current_deadline: null,
          disabled_reason: null,
          errors: null,
        },
      } as unknown as Stripe.Account);

      const result = await service.getStatus(normOrg.id);

      expect(result.requirements?.currentlyDue).toEqual([]);
      expect(result.requirements?.eventuallyDue).toEqual([]);
      expect(result.requirements?.pastDue).toEqual([]);
      expect(result.requirements?.pendingVerification).toEqual([]);
      expect(result.requirements?.errors).toEqual([]);
      expect(result.requirements?.currentDeadline).toBeNull();
      expect(result.requirements?.disabledReason).toBeNull();
    });

    it('degrades gracefully when Stripe is unreachable — returns status without requirements', async () => {
      const [degOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('status-deg'),
            creatorId,
          })
        )
        .returning();

      const [inserted] = await db
        .insert(stripeConnectAccounts)
        .values(
          createTestConnectAccountInput(degOrg.id, creatorId, {
            status: 'restricted',
            chargesEnabled: false,
            payoutsEnabled: false,
          })
        )
        .returning();
      await db
        .update(organizations)
        .set({ primaryConnectAccountUserId: creatorId })
        .where(eq(organizations.id, degOrg.id));

      (stripe.accounts.retrieve as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Stripe API unreachable')
      );

      const result = await service.getStatus(degOrg.id);

      // Still surfaces the DB-known fields even if Stripe is down
      expect(result.isConnected).toBe(true);
      expect(result.accountId).toBe(inserted.stripeAccountId);
      expect(result.status).toBe('restricted');
      expect(result.requirements).toBeNull();
    });
  });

  // ─── handleAccountUpdated cache invalidation ─────────────────────────

  describe('handleAccountUpdated cache invalidation', () => {
    it('invalidates the cache after a successful update (idempotent on duplicate)', async () => {
      const { VersionedCache } = await import('@codex/cache');
      const { createMockKVNamespace, createMockObservability } = await import(
        '@codex/test-utils'
      );

      const kv = createMockKVNamespace();
      const { obs } = createMockObservability();
      const cache = new VersionedCache({
        kv: kv as unknown as KVNamespace,
        prefix: 'cache',
        obs,
      });

      const cachedService = new ConnectAccountService(
        { db, environment: 'test', cache },
        stripe
      );

      const [invOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('cache-inv'),
            creatorId,
          })
        )
        .returning();

      const [inserted] = await db
        .insert(stripeConnectAccounts)
        .values(createTestConnectAccountInput(invOrg.id, creatorId))
        .returning();

      const invalidateSpy = vi.spyOn(cache, 'invalidate');

      await cachedService.handleAccountUpdated({
        id: inserted.stripeAccountId,
        charges_enabled: true,
        payouts_enabled: true,
        requirements: { currently_due: [], disabled_reason: null },
      } as unknown as Stripe.Account);

      // Keyed on the account's userId now, not the vestigial organizationId
      // (Codex-69t7c.2). creatorId is the account's user.
      expect(invalidateSpy).toHaveBeenCalledWith(creatorId);
      expect(invalidateSpy).toHaveBeenCalledTimes(1);

      // Duplicate Stripe webhook delivery — second invalidation must be a
      // safe no-op (idempotency invariant; Stripe retries webhooks).
      await cachedService.handleAccountUpdated({
        id: inserted.stripeAccountId,
        charges_enabled: true,
        payouts_enabled: true,
        requirements: { currently_due: [], disabled_reason: null },
      } as unknown as Stripe.Account);

      expect(invalidateSpy).toHaveBeenCalledTimes(2);
    });

    it('does NOT throw when cache invalidation fails — webhook idempotency wins', async () => {
      const { VersionedCache } = await import('@codex/cache');
      const { createMockKVNamespace, createMockObservability } = await import(
        '@codex/test-utils'
      );

      const kv = createMockKVNamespace();
      const { obs } = createMockObservability();
      const cache = new VersionedCache({
        kv: kv as unknown as KVNamespace,
        prefix: 'cache',
        obs,
      });

      vi.spyOn(cache, 'invalidate').mockRejectedValueOnce(
        new Error('KV unavailable')
      );

      const cachedService = new ConnectAccountService(
        { db, environment: 'test', cache },
        stripe
      );

      const [failOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('cache-fail'),
            creatorId,
          })
        )
        .returning();

      const [inserted] = await db
        .insert(stripeConnectAccounts)
        .values(createTestConnectAccountInput(failOrg.id, creatorId))
        .returning();

      // MUST resolve — DB write already happened, cache failure is logged
      await expect(
        cachedService.handleAccountUpdated({
          id: inserted.stripeAccountId,
          charges_enabled: true,
          payouts_enabled: true,
          requirements: { currently_due: [], disabled_reason: null },
        } as unknown as Stripe.Account)
      ).resolves.toBeUndefined();
    });

    it('invalidates by userId even when organizationId is NULL (Codex-69t7c.2 regression)', async () => {
      // The WP1 cache key was gated on the vestigial `organizationId`, so an
      // orgless account (organizationId IS NULL) silently SKIPPED invalidation
      // and served stale status until the 10-min TTL. Keying on userId fixes it.
      const { VersionedCache } = await import('@codex/cache');
      const { createMockKVNamespace, createMockObservability } = await import(
        '@codex/test-utils'
      );

      const kv = createMockKVNamespace();
      const { obs } = createMockObservability();
      const cache = new VersionedCache({
        kv: kv as unknown as KVNamespace,
        prefix: 'cache',
        obs,
      });

      const cachedService = new ConnectAccountService(
        { db, environment: 'test', cache },
        stripe
      );

      // Orgless account — organizationId deliberately NULL.
      const [inserted] = await db
        .insert(stripeConnectAccounts)
        .values({
          userId: creatorId,
          organizationId: null,
          stripeAccountId: `acct_orgless_inv_${createUniqueSlug('a')}`,
          status: 'onboarding',
          chargesEnabled: false,
          payoutsEnabled: false,
        })
        .returning();

      const invalidateSpy = vi.spyOn(cache, 'invalidate');

      await cachedService.handleAccountUpdated({
        id: inserted.stripeAccountId,
        charges_enabled: true,
        payouts_enabled: true,
        requirements: { currently_due: [], disabled_reason: null },
      } as unknown as Stripe.Account);

      // Pre-WP2 this was NOT called (organizationId null → invalidation skipped).
      expect(invalidateSpy).toHaveBeenCalledWith(creatorId);
      expect(invalidateSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Schema invariants (Codex-69t7c WP1) ─────────────────────────────
  describe('schema invariants (Codex-69t7c WP1)', () => {
    it('enforces one Connect account per user (uq_stripe_connect_user)', async () => {
      const [orgA] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('uq-a'),
            creatorId,
          })
        )
        .returning();
      const [orgB] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('uq-b'),
            creatorId,
          })
        )
        .returning();

      await db
        .insert(stripeConnectAccounts)
        .values(createTestConnectAccountInput(orgA.id, creatorId));

      // A second account for the same user — even under a DIFFERENT org —
      // must violate the single-account-per-user unique constraint.
      await expect(
        db
          .insert(stripeConnectAccounts)
          .values(createTestConnectAccountInput(orgB.id, creatorId))
      ).rejects.toThrow();
    });

    it('allows a Connect account with a null organizationId (orgless creator)', async () => {
      const [row] = await db
        .insert(stripeConnectAccounts)
        .values({
          userId: creatorId,
          organizationId: null,
          stripeAccountId: `acct_orgless_${createUniqueSlug('a')}`,
          status: 'active',
          chargesEnabled: true,
          payoutsEnabled: true,
        })
        .returning();
      expect(row.organizationId).toBeNull();
      expect(row.userId).toBe(creatorId);
    });
  });

  // ─── getAccountForUser (Codex-69t7c.2) ───────────────────────────────

  describe('getAccountForUser', () => {
    it('resolves the account for a userId (self-account resolution)', async () => {
      const [selfOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('self-acct'),
            creatorId,
          })
        )
        .returning();
      const [inserted] = await db
        .insert(stripeConnectAccounts)
        .values(createTestConnectAccountInput(selfOrg.id, creatorId))
        .returning();

      const account = await service.getAccountForUser(creatorId);
      expect(account).not.toBeNull();
      expect(account?.userId).toBe(creatorId);
      expect(account?.stripeAccountId).toBe(inserted.stripeAccountId);
    });

    it('returns null when the user has no account', async () => {
      const account = await service.getAccountForUser(otherCreatorId);
      expect(account).toBeNull();
    });
  });

  // ─── getAccount org → primary-user resolution (Codex-69t7c.2) ─────────

  describe('getAccount org resolution', () => {
    it('resolves org → owner account via fallback when the pin is unset', async () => {
      const [fbOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('owner-fallback'),
            creatorId,
          })
        )
        .returning();
      // Owner membership but NO pin — resolvePrimaryConnect falls back to owner.
      await db.insert(organizationMemberships).values({
        organizationId: fbOrg.id,
        userId: creatorId,
        role: 'owner',
        status: 'active',
      });
      await db
        .insert(stripeConnectAccounts)
        .values(createTestConnectAccountInput(fbOrg.id, creatorId));

      const account = await service.getAccount(fbOrg.id);
      expect(account).not.toBeNull();
      expect(account?.userId).toBe(creatorId);
    });

    it('returns null when the org has neither a pin nor an owner account', async () => {
      const [noneOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('no-resolution'),
            creatorId,
          })
        )
        .returning();
      const account = await service.getAccount(noneOrg.id);
      expect(account).toBeNull();
    });
  });

  // ─── getStatusForUser (Codex-69t7c.2) ────────────────────────────────

  describe('getStatusForUser', () => {
    it('returns the disconnected sentinel when the user has no account', async () => {
      const result = await service.getStatusForUser(otherCreatorId);
      expect(result).toEqual({
        isConnected: false,
        accountId: null,
        chargesEnabled: false,
        payoutsEnabled: false,
        status: null,
        requirements: null,
      });
      expect(stripe.accounts.retrieve).not.toHaveBeenCalled();
    });

    it('returns the status payload for a connected user', async () => {
      const [inserted] = await db
        .insert(stripeConnectAccounts)
        .values(
          createTestConnectAccountInput(orgId, creatorId, {
            status: 'active',
            chargesEnabled: true,
            payoutsEnabled: true,
          })
        )
        .returning();
      (stripe.accounts.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: inserted.stripeAccountId,
        charges_enabled: true,
        payouts_enabled: true,
        requirements: {
          currently_due: [],
          eventually_due: [],
          past_due: [],
          pending_verification: [],
          current_deadline: null,
          disabled_reason: null,
          errors: [],
        },
      } as unknown as Stripe.Account);

      const result = await service.getStatusForUser(creatorId);
      expect(result.isConnected).toBe(true);
      expect(result.accountId).toBe(inserted.stripeAccountId);
      expect(result.status).toBe('active');
    });
  });

  // ─── pin-write: organizations.primaryConnectAccountUserId (Codex-69t7c.2) ─
  //
  // The load-bearing WP1 finding: the pin is NEVER written in production, so
  // resolvePrimaryConnect relies entirely on the owner fallback. WP2 materialises
  // it at account activation — scoped to orgs the user OWNS, only when unset.
  // These guard that materialisation (the SOLE production write of the pin).

  describe('pin-write on account activation', () => {
    const readPin = async (id: string) => {
      const [row] = await db
        .select({ pin: organizations.primaryConnectAccountUserId })
        .from(organizations)
        .where(eq(organizations.id, id));
      return row?.pin ?? null;
    };

    const activate = (stripeAccountId: string) =>
      service.handleAccountUpdated({
        id: stripeAccountId,
        charges_enabled: true,
        payouts_enabled: true,
        requirements: { currently_due: [], disabled_reason: null },
      } as unknown as Stripe.Account);

    it('pins owned orgs whose pin is unset to the activating user', async () => {
      const [ownedOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('pin-owned'),
            creatorId,
          })
        )
        .returning();
      await db.insert(organizationMemberships).values({
        organizationId: ownedOrg.id,
        userId: creatorId,
        role: 'owner',
        status: 'active',
      });
      const [acct] = await db
        .insert(stripeConnectAccounts)
        .values(
          createTestConnectAccountInput(ownedOrg.id, creatorId, {
            status: 'onboarding',
            chargesEnabled: false,
            payoutsEnabled: false,
          })
        )
        .returning();

      expect(await readPin(ownedOrg.id)).toBeNull();
      await activate(acct.stripeAccountId);
      expect(await readPin(ownedOrg.id)).toBe(creatorId);
    });

    it('does NOT overwrite an existing (non-null) pin', async () => {
      const [pinnedOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('pin-existing'),
            creatorId,
          })
        )
        .returning();
      // creatorId is the owner, but the org is already pinned to a DIFFERENT
      // user (e.g. a future "designate payout account" feature).
      await db.insert(organizationMemberships).values({
        organizationId: pinnedOrg.id,
        userId: creatorId,
        role: 'owner',
        status: 'active',
      });
      await db
        .update(organizations)
        .set({ primaryConnectAccountUserId: otherCreatorId })
        .where(eq(organizations.id, pinnedOrg.id));
      const [acct] = await db
        .insert(stripeConnectAccounts)
        .values(createTestConnectAccountInput(pinnedOrg.id, creatorId))
        .returning();

      await activate(acct.stripeAccountId);

      // Pin untouched — an explicit assignment is never stolen.
      expect(await readPin(pinnedOrg.id)).toBe(otherCreatorId);
    });

    it('pins nothing when the activating user owns no orgs', async () => {
      // Org owned by otherCreatorId; the account belongs to creatorId, who is
      // NOT an owner — a creator-slice account, not the org's payout owner.
      const [foreignOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('pin-nonowner'),
            creatorId: otherCreatorId,
          })
        )
        .returning();
      await db.insert(organizationMemberships).values({
        organizationId: foreignOrg.id,
        userId: otherCreatorId,
        role: 'owner',
        status: 'active',
      });
      const [acct] = await db
        .insert(stripeConnectAccounts)
        .values(createTestConnectAccountInput(foreignOrg.id, creatorId))
        .returning();

      await activate(acct.stripeAccountId);

      expect(await readPin(foreignOrg.id)).toBeNull();
    });

    it('is idempotent across duplicate webhook deliveries', async () => {
      const [idemOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('pin-idem'),
            creatorId,
          })
        )
        .returning();
      await db.insert(organizationMemberships).values({
        organizationId: idemOrg.id,
        userId: creatorId,
        role: 'owner',
        status: 'active',
      });
      const [acct] = await db
        .insert(stripeConnectAccounts)
        .values(createTestConnectAccountInput(idemOrg.id, creatorId))
        .returning();

      await activate(acct.stripeAccountId);
      await activate(acct.stripeAccountId);

      expect(await readPin(idemOrg.id)).toBe(creatorId);
    });

    it('pins the org even on a non-active (onboarding) account.updated', async () => {
      // The pin records the owner regardless of payability — payability is
      // gated at transfer time, not by pin existence (Codex-69t7c.2).
      const [obPinOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('pin-onboarding'),
            creatorId,
          })
        )
        .returning();
      await db.insert(organizationMemberships).values({
        organizationId: obPinOrg.id,
        userId: creatorId,
        role: 'owner',
        status: 'active',
      });
      const [acct] = await db
        .insert(stripeConnectAccounts)
        .values(
          createTestConnectAccountInput(obPinOrg.id, creatorId, {
            status: 'onboarding',
            chargesEnabled: false,
            payoutsEnabled: false,
          })
        )
        .returning();

      // account.updated arrives still in onboarding (NOT active).
      await service.handleAccountUpdated({
        id: acct.stripeAccountId,
        charges_enabled: false,
        payouts_enabled: false,
        requirements: {
          currently_due: ['external_account'],
          disabled_reason: null,
        },
      } as unknown as Stripe.Account);

      expect(await readPin(obPinOrg.id)).toBe(creatorId);
    });

    it('retains the pin on deauthorization (account surfaces as disabled)', async () => {
      // Deliberate: the pin stays so resolvePrimaryConnect surfaces the
      // now-disabled account, which transfer-time active-checks block — rather
      // than silently rerouting the org slice to a different owner.
      const [deauthOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('pin-deauth'),
            creatorId,
          })
        )
        .returning();
      await db.insert(organizationMemberships).values({
        organizationId: deauthOrg.id,
        userId: creatorId,
        role: 'owner',
        status: 'active',
      });
      await db
        .update(organizations)
        .set({ primaryConnectAccountUserId: creatorId })
        .where(eq(organizations.id, deauthOrg.id));
      const [acct] = await db
        .insert(stripeConnectAccounts)
        .values(
          createTestConnectAccountInput(deauthOrg.id, creatorId, {
            status: 'active',
            chargesEnabled: true,
            payoutsEnabled: true,
          })
        )
        .returning();

      await service.handleAccountDeauthorized(acct.stripeAccountId);

      expect(await readPin(deauthOrg.id)).toBe(creatorId);
      const after = await service.getAccountForUser(creatorId);
      expect(after?.status).toBe('disabled');
    });
  });
});
