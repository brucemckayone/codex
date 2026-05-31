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

import { CacheType, type VersionedCache } from '@codex/cache';
import { stripeConnectAccounts } from '@codex/database/schema';
import { resolvePrimaryConnect } from '@codex/purchase';
import { BaseService, type ServiceConfig } from '@codex/service-errors';
import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';
import { ConnectAccountNotFoundError } from '../errors';

type StripeConnectAccount = typeof stripeConnectAccounts.$inferSelect;

/**
 * Stripe Connect account requirements payload returned to the UI.
 *
 * Mirrors `Stripe.Account.Requirements` from the Stripe Node SDK
 * (verified against `stripe@19.3.1` types on 2026-05-13). Stripe returns
 * `null` for unset array fields; we normalise to `[]` here so the UI can
 * iterate without null-guards. `current_deadline` and `disabled_reason`
 * remain nullable because they are semantically meaningful as "none yet"
 * / "no reason yet" states the UI distinguishes from empty arrays.
 *
 * See `node_modules/stripe/types/Accounts.d.ts:1228-1268`.
 */
export interface ConnectRequirements {
  currentlyDue: string[];
  eventuallyDue: string[];
  pastDue: string[];
  pendingVerification: string[];
  currentDeadline: number | null;
  disabledReason: string | null;
  errors: Array<{ requirement: string; code: string; reason: string }>;
}

/**
 * Full Connect status payload — what the studio monetisation page consumes.
 *
 * `requirements` is only populated when there's something actionable
 * (status !== 'active') so the UI can render a single warning Alert without
 * additional null checks.
 */
export interface ConnectStatusPayload {
  isConnected: boolean;
  accountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  status: 'onboarding' | 'active' | 'restricted' | 'disabled' | null;
  requirements: ConnectRequirements | null;
}

/**
 * Cache TTL for Connect status (10 min).
 *
 * Webhook delivery (`account.updated`) invalidates the cache so worst-case
 * staleness is bounded by webhook latency, not the TTL. The 10 min ceiling
 * is the safety net for when the webhook silently misses a delivery.
 */
const CONNECT_STATUS_TTL_SECONDS = 600;

/**
 * Normalise Stripe's `Account.Requirements` payload for the UI.
 *
 * Stripe's typings model `currently_due` / `eventually_due` / `past_due` /
 * `pending_verification` as `Array<string> | null`. We return `[]` for null
 * so the UI iterates without null guards. Critical nullable fields
 * (`current_deadline`, `disabled_reason`) are preserved as `null` because
 * the UI distinguishes "no deadline" from "no due fields".
 *
 * Returns `null` when Stripe returned no requirements object at all (rare —
 * usually only on accounts created via legacy paths).
 */
function normaliseRequirements(
  requirements: Stripe.Account['requirements']
): ConnectRequirements | null {
  if (!requirements) return null;

  return {
    currentlyDue: requirements.currently_due ?? [],
    eventuallyDue: requirements.eventually_due ?? [],
    pastDue: requirements.past_due ?? [],
    pendingVerification: requirements.pending_verification ?? [],
    currentDeadline: requirements.current_deadline ?? null,
    disabledReason: requirements.disabled_reason ?? null,
    errors: (requirements.errors ?? []).map((err) => ({
      requirement: err.requirement,
      code: err.code,
      reason: err.reason,
    })),
  };
}

export interface ConnectAccountServiceConfig extends ServiceConfig {
  /**
   * Optional VersionedCache for `getStatus(orgId)` cache-aside.
   *
   * Wired in workers via the service-registry. When omitted (e.g. unit tests),
   * `getStatus()` falls back to direct Stripe + DB reads on every call.
   */
  cache?: VersionedCache;
}

export class ConnectAccountService extends BaseService {
  private readonly stripe: Stripe;
  private cache?: VersionedCache;

  constructor(config: ConnectAccountServiceConfig, stripe: Stripe) {
    super(config);
    this.stripe = stripe;
    this.cache = config.cache;
  }

  /**
   * Inject the cache after construction.
   *
   * Mirrors the `ContentService.setCache` pattern used by the worker service
   * registry — the registry constructs the service first then conditionally
   * wires the cache only when `env.CACHE_KV` is bound.
   */
  setCache(cache: VersionedCache): void {
    this.cache = cache;
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
   * Get a Connect account.
   *
   * With `userId`, returns that user's single account (one account per user,
   * Codex-69t7c — org-independent). With only `orgId`, resolves the org's
   * canonical account via `organizations.primaryConnectAccountUserId`. Returns
   * null when no matching account exists / the org has not onboarded one.
   *
   * NOTE: the orgId-first signature is retained for WP1 compile-compat; WP2
   * replaces callers with explicit userId-centric methods.
   */
  async getAccount(
    orgId: string,
    userId?: string
  ): Promise<StripeConnectAccount | null> {
    // With userId: that user's single account (org-independent, Codex-69t7c).
    if (userId) {
      const [account] = await this.db
        .select()
        .from(stripeConnectAccounts)
        .where(eq(stripeConnectAccounts.userId, userId))
        .limit(1);
      return account ?? null;
    }

    // With only orgId: resolve the org's canonical account via the shared
    // resolver (org → primaryConnectAccountUserId → that user's account).
    return (await resolvePrimaryConnect(this.db, orgId)) ?? null;
  }

