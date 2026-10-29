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
 *   an org's account is its owner's (`resolveOrganisationPayee`, Codex-2hxff.2)
 *
 * Onboarding Flow:
 * 1. createAccountForUser() → Stripe account + Account Link
 * 2. User completes Stripe-hosted onboarding
 * 3. account.updated webhook → handleAccountUpdated()
 * 4. isReadyForUser() returns true when charges_enabled + payouts_enabled
 */

import { CacheType, type VersionedCache } from '@codex/cache';
import { stripeEnvMetadata } from '@codex/constants';
import {
  connectBalances,
  type PayoutType,
  stripeConnectAccounts,
} from '@codex/database/schema';
import {
  type BankTransfer,
  chargeTimesWanted,
  type DebtRule,
  debtRule,
  episodeCausesFrom,
  episodeTakeBacks,
  firstLondon0800After,
  type LedgerSale,
  ledgerSalesSince,
  listBankTransfers,
  londonDate,
  projectNextPayout,
  readGbpBalance,
  resolveOrganisationPayee,
  runReadingEnd,
  towardsKind,
  towardsTakeBack,
  UNSENT_LOOKBACK_MS,
  type UnsentWindow,
  unsentSales,
  withChargeTimes,
} from '@codex/payments';
import {
  BaseService,
  type ServiceConfig,
  ServiceUnavailableError,
} from '@codex/service-errors';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
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
 * An organisation's payout readiness, as any member may see it.
 *
 * Deliberately a subset of {@link ConnectStatusPayload}: no `accountId` and no
 * `requirements` — those describe the account holder's own Stripe account and
 * are theirs alone (Codex-2hxff.1).
 */
export type OrganizationPayoutStatus = Pick<
  ConnectStatusPayload,
  'isConnected' | 'chargesEnabled' | 'payoutsEnabled' | 'status'
>;

/**
 * A creator's own Stripe balance, for Studio → Earnings (`GET
 * /connect/me/balance`, Codex-2hxff.29, .30; data design §3.3, §4.2). Read live
 * from Stripe, cached 10 minutes. Amounts are GBP pence; dates are London
 * calendar dates, `YYYY-MM-DD`.
 */
export interface MyStripeBalance {
  checkedAt: string;
  /** May be below zero: Stripe holds that debt (Q2). */
  availableCents: number;
  pendingCents: number;
  /** False until this account is switched to manual payouts. */
  manualPayouts: boolean;
  /** When it was switched (ISO), for Earnings' 14-day switch-over notice (OQ5). */
  manualPayoutsSince: string | null;
  /** The next daily bank payout that would pay anything; null when none. */
  nextPayout: { on: string; amountCents: number } | null;
  /**
   * What went towards a take-back instead of the bank, sale by sale
   * (amendment 3, `towardsTakeBack`), over ALL the person's sales: every
   * organisation and their own. Org Payouts shows its own rows' results.
   */
  towards: {
    /** Now: covering a take-back, or below zero. Null when nothing is. */
    live: MyStripeBalanceTowards | null;
    /**
     * The last below-zero episode that ended; a sale's remainder goes on
     * max(its bankOn, the clearing run). Earlier episodes aren't shared.
     */
    lastEpisode:
      | (MyStripeBalanceTowards & {
          /** London `YYYY-MM-DD` of its first run that paid nothing. */
          since: string;
          /** London `YYYY-MM-DD` of the run that saw it clear. */
          clearedOn: string;
        })
      | null;
  };
  /**
   * A take-back the balance covered (studio S2): `towards.live` while the
   * balance is above zero.
   */
  covering: {
    cents: number;
    rows: Array<{ payoutId: string; cents: number }>;
  } | null;
  /** Null unless available is below zero. */
  negative: {
    owedCents: number;
    /**
     * The first run that paid nothing: the daily check that saw it, else the
     * next run (this morning's, if it hasn't run yet, paid as usual).
     */
    since: string;
    rule: DebtRule;
    /**
     * What took the balance below zero, newest first: the M7 email's own
     * take-backs (`episodeTakeBacks`). Empty when unknown; the page keeps
     * its generic line.
     */
    causes: MyStripeBalanceCause[];
  } | null;
}

