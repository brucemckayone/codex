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
 * - One account per user (unique constraint, Codex-69t7c) — org-independent;
 *   the org→account link lives on `organizations.primaryConnectAccountUserId`
 *
 * Onboarding Flow:
 * 1. createAccount() → Stripe account + Account Link
 * 2. User completes Stripe-hosted onboarding
 * 3. account.updated webhook → handleAccountUpdated()
 * 4. isReady() returns true when charges_enabled + payouts_enabled
 */

import { CacheType, type VersionedCache } from '@codex/cache';
import {
  organizationMemberships,
  organizations,
  stripeConnectAccounts,
} from '@codex/database/schema';
import { resolvePrimaryConnect } from '@codex/purchase';
import { BaseService, type ServiceConfig } from '@codex/service-errors';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type Stripe from 'stripe';
import {
  ConnectAccountNotFoundError,
  ConnectPlatformNotConfiguredError,
} from '../errors';

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
  /**
   * True when the live Stripe `accounts.retrieve` call FAILED, so
   * `requirements` reflects only what we know (nothing) rather than a
   * confirmed "no outstanding requirements". Lets the UI distinguish
   * "account is clean" (`requirements: null` + `false`) from "we couldn't
   * check right now" (`requirements: null` + `true`) instead of collapsing
   * both into an identical healthy-looking payload (Codex-y2htq).
   */
  requirementsFetchFailed: boolean;
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
 * Status payload for a user/org that has never onboarded a Connect account.
 *
 * Shared by the user- and org-keyed status paths so the "no account" branch is
 * identical regardless of how the lookup was keyed.
 */
