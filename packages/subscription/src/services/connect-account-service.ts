/**
 * Connect Account Service
 *
 * Manages Stripe Connect Express account onboarding and lifecycle.
 *
 * Key Responsibilities:
 * - Create Express-equivalent Connect accounts for org owners and creators
 * - Generate onboarding links (Account Links)
 * - Track account readiness (charges_enabled, payouts_enabled)
 * - Handle account.updated webhook events
 * - Provide Express Dashboard login links
 *
 * Account Model:
 * - Express-equivalent via controller properties (new Stripe API)
 * - Platform controls fees (controller.fees.payer = 'application')
 * - Stripe handles identity verification and compliance
 * - One account per user per org (unique constraint)
 *
 * Onboarding Flow:
 * 1. createAccount() → Stripe account + Account Link
 * 2. User completes Stripe-hosted onboarding
 * 3. account.updated webhook → handleAccountUpdated()
 * 4. isReady() returns true when charges_enabled + payouts_enabled
 */

import { stripeConnectAccounts } from '@codex/database/schema';
import { BaseService, type ServiceConfig } from '@codex/service-errors';
import { and, eq } from 'drizzle-orm';
import type Stripe from 'stripe';
import { ConnectAccountNotFoundError } from '../errors';

type StripeConnectAccount = typeof stripeConnectAccounts.$inferSelect;

export class ConnectAccountService extends BaseService {
  private readonly stripe: Stripe;

  constructor(config: ServiceConfig, stripe: Stripe) {
    super(config);
    this.stripe = stripe;
  }

