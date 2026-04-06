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

import { organizations, stripeConnectAccounts } from '@codex/database/schema';
import {
  createMockStripe,
  createTestConnectAccountInput,
  createTestOrganizationInput,
  createUniqueSlug,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
  validateDatabaseConnection,
} from '@codex/test-utils';
import type Stripe from 'stripe';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConnectAccountNotFoundError } from '../../errors';
import { ConnectAccountService } from '../connect-account-service';

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

  beforeEach(() => {
    // Don't reset IDs — unique constraint on stripeAccountId means IDs must be globally unique
    stripe = createMockStripe();
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
          metadata: {
            codex_organization_id: freshOrg.id,
            codex_user_id: creatorId,
          },
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
          metadata: {
            codex_organization_id: metaOrg.id,
            codex_user_id: creatorId,
          },
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
        })
      );
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
});