/** What went towards a take-back, and from which sales, oldest first. */
export interface MyStripeBalanceTowards {
  cents: number;
  rows: Array<{ payoutId: string; towardsCents: number }>;
  /**
   * What it went towards: a refund or a chargeback (`dispute`), or null when
   * the take-backs in its window are mixed or unknown (`towardsKind`).
   */
  causeType: 'refund' | 'dispute' | null;
}

/** One refund or chargeback that took the balance below zero. */
export interface MyStripeBalanceCause {
  causeType: 'refund' | 'dispute';
  /** The person's steps for it, summed. */
  cents: number;
  /** London `YYYY-MM-DD` when Stripe took it back (its latest step). */
  on: string;
  title: string | null;
  /** The sale's organisation: Payouts names no title for another's. */
  organizationId: string | null;
  organisationName: string | null;
  /**
   * The payout types it was taken from, sorted: `organization_fee` and
   * `creator_payout_to_owner` are the organisation's share,
   * `creator_payout` the creator share.
   */
  payoutTypes: PayoutType[];
}

/** Studio's balance read gives up after 5 s, unretried: the page offers Try again. */
const STUDIO_BALANCE_STRIPE_REQUEST = {
  timeout: 5_000,
  maxNetworkRetries: 0,
} as const satisfies Stripe.RequestOptions;

/** Cache TTL for the Studio balance (10 min, design §9). */
const CONNECT_BALANCE_TTL_SECONDS = 600;

/** The webhook's re-read of an account before it clears the job's flag. */
const ACCOUNT_RECHECK_STRIPE_REQUEST = {
  timeout: 10_000,
  maxNetworkRetries: 1,
} as const satisfies Stripe.RequestOptions;