const DISCONNECTED_STATUS: ConnectStatusPayload = {
  isConnected: false,
  accountId: null,
  chargesEnabled: false,
  payoutsEnabled: false,
  status: null,
  requirements: null,
  requirementsFetchFailed: false,
};

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
   * Create a Stripe Express Connect account for a user and return the
   * onboarding URL. One account per user (Codex-69t7c) — org-independent.
   *
   * The org→account link is materialised separately by `handleAccountUpdated`
   * (on the user's `account.updated` events), which pins
   * `primaryConnectAccountUserId` for the orgs this user owns. Onboarding
   * therefore carries NO org context.
   */
  async createAccountForUser(
    userId: string,
    returnUrl: string,
    refreshUrl: string
  ): Promise<{ accountId: string; onboardingUrl: string }> {
    try {
      // One account per user — resume any existing one rather than duplicating.
      const existing = await this.getAccountForUser(userId);
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

      // Create Express-equivalent account via controller properties.
      //
      // Idempotency key keyed on the user: `accounts.create` is the one step
      // that mints an unrecoverable Stripe resource. If a later step throws (or
      // the creator double-clicks), a retry replays the SAME key and Stripe
      // returns the SAME account instead of orphaning a duplicate connected
      // account (Stripe honours the key for ~24h). This matches the
      // idempotency-key discipline already used across TierService /
      // SubscriptionService for every Stripe create call.
      const account = await this.stripe.accounts.create(
        {
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
            codex_user_id: userId,
          },
        },
        { idempotencyKey: `connect_acct_${userId}` }
      );

      // Persist the DB row BEFORE generating the onboarding link. Ordering is
      // deliberate: the account link is single-use and cheaply regenerated by
      // the `existing` resume branch above, but the Stripe account is not —
      // writing the row first means any failure after this point (link
      // generation, a transient error) leaves a RECOVERABLE row rather than a
      // Stripe account with no local record (which the null-DB retry path would
      // then duplicate). `organizationId` is the vestigial WP1 column — the
      // org→account link now lives on `organizations.primaryConnectAccountUserId`
      // — so we leave it null; a user account has no single owning org.
      //
      // `onConflictDoNothing` on uq_stripe_connect_user absorbs a concurrent
      // request that raced us to the row; we then re-read the winner, whose
      // `stripeAccountId` is identical thanks to the idempotency key above.
      const [inserted] = await this.db
        .insert(stripeConnectAccounts)
        .values({
          userId,
          stripeAccountId: account.id,
          status: 'onboarding',
          chargesEnabled: false,
          payoutsEnabled: false,
        })
        .onConflictDoNothing({ target: stripeConnectAccounts.userId })
        .returning();

      const canonical = inserted ?? (await this.getAccountForUser(userId));
      const stripeAccountId = canonical?.stripeAccountId ?? account.id;

      // Generate onboarding link (after the row is durable).
      const onboardingUrl = await this.createOnboardingLink(
        stripeAccountId,
        returnUrl,
        refreshUrl
      );

      this.obs.info('Connect account created', {
        userId,
        stripeAccountId,
      });

      return { accountId: stripeAccountId, onboardingUrl };
    } catch (error) {
      // Translate the platform-not-enabled misconfiguration into a typed
      // ServiceError. It keeps the honest HTTP 500 (the failure is genuinely
      // server-side), but its distinct `code` + authored `message` let the
      // studio show an actionable message and let operators grep this failure
      // apart from ordinary 500s. Everything else falls through to handleError,
      // which logs the full Stripe diagnostic surface and wraps as
      // InternalServiceError.
      if (this.isConnectPlatformNotEnabled(error)) {
        this.obs.error('Stripe Connect not enabled for the platform account', {
          context: 'createAccountForUser',
          userId,
          stripeMessage: error instanceof Error ? error.message : String(error),
        });
        throw new ConnectPlatformNotConfiguredError({ userId });
      }
      this.handleError(error, 'createAccountForUser');
    }
  }

  /**
   * True when Stripe rejected `accounts.create` because the PLATFORM account
   * has not signed up for Connect. Stripe raises a generic
   * `StripeInvalidRequestError` with no dedicated `code` for this case, so the
   * human-readable message is the only reliable discriminator — matched
   * narrowly so ordinary bad-param invalid-request errors are NOT swallowed as
   * "platform not configured" (those still bubble to handleError as 500s).
   */
  private isConnectPlatformNotEnabled(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const stripeType = (error as { type?: unknown }).type;
    return (
      stripeType === 'StripeInvalidRequestError' &&
      /signed up for Connect/i.test(error.message)
    );
  }

  /**
   * @deprecated Org-context shim retained for the current studio onboarding
   * route until WP3 migrates it to the creator-scoped `/connect/me` flow. The
   * account is keyed on the user (org-independent); `orgId` is ignored.
   */
  async createAccount(
    _orgId: string,
    userId: string,
    returnUrl: string,
    refreshUrl: string
  ): Promise<{ accountId: string; onboardingUrl: string }> {
    return this.createAccountForUser(userId, returnUrl, refreshUrl);
  }

  /**
   * Get a user's single Connect account (one account per user, Codex-69t7c —
   * org-independent). Returns null when the user has not onboarded.
   */
  async getAccountForUser(
    userId: string
  ): Promise<StripeConnectAccount | null> {
    const [account] = await this.db
      .select()
      .from(stripeConnectAccounts)
      .where(eq(stripeConnectAccounts.userId, userId))
      .limit(1);
    return account ?? null;
  }

  /**
   * Get a Connect account.
   *
   * With `userId`, delegates to `getAccountForUser`. With only `orgId`, resolves
   * the org's canonical account via `organizations.primaryConnectAccountUserId`
   * (with owner fallback). Returns null when no matching account exists.
   *
   * @deprecated orgId-first shim retained for compile-compat; prefer
   * `getAccountForUser(userId)` or `resolvePrimaryConnect(db, orgId)`.
   */
  async getAccount(
    orgId: string,
    userId?: string
  ): Promise<StripeConnectAccount | null> {
    if (userId) {
      return this.getAccountForUser(userId);
    }
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
  /**
   * Get the full Connect status for a user — cache-aside, keyed by `userId`.
   *
   * Keying on the user (not the org) means `account.updated` can invalidate the
   * cache reliably: the webhook always has the account's `userId`, whereas the
   * vestigial `organizationId` is frequently null (Codex-69t7c.2 — closes the
   * WP1 TTL-stale-skip review finding).
   */
  async getStatusForUser(userId: string): Promise<ConnectStatusPayload> {
    if (this.cache) {
      const result = await this.cache.getWithResult(
        userId,
        CacheType.CONNECT_STATUS,
        () => this.fetchStatusFromStripeForUser(userId),
        { ttl: CONNECT_STATUS_TTL_SECONDS }
      );
      this.obs.debug('getStatusForUser', { userId, cacheHit: result.hit });
      return result.data;
    }

    return this.fetchStatusFromStripeForUser(userId);
  }

  /**
   * Get the full Connect status for an org.
   *
   * @deprecated orgId-first shim — resolves org → primary user, then delegates
   * to `getStatusForUser`. Prefer `getStatusForUser(userId)`.
   */
  async getStatus(orgId: string): Promise<ConnectStatusPayload> {
    const userId = await this.resolveUserIdForOrg(orgId);
    if (!userId) return DISCONNECTED_STATUS;
    return this.getStatusForUser(userId);
  }

  /**
   * Generate a new onboarding link for a user's existing account.
   * Used to resume abandoned onboarding — Stripe remembers prior progress.
   */
  async refreshOnboardingLinkForUser(
    userId: string,
    returnUrl: string,
    refreshUrl: string
  ): Promise<{ onboardingUrl: string }> {
    const account = await this.getAccountForUser(userId);
    if (!account) {
      throw new ConnectAccountNotFoundError(userId);
    }

    const onboardingUrl = await this.createOnboardingLink(
      account.stripeAccountId,
      returnUrl,
      refreshUrl
    );

    return { onboardingUrl };
  }

  /**
   * @deprecated orgId-first shim — delegates to `refreshOnboardingLinkForUser`.
   */
  async refreshOnboardingLink(
    _orgId: string,
    userId: string,
    returnUrl: string,
    refreshUrl: string
  ): Promise<{ onboardingUrl: string }> {
    return this.refreshOnboardingLinkForUser(userId, returnUrl, refreshUrl);
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
      userId: updated.userId,
      status,
      chargesEnabled,
      payoutsEnabled,
    });

    // Materialise the org→account pin for every org this user OWNS that has no
    // pin yet (Codex-69t7c.2). This is the SOLE production write of
    // `organizations.primaryConnectAccountUserId`; until it fires,
    // `resolvePrimaryConnect` falls back to the org owner — so a failure here
    // degrades to that fallback, never a broken payout (see pinOwnedOrgsToUser).
    await this.pinOwnedOrgsToUser(updated.userId);

    // Connect status changed — invalidate the cached `getStatusForUser`
    // response so the next read is fresh. Keyed on `userId` (always present on
    // the row), NOT the vestigial `organizationId` which was frequently null and
    // silently skipped invalidation pre-WP2 (Codex-69t7c.2).
    await this.invalidateStatusCache(updated.userId);
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
      userId: updated.userId,
    });

    // The pin is intentionally left in place — resolvePrimaryConnect surfaces
    // the now-`disabled` account, which correctly blocks payouts until the user
    // reconnects (Codex-69t7c.2).
    await this.invalidateStatusCache(updated.userId);
  }

  /**
   * Generate an Express Dashboard login link for a user's account.
   */
  async createDashboardLinkForUser(userId: string): Promise<{ url: string }> {
    const account = await this.getAccountForUser(userId);
    if (!account) {
      throw new ConnectAccountNotFoundError(userId);
    }

    const loginLink = await this.stripe.accounts.createLoginLink(
      account.stripeAccountId
    );

    return { url: loginLink.url };
  }

  /**
   * @deprecated orgId-first shim — resolves org → primary user, then delegates
   * to `createDashboardLinkForUser`.
   */
  async createDashboardLink(orgId: string): Promise<{ url: string }> {
    const userId = await this.resolveUserIdForOrg(orgId);
    if (!userId) {
      throw new ConnectAccountNotFoundError(orgId);
    }
    return this.createDashboardLinkForUser(userId);
  }

  /**
   * Check if a user's Connect account is fully ready for transactions.
   */
  async isReadyForUser(userId: string): Promise<boolean> {
    const account = await this.getAccountForUser(userId);
    if (!account) return false;
    return account.chargesEnabled && account.payoutsEnabled;
  }

  /**
   * @deprecated orgId-first shim — resolves org → primary user, then delegates
   * to `isReadyForUser`.
   */
  async isReady(orgId: string): Promise<boolean> {
    const userId = await this.resolveUserIdForOrg(orgId);
    if (!userId) return false;
    return this.isReadyForUser(userId);
  }

  /**
   * Sync a user's local account status with Stripe's current state.
   * Calls stripe.accounts.retrieve() and updates the local record. Useful as a
   * fallback when webhooks can't reach the server (local dev, missed events).
   */
  async syncAccountStatusForUser(
    userId: string
  ): Promise<StripeConnectAccount | null> {
    const account = await this.getAccountForUser(userId);
    if (!account) {
      throw new ConnectAccountNotFoundError(userId);
    }

    const stripeAccount = await this.stripe.accounts.retrieve(
      account.stripeAccountId
    );

    // Reuse the same status derivation logic as handleAccountUpdated
    await this.handleAccountUpdated(stripeAccount);

    // Return the updated record
    return this.getAccountForUser(userId);
  }

  /**
   * @deprecated orgId-first shim. With `userId`, delegates directly; with only
   * `orgId`, resolves org → primary user then delegates to
   * `syncAccountStatusForUser`.
   */
  async syncAccountStatus(
    orgId: string,
    userId?: string
  ): Promise<StripeConnectAccount | null> {
    if (userId) {
      return this.syncAccountStatusForUser(userId);
    }
    const resolvedUserId = await this.resolveUserIdForOrg(orgId);
    if (!resolvedUserId) {
      throw new ConnectAccountNotFoundError(orgId);
    }
    return this.syncAccountStatusForUser(resolvedUserId);
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  /**
   * Resolve an org to its primary Connect user id (pin → owner fallback).
   *
   * Shared by the `@deprecated` orgId-first shims so they all funnel through
   * the same `resolvePrimaryConnect` semantics. Returns null when neither an
   * explicit pin nor an owner account exists.
   */
  private async resolveUserIdForOrg(orgId: string): Promise<string | null> {
    return (await resolvePrimaryConnect(this.db, orgId))?.userId ?? null;
  }

  /**
   * Invalidate the cached Connect status for a user (best-effort).
   *
   * Keyed on `userId` so invalidation fires regardless of the vestigial
   * `organizationId` (Codex-69t7c.2). Idempotent — a duplicate webhook delivery
   * just bumps the cache version again, a no-op for correctness. Failures are
   * logged at WARN and swallowed: a stale-cache risk must never fail a webhook
   * whose DB write already committed.
   */
  private async invalidateStatusCache(userId: string): Promise<void> {
    if (!this.cache) return;
    try {
      await this.cache.invalidate(userId);
    } catch (error) {
      this.obs.warn('Connect status cache invalidation failed', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Materialise `organizations.primaryConnectAccountUserId` for every org this
   * user OWNS that has no pin yet, settling the org's revenue slice on the
   * user's single Connect account (Codex-69t7c.2).
   *
   * Runs on EVERY `account.updated` (not only activation): pinning early is
   * harmless because payability is gated separately at transfer time
   * (`chargesEnabled`/`payoutsEnabled`), never by the pin's existence.
   *
   * Idempotent + safe:
   * - `role = 'owner'` only, and `WHERE primaryConnectAccountUserId IS NULL` →
   *   the FIRST owner to onboard wins the pin; it is never overwritten, never
   *   stolen, and a re-delivered event is a no-op.
   * - Until the pin is set, `resolvePrimaryConnect` falls back to an org owner;
   *   the pin (first owner to onboard) then makes the settlement target explicit
   *   and stable. NB the unpinned fallback's owner selection across multi-owner
   *   orgs is not yet deterministic — tracked in Codex-rjwdm.
   *
   * Best-effort: a failure is logged at WARN and swallowed — resolution still
   * works via the deterministic owner fallback until a later event sets the
   * pin, so we never fail the webhook over this materialisation.
   */
  private async pinOwnedOrgsToUser(userId: string): Promise<void> {
    try {
      const ownedOrgs = await this.db
        .select({ organizationId: organizationMemberships.organizationId })
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.userId, userId),
            eq(organizationMemberships.role, 'owner')
          )
        );

      if (ownedOrgs.length === 0) return;

      const orgIds = ownedOrgs.map((o) => o.organizationId);
      // Bare `.returning()` (no projection) — the `Database | DatabaseWs` union
      // collapses the projected overload; we only need the affected-row count.
      const pinned = await this.db
        .update(organizations)
        .set({ primaryConnectAccountUserId: userId })
        .where(
          and(
            inArray(organizations.id, orgIds),
            isNull(organizations.primaryConnectAccountUserId)
          )
        )
        .returning();

      if (pinned.length > 0) {
        this.obs.info('Connect primary pin materialised', {
          userId,
          pinnedOrgCount: pinned.length,
        });
      }
    } catch (error) {
      this.obs.warn('Connect primary pin materialisation failed', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Fetch live Connect status for a user from DB + Stripe (cache-miss path).
   *
   * Combines the local DB row (source of truth for charges/payouts toggles
   * and derived status) with Stripe's live `requirements` payload so the UI
   * can render `currently_due` / `current_deadline` / `errors`.
   *
   * Returns the disconnected sentinel when no DB row exists — this matches
   * the route handler's existing "no account" branch and avoids a Stripe
   * call for users who never started onboarding.
   */
  private async fetchStatusFromStripeForUser(
    userId: string
  ): Promise<ConnectStatusPayload> {
    const account = await this.getAccountForUser(userId);

    if (!account) {
      return DISCONNECTED_STATUS;
    }

    // Read live requirements from Stripe. Stripe's `account.updated` webhook
    // is the canonical signal for change; we read on cache-miss only.
    let requirements: ConnectRequirements | null = null;
    let requirementsFetchFailed = false;
    try {
      const stripeAccount = await this.stripe.accounts.retrieve(
        account.stripeAccountId
      );
      requirements = normaliseRequirements(stripeAccount.requirements);
    } catch (error) {
      // Graceful degradation: surface what we know from the DB row even if
      // Stripe is unreachable. The UI degrades to "status only" rather than
      // failing the page load. Flag the failure so the UI can distinguish
      // "no outstanding requirements" from "couldn't check" (Codex-y2htq)
      // instead of both looking like a clean `requirements: null`.
      requirementsFetchFailed = true;
      this.obs.warn('Failed to fetch Stripe Connect requirements', {
        userId,
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
      requirementsFetchFailed,
    };
  }

  private async createOnboardingLink(
    stripeAccountId: string,
    returnUrl: string,
    refreshUrl: string
  ): Promise<string> {
    try {
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
    } catch (error) {
      // A rejected return_url/refresh_url is the most common failure here and is
      // only visible at this call site — otherwise it bubbles to a generic 500
      // with no trace of which URL Stripe refused. Log both URLs (not PII) and
      // the raw Stripe reason, then rethrow UNCHANGED so the caller's mapping
      // (ConnectPlatformNotConfiguredError / handleError) still applies.
      this.obs.error('Stripe account link creation failed', {
        stripeAccountId,
        returnUrl,
        refreshUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