  /**
   * Create a Stripe Express Connect account and return the onboarding URL.
   * Stores the account record in our database.
   */
  async createAccount(
    orgId: string,
    userId: string,
    returnUrl: string,
    refreshUrl: string
  ): Promise<{ accountId: string; onboardingUrl: string }> {
    try {
      // Check if account already exists for this user + org
      const existing = await this.getAccount(orgId, userId);
      if (existing) {
        // Resume onboarding if not complete
        if (!existing.chargesEnabled || !existing.payoutsEnabled) {
          const link = await this.createOnboardingLink(
            existing.stripeAccountId,
            returnUrl,
            refreshUrl
          );
          return { accountId: existing.stripeAccountId, onboardingUrl: link };
        }
        // Already fully onboarded
        return {
          accountId: existing.stripeAccountId,
          onboardingUrl: returnUrl,
        };
      }

      // Create Express-equivalent account via controller properties
      const account = await this.stripe.accounts.create({
        controller: {
          stripe_dashboard: { type: 'express' },
          fees: { payer: 'application' },
          losses: { payments: 'application' },
          requirement_collection: 'stripe',
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        country: 'GB',
        metadata: {
          codex_organization_id: orgId,
          codex_user_id: userId,
        },
      });

      // Generate onboarding link
      const onboardingUrl = await this.createOnboardingLink(
        account.id,
        returnUrl,
        refreshUrl
      );

      // Store in database
      await this.db.insert(stripeConnectAccounts).values({
        organizationId: orgId,
        userId,
        stripeAccountId: account.id,
        status: 'onboarding',
        chargesEnabled: false,
        payoutsEnabled: false,
      });

      this.obs.info('Connect account created', {
        organizationId: orgId,
        stripeAccountId: account.id,
      });

      return { accountId: account.id, onboardingUrl };
    } catch (error) {
      this.handleError(error, 'createAccount');
    }
  }

  /**
   * Get Connect account for a user within an org.
   */
  async getAccount(
    orgId: string,
    userId?: string
  ): Promise<StripeConnectAccount | null> {
    const conditions = [eq(stripeConnectAccounts.organizationId, orgId)];
    if (userId) {
      conditions.push(eq(stripeConnectAccounts.userId, userId));
    }

    const [account] = await this.db
      .select()
      .from(stripeConnectAccounts)
      .where(and(...conditions))
      .limit(1);

    return account ?? null;
  }

  /**
   * Generate a new onboarding link for an existing account.
   * Used to resume abandoned onboarding — Stripe remembers prior progress.
   */
  async refreshOnboardingLink(
    orgId: string,
    userId: string,
    returnUrl: string,
    refreshUrl: string
  ): Promise<{ onboardingUrl: string }> {
    const account = await this.getAccount(orgId, userId);
    if (!account) {
      throw new ConnectAccountNotFoundError(orgId);
    }

    const onboardingUrl = await this.createOnboardingLink(
      account.stripeAccountId,
      returnUrl,
      refreshUrl
    );

    return { onboardingUrl };
  }

  /**
   * Webhook handler: account.updated
   * Updates local record with current Stripe account status.
   */
  async handleAccountUpdated(stripeAccount: Stripe.Account): Promise<void> {
    const stripeAccountId = stripeAccount.id;

    const chargesEnabled = stripeAccount.charges_enabled ?? false;
    const payoutsEnabled = stripeAccount.payouts_enabled ?? false;

    // Determine status from capabilities
    let status: 'onboarding' | 'active' | 'restricted' | 'disabled';
    if (chargesEnabled && payoutsEnabled) {
      status = 'active';
    } else if (stripeAccount.requirements?.disabled_reason) {
      status = 'disabled';
    } else if (
      stripeAccount.requirements?.currently_due &&
      stripeAccount.requirements.currently_due.length > 0
    ) {
      status = 'restricted';
    } else {
      status = 'onboarding';
    }

    const [updated] = await this.db
      .update(stripeConnectAccounts)
      .set({
        chargesEnabled,
        payoutsEnabled,
        status,
        onboardingCompletedAt:
          chargesEnabled && payoutsEnabled ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(stripeConnectAccounts.stripeAccountId, stripeAccountId))
      .returning();

    if (!updated) {
      this.obs.warn('Connect account update for unknown account', {
        stripeAccountId,
      });
      return;
    }

    this.obs.info('Connect account updated', {
      stripeAccountId,
      organizationId: updated.organizationId,
      status,
      chargesEnabled,
      payoutsEnabled,
    });
  }

  /**
   * Generate an Express Dashboard login link for the org owner.
   */
  async createDashboardLink(orgId: string): Promise<{ url: string }> {
    const account = await this.getAccount(orgId);
    if (!account) {
      throw new ConnectAccountNotFoundError(orgId);
    }

    const loginLink = await this.stripe.accounts.createLoginLink(
      account.stripeAccountId
    );

    return { url: loginLink.url };
  }

  /**
   * Check if the org's Connect account is fully ready for transactions.
   */
  async isReady(orgId: string): Promise<boolean> {
    const account = await this.getAccount(orgId);
    if (!account) return false;
    return account.chargesEnabled && account.payoutsEnabled;
  }

  /**
   * Sync local account status with Stripe's current state.
   * Calls stripe.accounts.retrieve() and updates the local record.
   * Useful as a fallback when webhooks can't reach the server (local dev, missed events).
   */
  async syncAccountStatus(
    orgId: string,
    userId?: string
  ): Promise<StripeConnectAccount | null> {
    const account = await this.getAccount(orgId, userId);
    if (!account) {
      throw new ConnectAccountNotFoundError(orgId);
    }

    const stripeAccount = await this.stripe.accounts.retrieve(
      account.stripeAccountId
    );

    // Reuse the same status derivation logic as handleAccountUpdated
    await this.handleAccountUpdated(stripeAccount);

    // Return the updated record
    return this.getAccount(orgId, userId);
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  private async createOnboardingLink(
    stripeAccountId: string,
    returnUrl: string,
    refreshUrl: string
  ): Promise<string> {
    const accountLink = await this.stripe.accountLinks.create({
      account: stripeAccountId,
      return_url: returnUrl,
      refresh_url: refreshUrl,
      type: 'account_onboarding',
      collection_options: {
        fields: 'eventually_due',
      },
    });

    return accountLink.url;
  }
}