/** What the daily bank payout needs of an account: manual payouts AND bank debit off. */
function isManualPayoutSettings(
  payouts: Pick<
    Stripe.Account.Settings.Payouts,
    'schedule' | 'debit_negative_balances'
  >
): boolean {
  return (
    payouts.schedule?.interval === 'manual' &&
    payouts.debit_negative_balances === false
  );
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
 * Status payload for a user who has never onboarded a Connect account.
 *
 * Returned by the cache-miss status path when the user has no account row.
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
   * Optional VersionedCache for `getStatusForUser(userId)` cache-aside.
   *
   * Wired in workers via the service-registry. When omitted (e.g. unit tests),
   * `getStatusForUser()` falls back to direct Stripe + DB reads on every call.
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
   * An org's account is simply its owner's, resolved at payment time
   * (`resolveOrganisationPayee`), so onboarding carries NO org context.
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
      //
      // Payouts are manual from the start (Codex-2hxff.29): the platform's
      // daily job pays out only money older than the 14-day refund window
      // (`runBankPayouts`, @codex/payments). Bank debit is off (.30, Q2):
      // Stripe's default is ON for these accounts (map §7 check 3), and the
      // owner chose never to take a negative balance from a creator's bank.
      // `account.updated` records the switch once Stripe reports both.
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
          settings: {
            payouts: {
              schedule: { interval: 'manual' },
              debit_negative_balances: false,
            },
          },
          country: 'GB',
          metadata: {
            codex_user_id: userId,
            ...stripeEnvMetadata(this.environment),
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
      // then duplicate). `organizationId` is the vestigial WP1 column — an
      // org's account is its owner's, resolved by ownership — so we leave it
      // null; a user account has no single owning org.
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
        // Stripe's message is logged, never put in the error's context, which
        // is sent to the client (Codex-2hxff.23, SEC-02).
        const errorId = crypto.randomUUID();
        this.obs.error('Stripe Connect not enabled for the platform account', {
          errorId,
          context: 'createAccountForUser',
          userId,
          stripeMessage: error instanceof Error ? error.message : String(error),
        });
        throw new ConnectPlatformNotConfiguredError({ userId, errorId });
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
   * the org's current owner's account. Returns null when no matching account
   * exists.
   *
   * @deprecated orgId-first shim retained for compile-compat; prefer
   * `getAccountForUser(userId)` or `resolveOrganisationPayee(db, orgId)`.
   */
  async getAccount(
    orgId: string,
    userId?: string
  ): Promise<StripeConnectAccount | null> {
    if (userId) {
      return this.getAccountForUser(userId);
    }
    return (await resolveOrganisationPayee(this.db, orgId))?.account ?? null;
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
   * Get the full Connect status for a user — cache-aside, keyed by `userId`.
   *
   * Returns the local DB-cached `isConnected/chargesEnabled/payoutsEnabled/status`
   * fields PLUS the live `requirements` payload from Stripe (currently_due,
   * eventually_due, current_deadline, errors, disabled_reason). The Stripe
   * `requirements` shape changes only via `account.updated` webhooks, so the
   * webhook handler is responsible for invalidating this cache. Falls back to
   * direct fetch when no cache is wired (e.g. unit tests).
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
   * The creator's own Stripe balance for Studio → Earnings — cache-aside,
   * keyed by `userId`, 10 minutes. Self-scoped: the caller's own current
   * account, never one named by the client. A failed Stripe read throws
   * (503) and is not cached, so the page can say "couldn't check" and offer
   * Try again.
   */
  async getBalanceForUser(userId: string): Promise<MyStripeBalance> {
    const account = await this.getAccountForUser(userId);
    if (!account) {
      throw new ConnectAccountNotFoundError(userId);
    }
    const fetch = () =>
      this.fetchBalanceFromStripe(userId, account.stripeAccountId);
    if (!this.cache) return fetch();
    const result = await this.cache.getWithResult(
      userId,
      CacheType.CONNECT_BALANCE,
      fetch,
      { ttl: CONNECT_BALANCE_TTL_SECONDS }
    );
    this.obs.debug('getBalanceForUser', { userId, cacheHit: result.hit });
    return result.data;
  }

  /**
   * The organisation's payout readiness — whether the account its money is
   * paid to can take charges and receive payouts.
   *
   * Any member may read this, so it is status only (see
   * {@link OrganizationPayoutStatus}). DB-only: it never calls Stripe, because
   * `account.updated` keeps the row's flags current and the live
   * `requirements` read is the account holder's business, not the members'.
   */
  async getOrganizationPayoutStatus(
    orgId: string
  ): Promise<OrganizationPayoutStatus> {
    const account = (await resolveOrganisationPayee(this.db, orgId))?.account;
    if (!account) {
      return {
        isConnected: false,
        chargesEnabled: false,
        payoutsEnabled: false,
        status: null,
      };
    }
    return {
      isConnected: true,
      chargesEnabled: account.chargesEnabled,
      payoutsEnabled: account.payoutsEnabled,
      // varchar column, pinned to these four values by `check_connect_status`.
      status: account.status as OrganizationPayoutStatus['status'],
    };
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

    await this.recordPayoutSettings(stripeAccount, updated.userId);

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

    // Off the daily bank payout: the platform can no longer read or pay it,
    // and a read that fails every day would take a run slot (review r3
    // LOW-3). Its last snapshot and any episode stay as they were.
    await this.db
      .update(connectBalances)
      .set({ manualPayoutsSince: null })
      .where(eq(connectBalances.stripeAccountId, stripeAccountId));

    // The owner's payouts resolve to this now-`disabled` account, which
    // correctly blocks transfers until they reconnect (Codex-69t7c.2).
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

  // ─── Private Helpers ─────────────────────────────────────────────────────

  /**
   * Resolve an org to its current owner's user id, when they have a Connect
   * account (the `@deprecated` orgId-first shims' semantics). Returns null when
   * there is no owner or they have not onboarded.
   */
  private async resolveUserIdForOrg(orgId: string): Promise<string | null> {
    return (
      (await resolveOrganisationPayee(this.db, orgId))?.account?.userId ?? null
    );
  }

  /**
   * Record whether the daily bank payout job may pay this account
   * (Codex-2hxff.29, data design §2.1). Account creation's database write is
   * not in a transaction with Stripe, so this heals a lost row: the account
   * is flagged once Stripe reports manual payouts AND bank debit off, keeping
   * the first switch date. A flagged account Stripe now reports otherwise was
   * changed by hand in the Dashboard: it leaves the job and support is told.
   * A payload without payout settings says nothing either way.
   *
   * A payload can be stale: Stripe redelivers an event for up to 3 days, and
   * out of order, so one from before the switch can arrive after it. Before a
   * flag is cleared the LIVE account is read, and only a live drift clears it
   * (review MED-2). If Stripe can't be asked, the flag stays and support is
   * told: wrongly clearing it takes the account off the job for good. An
   * unflagged account is likewise asked before it is flagged (review r2
   * LOW-5).
   */
  private async recordPayoutSettings(
    stripeAccount: Stripe.Account,
    userId: string
  ): Promise<void> {
    const settings = stripeAccount.settings?.payouts;
    if (!settings) return;
    const stripeAccountId = stripeAccount.id;
    const [flagged] = await this.db
      .select({ manualPayoutsSince: connectBalances.manualPayoutsSince })
      .from(connectBalances)
      .where(
        and(
          eq(connectBalances.stripeAccountId, stripeAccountId),
          isNotNull(connectBalances.manualPayoutsSince)
        )
      )
      .limit(1);

    if (isManualPayoutSettings(settings)) {
      // Flagged already: the first switch date stands.
      if (flagged) return;
      // A stale "manual" event can arrive after a real drift cleared the flag
      // (review r2 LOW-5), so the live account is asked first. Only a live
      // account that says otherwise stops the flag: if Stripe can't be asked,
      // the event is trusted, since an unflagged manual account is never paid
      // out, while a wrong flag only shows in Studio until Stripe refuses the
      // job's payouts (the 3-day alert).
      const live = await this.livePayoutSettings(stripeAccountId);
      if (
        live.read &&
        live.settings &&
        !isManualPayoutSettings(live.settings)
      ) {
        this.obs.info(
          'A stale account.updated reported manual payouts; the live account is not on them, so it is not flagged',
          { stripeAccountId }
        );
        return;
      }
      if (!live.read) {
        this.obs.warn(
          'Stripe could not be asked to confirm manual payouts; the account is flagged from its account.updated',
          { stripeAccountId, error: live.error }
        );
      }
      await this.db
        .insert(connectBalances)
        .values({ stripeAccountId, userId, manualPayoutsSince: new Date() })
        .onConflictDoUpdate({
          target: connectBalances.stripeAccountId,
          set: {
            manualPayoutsSince: sql`COALESCE(${connectBalances.manualPayoutsSince}, excluded.manual_payouts_since)`,
          },
        });
      return;
    }
    if (!flagged) return;

    const live = await this.livePayoutSettings(stripeAccountId);
    if (!live.read) {
      this.obs.error(
        'An account.updated reported changed payout settings, and Stripe could not be asked to confirm: the account stays on the daily bank payout',
        { errorId: crypto.randomUUID(), stripeAccountId, error: live.error }
      );
      return;
    }
    if (live.settings && isManualPayoutSettings(live.settings)) {
      this.obs.info(
        'A stale account.updated reported old payout settings; the live account is still manual with bank debit off',
        { stripeAccountId }
      );
      return;
    }
    if (!live.settings) {
      this.obs.error(
        'Stripe reported no payout settings for a flagged account: the account stays on the daily bank payout',
        { errorId: crypto.randomUUID(), stripeAccountId }
      );
      return;
    }

    await this.db
      .update(connectBalances)
      .set({ manualPayoutsSince: null })
      .where(eq(connectBalances.stripeAccountId, stripeAccountId));
    this.obs.error(
      'Connect payout settings were changed in Stripe: the account is off the daily bank payout. To heal, put back manual payouts and bank debit off in Stripe (its account.updated flags it again), or re-run backfill-payout-schedule.ts with --apply',
      {
        errorId: crypto.randomUUID(),
        stripeAccountId,
        interval: live.settings.schedule?.interval ?? null,
        debitNegativeBalances: live.settings.debit_negative_balances ?? null,
      }
    );
  }

  /** The account's payout settings as Stripe has them now, or why not. */
  private async livePayoutSettings(
    stripeAccountId: string
  ): Promise<
    | { read: true; settings: Stripe.Account.Settings.Payouts | null }
    | { read: false; error: string }
  > {
    try {
      const account = await this.stripe.accounts.retrieve(
        stripeAccountId,
        {},
        ACCOUNT_RECHECK_STRIPE_REQUEST
      );
      return { read: true, settings: account.settings?.payouts ?? null };
    } catch (error) {
      return {
        read: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * The Studio balance, from Stripe (cache-miss path): the job's own two
   * reads, the balance and the young transfers, and its own formula for the
   * next run. The transfer list is read only when there is money to time,
   * and two days further back than the young ones: the charge times the
   * sharing needs for the sales due at the next run (`chargeTimesWanted`).
   */
  private async fetchBalanceFromStripe(
    userId: string,
    stripeAccountId: string
  ): Promise<MyStripeBalance> {
    const [row] = await this.db
      .select({
        manualPayoutsSince: connectBalances.manualPayoutsSince,
        negativeSince: connectBalances.negativeSince,
        negativeAfter: connectBalances.negativeAfter,
        checkedAt: connectBalances.checkedAt,
        clearedSince: connectBalances.clearedSince,
        clearedAt: connectBalances.clearedAt,
        clearedBalanceCents: connectBalances.clearedBalanceCents,
      })
      .from(connectBalances)
      .where(eq(connectBalances.stripeAccountId, stripeAccountId))
      .limit(1);
    const manualPayoutsSince = row?.manualPayoutsSince ?? null;
    const now = new Date();

    let balance: Awaited<ReturnType<typeof readGbpBalance>>;
    let readAt: Date;
    let transfers: BankTransfer[] = [];
    let listedSince: Date | null = null;
    try {
      balance = await readGbpBalance(
        this.stripe,
        stripeAccountId,
        STUDIO_BALANCE_STRIPE_REQUEST
      );
      // T's reading: what was sent by now is in it (review r5 LOW).
      readAt = new Date();
      if (
        manualPayoutsSince &&
        balance.availableCents + balance.pendingCents > 0
      ) {
        listedSince = new Date(now.getTime() - UNSENT_LOOKBACK_MS);
        transfers = await listBankTransfers(
          this.stripe,
          stripeAccountId,
          listedSince,
          STUDIO_BALANCE_STRIPE_REQUEST
        );
      }
    } catch (error) {
      this.obs.warn('Could not read the Stripe balance for Studio', {
        userId,
        stripeAccountId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new ServiceUnavailableError(
        'Your Stripe balance could not be checked just now',
        undefined,
        { cause: error }
      );
    }

    const towards = manualPayoutsSince
      ? await this.towardsFor({
          userId,
          stripeAccountId,
          manualPayoutsSince,
          now,
          readAt,
          balance,
          listed: { transfers, since: listedSince },
          row,
        })
      : { live: null, lastEpisode: null };
    const covering: MyStripeBalance['covering'] =
      towards.live && balance.availableCents >= 0
        ? {
            cents: towards.live.cents,
            rows: towards.live.rows.map(({ payoutId, towardsCents }) => ({
              payoutId,
              cents: towardsCents,
            })),
          }
        : null;

    const owedCents = -balance.availableCents;
    // The Q4 clock and the take-backs' window run from now until a check
    // sees it; `since` is the first run that pays nothing (web r2 R2-L1).
    const negativeSince = row?.negativeSince ?? now;
    const firstUnpaidRun = row?.negativeSince ?? firstLondon0800After(now);
    // Not yet seen by a morning check: the episode the job will record, from
    // the last check (above zero) to now.
    const causes =
      owedCents > 0
        ? (
            await episodeTakeBacks(this.db, {
              userId,
              negativeSince,
              negativeAfter: row?.negativeSince
                ? row.negativeAfter
                : (row?.checkedAt ?? null),
            })
          ).map(({ at, ...cause }) => ({ ...cause, on: londonDate(at) }))
        : [];
    return {
      checkedAt: now.toISOString(),
      availableCents: balance.availableCents,
      pendingCents: balance.pendingCents,
      manualPayouts: manualPayoutsSince !== null,
      manualPayoutsSince: manualPayoutsSince?.toISOString() ?? null,
      nextPayout: manualPayoutsSince
        ? projectNextPayout({ now, balance, transfers })
        : null,
      towards,
      covering,
      negative:
        owedCents > 0
          ? {
              owedCents,
              since: londonDate(firstUnpaidRun),
              rule: debtRule(owedCents, negativeSince),
              causes,
            }
          : null,
    };
  }

  /**
   * Amendment 3's sharing, live and for the last ended episode, from one read
   * of the person's own ledger rows (`ledgerSalesSince`), each judged by its
   * charge's time where Stripe has it. Live: the unsent sales from the first
   * run that pays nothing (`negative_since`, else the next run), against the
   * balance just read. Ended: those due from `cleared_since`, valued at the
   * clearing run's reading, against `cleared_balance_cents`.
   */
  private async towardsFor(input: {
    userId: string;
    stripeAccountId: string;
    manualPayoutsSince: Date;
    now: Date;
    readAt: Date;
    balance: { availableCents: number; pendingCents: number };
    /** The transfers already listed, and from when: their charge times come free. */
    listed: { transfers: readonly BankTransfer[]; since: Date | null };
    row:
      | {
          negativeSince: Date | null;
          negativeAfter: Date | null;
          clearedSince: Date | null;
          clearedAt: Date | null;
          clearedBalanceCents: number | null;
        }
      | undefined;
  }): Promise<MyStripeBalance['towards']> {
    const { row, manualPayoutsSince } = input;
    const liveWindow: UnsentWindow = {
      from: row?.negativeSince ?? firstLondon0800After(input.now),
      readAt: input.readAt,
      manualPayoutsSince,
    };
    const ended =
      row?.clearedSince && row.clearedAt && row.clearedBalanceCents !== null
        ? {
            since: row.clearedSince,
            clearedAt: row.clearedAt,
            inStripeCents: row.clearedBalanceCents,
            window: {
              from: row.clearedSince,
              readAt: runReadingEnd(row.clearedAt),
              manualPayoutsSince,
            },
          }
        : null;
    const earliest = Math.min(
      liveWindow.from.getTime(),
      ended?.since.getTime() ?? liveWindow.from.getTime()
    );
    let sales = withChargeTimes(
      await ledgerSalesSince(
        this.db,
        input.userId,
        new Date(earliest - UNSENT_LOOKBACK_MS)
      ),
      input.listed.transfers
    );
    for (const window of ended ? [liveWindow, ended.window] : [liveWindow]) {
      sales = await this.withListedChargeTimes(input, sales, window);
    }
    const live = towardsTakeBack({
      sales: unsentSales(sales, liveWindow),
      inStripeCents: input.balance.availableCents + input.balance.pendingCents,
    });
    const lastEpisode = ended
      ? towardsTakeBack({
          sales: unsentSales(sales, ended.window),
          inStripeCents: ended.inStripeCents,
        })
      : null;
    // What each went towards: the take-backs from as far back as its unsent
    // sales were sent (a take-back before the episode can have used their
    // money: engine r6 LOW-1), or the episode's start if earlier, to its
    // reading. `negative_after` is cleared with an ended episode.
    const { userId } = input;
    const causesAfter = (from: Date, episodeStart: Date | null) =>
      new Date(
        Math.min(
          from.getTime() - UNSENT_LOOKBACK_MS,
          episodeStart?.getTime() ?? Number.POSITIVE_INFINITY
        )
      );
    return {
      live:
        live.cents > 0
          ? {
              ...live,
              causeType: await towardsKind(this.db, {
                userId,
                after: causesAfter(
                  liveWindow.from,
                  row?.negativeSince
                    ? episodeCausesFrom(row.negativeSince, row.negativeAfter)
                    : null
                ),
                upTo: liveWindow.readAt,
              }),
            }
          : null,
      lastEpisode:
        ended && lastEpisode && lastEpisode.cents > 0
          ? {
              ...lastEpisode,
              causeType: await towardsKind(this.db, {
                userId,
                after: causesAfter(
                  ended.window.from,
                  episodeCausesFrom(ended.since, null)
                ),
                upTo: ended.window.readAt,
              }),
              since: londonDate(ended.since),
              clearedOn: londonDate(ended.clearedAt),
            }
          : null,
    };
  }

  /**
   * The charge times a window's rows still need (`chargeTimesWanted`), from
   * one bounded list of the account's transfers: usually none, as the young
   * transfers are already listed. A failed read is a 503, as the balance's.
   */
  private async withListedChargeTimes(
    {
      userId,
      stripeAccountId,
      listed,
    }: {
      userId: string;
      stripeAccountId: string;
      listed: { since: Date | null };
    },
    sales: LedgerSale[],
    window: UnsentWindow
  ): Promise<LedgerSale[]> {
    const span = chargeTimesWanted(sales, window, listed.since);
    if (!span) return sales;
    try {
      return withChargeTimes(
        sales,
        await listBankTransfers(
          this.stripe,
          stripeAccountId,
          span.since,
          STUDIO_BALANCE_STRIPE_REQUEST,
          span.until
        )
      );
    } catch (error) {
      this.obs.warn('Could not read the Stripe transfers for Studio', {
        userId,
        stripeAccountId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new ServiceUnavailableError(
        'Your Stripe balance could not be checked just now',
        undefined,
        { cause: error }
      );
    }
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