  /**
   * Get Connect account by Stripe account id.
   *
   * Used by webhook handlers to read CURRENT DB state before applying an
   * `account.updated` mutation. This is the source of truth for "wasActive"
   * because Stripe's `previous_attributes` diff is unreliable on capability
   * ricochet events (verified via Context7 2026-05-13: `account.updated`
   * fires on ANY status/property change and `previous_attributes` may NOT
   * contain `charges_enabled`/`payouts_enabled` when the event is triggered
   * by a tangential capability or requirement field flip).
   */
  async getAccountByStripeId(
    stripeAccountId: string
  ): Promise<StripeConnectAccount | null> {
    const [account] = await this.db
      .select()
      .from(stripeConnectAccounts)
      .where(eq(stripeConnectAccounts.stripeAccountId, stripeAccountId))
      .limit(1);

    return account ?? null;
  }

  /**
   * Get the full Connect status for an org — cache-aside.
   *
   * Returns the local DB-cached `isConnected/chargesEnabled/payoutsEnabled/status`
   * fields PLUS the live `requirements` payload from Stripe (currently_due,
   * eventually_due, current_deadline, errors, disabled_reason). The Stripe
   * `requirements` shape changes only via `account.updated` webhooks, so the
   * webhook handler is responsible for invalidating this cache.
   *
   * Falls back to direct fetch when no cache is wired (e.g. unit tests).
   *
   * @param orgId - Organization ID (cache key namespace)
   * @returns Connect status payload with requirements
   */
  async getStatus(orgId: string): Promise<ConnectStatusPayload> {
    if (this.cache) {
      const result = await this.cache.getWithResult(
        orgId,
        CacheType.CONNECT_STATUS,
        () => this.fetchStatusFromStripe(orgId),
        { ttl: CONNECT_STATUS_TTL_SECONDS }
      );
      this.obs.debug('getStatus', { orgId, cacheHit: result.hit });
      return result.data;
    }

    return this.fetchStatusFromStripe(orgId);
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
    const isActive = chargesEnabled && payoutsEnabled;

    // Determine status from capabilities
    let status: 'onboarding' | 'active' | 'restricted' | 'disabled';
    if (isActive) {
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
        onboardingCompletedAt: isActive ? new Date() : null,
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

    // Stripe's `requirements` payload changed — invalidate the cached
    // `getStatus(orgId)` response so the next read returns fresh data.
    // Idempotent: a duplicate `account.updated` delivery just bumps the
    // version a second time, which is a no-op for correctness. Skipped when
    // organizationId is null (vestigial column, Codex-69t7c) — WP2 reworks
    // this cache key off the org column entirely.
    if (this.cache && updated.organizationId) {
      try {
        await this.cache.invalidate(updated.organizationId);
      } catch (error) {
        this.obs.warn('Connect status cache invalidation failed', {
          organizationId: updated.organizationId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Handle account.application.deauthorized webhook.
   * Marks the local Connect account as disabled so the platform
   * stops attempting transfers to a disconnected account.
   */
  async handleAccountDeauthorized(stripeAccountId: string): Promise<void> {
    const [updated] = await this.db
      .update(stripeConnectAccounts)
      .set({
        status: 'disabled',
        chargesEnabled: false,
        payoutsEnabled: false,
        updatedAt: new Date(),
      })
      .where(eq(stripeConnectAccounts.stripeAccountId, stripeAccountId))
      .returning();

    if (!updated) {
      this.obs.warn('Deauthorized event for unknown Connect account', {
        stripeAccountId,
      });
      return;
    }

    this.obs.info('Connect account deauthorized', {
      stripeAccountId,
      organizationId: updated.organizationId,
    });

    if (this.cache && updated.organizationId) {
      try {
        await this.cache.invalidate(updated.organizationId);
      } catch (error) {
        this.obs.warn('Connect status cache invalidation failed', {
          organizationId: updated.organizationId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
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

  /**
   * Fetch live Connect status from DB + Stripe (cache miss path).
   *
   * Combines the local DB row (source of truth for charges/payouts toggles
   * and derived status) with Stripe's live `requirements` payload so the UI
   * can render `currently_due` / `current_deadline` / `errors`.
   *
   * Returns the disconnected sentinel when no DB row exists — this matches
   * the route handler's existing "no account" branch and avoids a Stripe
   * call for orgs that never started onboarding.
   */
  private async fetchStatusFromStripe(
    orgId: string
  ): Promise<ConnectStatusPayload> {
    const account = await this.getAccount(orgId);

    if (!account) {
      return {
        isConnected: false,
        accountId: null,
        chargesEnabled: false,
        payoutsEnabled: false,
        status: null,
        requirements: null,
      };
    }

    // Read live requirements from Stripe. Stripe's `account.updated` webhook
    // is the canonical signal for change; we read on cache-miss only.
    let requirements: ConnectRequirements | null = null;
    try {
      const stripeAccount = await this.stripe.accounts.retrieve(
        account.stripeAccountId
      );
      requirements = normaliseRequirements(stripeAccount.requirements);
    } catch (error) {
      // Graceful degradation: surface what we know from the DB row even if
      // Stripe is unreachable. The UI degrades to "status only" rather than
      // failing the page load.
      this.obs.warn('Failed to fetch Stripe Connect requirements', {
        organizationId: orgId,
        stripeAccountId: account.stripeAccountId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      isConnected: true,
      accountId: account.stripeAccountId,
      chargesEnabled: account.chargesEnabled,
      payoutsEnabled: account.payoutsEnabled,
      // DB column is `text` so Drizzle infers `string`; narrow to the union
      // we publish. The four values are the canonical set written by
      // `handleAccountUpdated` — anything else is a data corruption bug.
      status: account.status as ConnectStatusPayload['status'],
      requirements,
    };
  }

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
