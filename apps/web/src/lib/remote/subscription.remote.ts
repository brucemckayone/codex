/**
 * Subscription Remote Functions
 *
 * Server-side functions for subscription management:
 * - Tier browsing (public)
 * - Subscription checkout
 * - Subscription lifecycle (cancel, change tier, reactivate)
 * - Admin: tier CRUD, subscriber stats
 * - Connect account management
 */

import {
  createSearchQuerySchema,
  payoutSourceFilterEnum,
  payoutStatusFilterEnum,
  planItemsDeltaSchema,
  planItemsQuerySchema,
} from '@codex/validation';
import { z } from 'zod';
import { command, getRequestEvent, query } from '$app/server';
import { ApiError } from '$lib/api/errors';
import { logger } from '$lib/observability';
import { createServerApi } from '$lib/server/api';

type SubscriptionCommandFailure = {
  success: false;
  /** The worker's top-level code, often a class code such as 'CONFLICT'. */
  code: string | undefined;
  /**
   * The worker's `details.code`. Most subscription errors put their own code
   * there, under a class code at the top level: 'SUBSCRIPTION_DISPUTED' sits
   * under 'CONFLICT' (Codex-2hxff.60). Kept apart from `code` so that every
   * mapping keyed on the top-level code reads what it read before.
   */
  detailsCode: string | undefined;
  message: string;
  status: number;
};

function detailsCodeOf(details: unknown): string | undefined {
  if (!details || typeof details !== 'object') return undefined;
  const code = (details as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * A failed command as the answer the page reads.
 *
 * An `ApiError` is the worker's own answer, and goes on as it is. Anything
 * else had no answer behind it: the fetch to the worker threw (a dropped
 * connection) or the success body would not parse, so the worker may still
 * have acted. Returning it skips the `handleError` hook a throw would reach,
 * so it is logged here, where its cause is (Codex-2hxff.66), and the browser
 * gets fixed copy, never `error.message`.
 */
function toCommandFailure(
  error: unknown,
  commandName: string,
  organizationId: string
): SubscriptionCommandFailure {
  if (ApiError.isApiError(error)) {
    return {
      success: false,
      code: error.code,
      detailsCode: detailsCodeOf(error.details),
      message: error.message,
      status: error.status,
    };
  }
  logger.error(
    `subscription command ${commandName} failed with no API answer`,
    {
      organizationId,
      errorName: error instanceof Error ? error.name : typeof error,
      reason: error instanceof Error ? error.message : String(error),
    }
  );
  return {
    success: false,
    code: undefined,
    detailsCode: undefined,
    message: 'An unexpected error occurred',
    status: 500,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier Queries (public)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List active subscription tiers for an org (public, no auth required).
 * Used on the org pricing page and content detail modals.
 */
export const listTiers = query(z.string().uuid(), async (orgId) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return api.tiers.list(orgId);
});

// ─────────────────────────────────────────────────────────────────────────────
// Subscription Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the user's current subscription for an org.
 * Returns null if no active subscription.
 */
export const getCurrentSubscription = query(
  z.string().uuid(),
  async (organizationId) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.subscription.getCurrent(organizationId);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Subscription Checkout (command — SPA style)
// ─────────────────────────────────────────────────────────────────────────────

const subscriptionCheckoutCommandSchema = z.object({
  tierId: z.string().uuid(),
  billingInterval: z.enum(['month', 'year']),
  organizationId: z.string().uuid(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

/**
 * Create subscription checkout session and return URL.
 * For SPA-style checkout with client-side redirect.
 */
export const createSubscriptionCheckoutSession = command(
  subscriptionCheckoutCommandSchema,
  async ({
    tierId,
    billingInterval,
    organizationId,
    successUrl,
    cancelUrl,
  }) => {
    const { platform, cookies, url } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    try {
      const result = await api.subscription.checkout({
        organizationId,
        tierId,
        billingInterval,
        // Stripe expands `{CHECKOUT_SESSION_ID}` to the real session id on
        // redirect. The /subscription/success page polls the verify endpoint
        // until the `checkout.session.completed` webhook has landed, then
        // hands the user off to /library — otherwise they'd land on /library
        // before the subscription row exists and see an empty page.
        successUrl:
          successUrl ||
          `${url.origin}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: cancelUrl || `${url.origin}/pricing`,
      });

      return { success: true as const, sessionUrl: result.sessionUrl };
    } catch (error) {
      return toCommandFailure(
        error,
        'createSubscriptionCheckoutSession',
        organizationId
      );
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Subscription Lifecycle Commands
// ─────────────────────────────────────────────────────────────────────────────

const changeTierCommandSchema = z.object({
  organizationId: z.string().uuid(),
  newTierId: z.string().uuid(),
  billingInterval: z.enum(['month', 'year']),
  /**
   * Unix timestamp (seconds) — pass through from `previewSubscriptionTierChange()`
   * so the commit-time charge matches the dialog preview exactly.
   * Omitted by `previewSubscriptionTierChange` itself (preview computes its own).
   */
  prorationDate: z.number().int().positive().optional(),
});

/**
 * Preview the proration a tier change would produce. Powers the confirmation
 * dialog. The returned `prorationDate` MUST be threaded back into
 * `changeSubscriptionTier()` so the commit-time charge matches the preview.
 */
export const previewSubscriptionTierChange = command(
  changeTierCommandSchema,
  async (input) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    try {
      const result = await api.subscription.previewTierChange(input);
      return { success: true as const, data: result };
    } catch (error) {
      return toCommandFailure(
        error,
        'previewSubscriptionTierChange',
        input.organizationId
      );
    }
  }
);

/**
 * Change (upgrade/downgrade) subscription tier.
 */
export const changeSubscriptionTier = command(
  changeTierCommandSchema,
  async (input) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    try {
      const result = await api.subscription.changeTier(input);
      return { success: true as const, data: result };
    } catch (error) {
      return toCommandFailure(
        error,
        'changeSubscriptionTier',
        input.organizationId
      );
    }
  }
);

const cancelCommandSchema = z.object({
  organizationId: z.string().uuid(),
  reason: z.string().max(500).optional(),
  churnReason: z
    .enum([
      'too_expensive',
      'not_enough_content',
      'found_alternative',
      'not_using_it',
      'technical_issues',
      'other',
    ])
    .optional(),
});

/**
 * Cancel subscription at end of current billing period.
 */
export const cancelSubscription = command(
  cancelCommandSchema,
  async (input) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    try {
      const result = await api.subscription.cancel(input);
      return { success: true as const, data: result };
    } catch (error) {
      return toCommandFailure(
        error,
        'cancelSubscription',
        input.organizationId
      );
    }
  }
);

const reactivateCommandSchema = z.object({
  organizationId: z.string().uuid(),
});

/**
 * Reactivate a subscription that is set to cancel at period end.
 */
export const reactivateSubscription = command(
  reactivateCommandSchema,
  async (input) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    try {
      const result = await api.subscription.reactivate(input);
      return { success: true as const, data: result };
    } catch (error) {
      return toCommandFailure(
        error,
        'reactivateSubscription',
        input.organizationId
      );
    }
  }
);

const resumeCommandSchema = z.object({
  organizationId: z.string().uuid(),
});

/**
 * Resume a PAUSED subscription (user-initiated).
 *
 * Parallel to `reactivateSubscription` but for the `paused → active`
 * transition. The backend calls Stripe's `subscriptions.resume` API and
 * flips the local DB row back to 'active'. See bead Codex-7h4vo.
 */
export const resumeSubscription = command(
  resumeCommandSchema,
  async (input) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    try {
      const result = await api.subscription.resume(input);
      return { success: true as const, data: result };
    } catch (error) {
      return toCommandFailure(
        error,
        'resumeSubscription',
        input.organizationId
      );
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Tier CRUD Commands
// ─────────────────────────────────────────────────────────────────────────────

const createTierCommandSchema = z.object({
  orgId: z.string().uuid(),
  /**
   * One id per create attempt, minted by the tier dialog (Codex-2hxff.66). The
   * server keys the Stripe product and prices on it, so a retry or a double
   * submit with the same id gets back the tier the first attempt made.
   */
  submissionId: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  priceMonthly: z.number().int().min(100),
  priceAnnual: z.number().int().min(100),
  isRecommended: z.boolean().optional(),
  /**
   * "Include everything from…" (Codex-2hxff.91): a live tier of the org whose
   * films and courses the new tier starts with, copied in the same server
   * command as the create. `null` copies nothing. A replayed `submissionId`
   * returns the first attempt's tier and copies nothing again.
   */
  copyAccessFromTierId: z.string().uuid().nullable().optional(),
});

/**
 * Create a new subscription tier for an org.
 *
 * A refusal is RETURNED, not thrown (Codex-2hxff.66). The dialog has to tell
 * the worker's typed refusals apart, and they sit in `details.code`: 409
 * `SUBMISSION_IN_PROGRESS` / `SUBMISSION_ID_REUSED` and 503
 * `STRIPE_UNAVAILABLE`. A thrown error reaches the browser as a sanitised 500
 * with no code: a 4xx unless forwarded, and a 5xx always.
 */
export const createTier = command(
  createTierCommandSchema,
  async ({ orgId, ...data }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    try {
      return {
        success: true as const,
        tier: await api.tiers.create(orgId, data),
      };
    } catch (error) {
      return toCommandFailure(error, 'createTier', orgId);
    }
  }
);

const updateTierCommandSchema = z.object({
  orgId: z.string().uuid(),
  tierId: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  priceMonthly: z.number().int().min(100).optional(),
  priceAnnual: z.number().int().min(100).optional(),
  isRecommended: z.boolean().optional(),
});

/**
 * Update an existing subscription tier.
 */
export const updateTier = command(
  updateTierCommandSchema,
  async ({ orgId, tierId, ...data }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.tiers.update(orgId, tierId, data);
  }
);

const deleteTierCommandSchema = z.object({
  orgId: z.string().uuid(),
  tierId: z.string().uuid(),
  /**
   * What happens to the films and courses ONLY in this tier (Codex-2hxff.91):
   * keep them subscribers-only with no tier (closed, never free), or move them
   * to one or more other tiers. Sent only after the creator chose (owner
   * decision U5); without it the worker refuses whenever such items exist.
   */
  choice: z
    .discriminatedUnion('onlyHere', [
      z.object({ onlyHere: z.literal('keep') }),
      z.object({
        onlyHere: z.literal('move'),
        moveTo: z.array(z.string().uuid()).min(1).max(50),
      }),
    ])
    .optional(),
});

/**
 * Soft-delete a subscription tier.
 *
 * A refusal is RETURNED, not thrown, with its `details.code`, because the
 * dialog acts on two of them: `TIER_HAS_SUBSCRIBERS` (someone subscribed
 * since the dialog's check) and `TIER_HAS_ONLY_ITEMS` (something became only
 * in this tier since the check). A thrown 4xx reaches the browser as a
 * sanitised 500 with no code.
 */
export const deleteTier = command(
  deleteTierCommandSchema,
  async ({ orgId, tierId, choice }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    try {
      await api.tiers.delete(orgId, tierId, choice);
      return { success: true as const };
    } catch (error) {
      return toCommandFailure(error, 'deleteTier', orgId);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Admin: what each tier includes (Codex-2hxff.91)
// ─────────────────────────────────────────────────────────────────────────────
// Studio-only, authoritative and uncached (organization-api,
// `requireOrgManagement`): per-tier counts, gaps and checklist rows never go
// on a public or cached route.

/**
 * Per-tier film and course counts, the guidance-note gaps, and the org's
 * eligible / closed / ineligible film counts. Feeds the tier rows, the create
 * dialog's "copies 18 films and 2 courses" and the checklist's chips.
 */
export const getTierAccessSummary = query(z.string().uuid(), async (orgId) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return api.tiers.accessSummary(orgId);
});

const tierRefSchema = z.object({
  orgId: z.string().uuid(),
  tierId: z.string().uuid(),
});

/**
 * What deleting a tier would leave only in it, and its live subscribers. The
 * delete dialog offers Delete only once this has loaded.
 */
export const getTierDeleteImpact = query(
  tierRefSchema,
  async ({ orgId, tierId }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.tiers.deleteImpact(orgId, tierId);
  }
);

/** One page of the tier checklist ("What's in {tier}"). */
export const listTierItems = query(
  tierRefSchema.extend({ query: planItemsQuerySchema }),
  async ({ orgId, tierId, query: itemsQuery }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.tiers.items(orgId, tierId, itemsQuery);
  }
);

/**
 * The checklist's save: a capped, idempotent DELTA of adds and removes. A
 * refusal is RETURNED with its `details.code` (a creator who can't be paid
 * yet is `CREATOR_CONNECT_REQUIRED`); nothing is written on any refusal.
 */
export const setTierItems = command(
  tierRefSchema.extend({ delta: planItemsDeltaSchema }),
  async ({ orgId, tierId, delta }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    try {
      return {
        success: true as const,
        result: await api.tiers.setItems(orgId, tierId, delta),
      };
    } catch (error) {
      return toCommandFailure(error, 'setTierItems', orgId);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Feature Toggle
// ─────────────────────────────────────────────────────────────────────────────

const updateSubscriptionFeatureSchema = z.object({
  orgId: z.string().uuid(),
  enabled: z.boolean(),
});

/**
 * Toggle the enableSubscriptions feature flag for an org.
 */
export const updateSubscriptionFeature = command(
  updateSubscriptionFeatureSchema,
  async ({ orgId, enabled }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.org.updateFeatures(orgId, { enableSubscriptions: enabled });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Stats & Subscribers Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get subscription stats for an org (admin).
 */
export const getSubscriptionStats = query(
  z.string().uuid(),
  async (organizationId) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.subscription.getStats(organizationId);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Stripe Connect Commands
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The org's payout status — read-only, status fields only (Codex-2hxff.1).
 *
 * The org-level onboard/status/sync/dashboard remotes are gone with the routes
 * they called: a person sets up, checks and opens only their OWN payout
 * account, through the self-scoped /me remotes below.
 */
export const getOrganizationPayoutStatus = query(
  z.string().uuid(),
  async (organizationId) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.connect.getOrganizationStatus(organizationId);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Payouts Query (Codex-zqaxo)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Subscribers list (studio Subscribers page — Codex-1csms)
// ─────────────────────────────────────────────────────────────────────────────

const listSubscribersQueryArgsSchema = z.object({
  organizationId: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  tierId: z.string().uuid().optional(),
  status: z.string().optional(),
  includeCancelled: z.coerce.boolean().optional(),
  search: createSearchQuerySchema(120),
});

/**
 * List subscribers for the studio Subscribers page (Codex-1csms).
 *
 * Owner-only at the UI layer (the worker route uses requireOrgManagement +
 * the page applies $effect redirect for non-owners — same pattern as
 * /studio/payouts). Returns SubscriberListItem rows joined with user + tier.
 *
 * Re-fires every time any arg changes — snapshot semantics matching the
 * payouts page (no TanStack DB live collection in Phase 1).
 */
export const listSubscribers = query(
  listSubscribersQueryArgsSchema,
  async ({
    organizationId,
    page,
    limit,
    tierId,
    status,
    includeCancelled,
    search,
  }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(limit));
    if (tierId) params.set('tierId', tierId);
    if (status) params.set('status', status);
    if (includeCancelled) params.set('includeCancelled', 'true');
    if (search) params.set('search', search);
    return api.subscription.getSubscribers(organizationId, params);
  }
);

const listPayoutsQueryArgsSchema = z.object({
  organizationId: z.string().uuid(),
  status: payoutStatusFilterEnum.default('all'),
  source: payoutSourceFilterEnum.default('all'),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  /**
   * Rows transferred on or after this: the date a bank day follows from, so
   * a backlog sale released late is caught (Org Payouts' Held).
   */
  transferredFrom: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const getPayoutSummaryArgsSchema = z.object({
  organizationId: z.string().uuid(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

/**
 * List pending + resolved creator payouts for an org (Codex-zqaxo).
 *
 * Backs the read-only `/studio/payouts` table. Owner-only — the worker
 * route enforces `requireOrgManagement` and re-derives scope from the
 * authenticated session membership; the client-supplied
 * `organizationId` is only used to build the URL.
 *
 * NOT cached as a TanStack DB live collection in Phase 1 — each
 * filter/page is a fresh snapshot query. See epic Codex-kbfe3 design
 * decisions.
 */
export const listPayouts = query(
  listPayoutsQueryArgsSchema,
  async ({
    organizationId,
    status,
    source,
    fromDate,
    toDate,
    transferredFrom,
    page,
    limit,
  }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (source) params.set('source', source);
    if (fromDate) params.set('fromDate', fromDate);
    if (toDate) params.set('toDate', toDate);
    if (transferredFrom) params.set('transferredFrom', transferredFrom);
    params.set('page', String(page));
    params.set('limit', String(limit));
    return api.subscription.listPayouts(organizationId, params);
  }
);

/**
 * Aggregate KPI numbers for the studio payouts page header (Codex-05vp8).
 *
 * Returns lifetime totals + an `earnedInPeriodCents` aggregate bounded by
 * `fromDate` / `toDate`. Owner-only — the worker re-derives scope from the
 * session membership.
 */
export const getPayoutSummary = query(
  getPayoutSummaryArgsSchema,
  async ({ organizationId, fromDate, toDate }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    const params = new URLSearchParams();
    if (fromDate) params.set('fromDate', fromDate);
    if (toDate) params.set('toDate', toDate);
    return api.subscription.getPayoutSummary(organizationId, params);
  }
);

/**
 * Per-creator payout breakdown for the studio payouts right rail
 * (Codex-6nt4l). Returns one entry per user who received a
 * `creator_payout` or `organization_fee` row under the current filters;
 * `platform_fee` rows are excluded. Owner-only.
 *
 * Args mirror `listPayouts` minus pagination — the rail intentionally
 * aggregates the whole row set, not a page slice. Filter chips on the
 * page reshape both the table AND the rail by passing the same args to
 * both queries.
 */
const getPayoutsByCreatorBreakdownArgsSchema = z.object({
  organizationId: z.string().uuid(),
  status: payoutStatusFilterEnum.default('all'),
  source: payoutSourceFilterEnum.default('all'),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

export const getPayoutsByCreatorBreakdown = query(
  getPayoutsByCreatorBreakdownArgsSchema,
  async ({ organizationId, status, source, fromDate, toDate }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (source) params.set('source', source);
    if (fromDate) params.set('fromDate', fromDate);
    if (toDate) params.set('toDate', toDate);
    return api.subscription.getPayoutsByCreatorBreakdown(
      organizationId,
      params
    );
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Creator-self-scoped /me remotes (Codex-69t7c.8 / WP8)
//
// These remotes target the /connect/me/* and /subscriptions/me/* routes from
// WP3 + WP7. They are SELF-SCOPED to the session user — they MUST NOT accept
// or forward an organizationId / userId parameter (IDOR prevention, epic D8).
// The backend derives identity exclusively from the session cookie.
// ─────────────────────────────────────────────────────────────────────────────

const connectMeOnboardCommandSchema = z.object({
  returnUrl: z.string().url(),
  refreshUrl: z.string().url(),
});

/**
 * Create (or reuse) the current creator's Stripe Connect account and return
 * the Stripe onboarding URL. Maps to POST /connect/me/onboard (201).
 *
 * Security invariant: NO organizationId — the backend creates the account
 * against ctx.user.id only.
 */
export const connectMeOnboard = command(
  connectMeOnboardCommandSchema,
  async (input) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.connect.onboardMe(input);
  }
);

/**
 * Get the current creator's Connect account status.
 * Maps to GET /connect/me/status — no input, self-scoped.
 */
export const getMyConnectStatus = query(z.void(), async () => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return api.connect.getMyStatus();
});

/**
 * Force a Stripe status sync for the current creator, then return the
 * refreshed status payload. Maps to POST /connect/me/sync.
 *
 * Used on ?connect=success return from Stripe onboarding (webhook may not
 * yet have landed). Returns the same shape as getMyConnectStatus.
 */
export const syncMyConnect = command(z.void(), async () => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return api.connect.syncMyStatus();
});

/**
 * Get a Stripe Express dashboard login link for the current creator.
 * Maps to POST /connect/me/dashboard — no input, self-scoped.
 */
export const getMyConnectDashboard = command(z.void(), async () => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return api.connect.getMyDashboardLink();
});

/**
 * The current user's own Stripe balance (Codex-2hxff.29, .30): the next bank
 * payout, a take-back the balance is covering, and a balance below zero.
 * Maps to GET /connect/me/balance — self-scoped, no input; ecom-api caches it
 * for 10 minutes. Org Studio → Payouts reads it for the owner, whose one
 * account receives the organisation's share. It rejects (404) for a user with
 * no Connect account.
 */
export const getMyStripeBalance = query(async () => {
  const { platform, cookies } = getRequestEvent();
  return createServerApi(platform, cookies).connect.getMyBalance();
});

// ─────────────────────────────────────────────────────────────────────────────
// Creator-self-scoped payouts + earnings (Codex-69t7c.7 / WP7 → WP8 wiring)
// ─────────────────────────────────────────────────────────────────────────────

const getMyPayoutsQueryArgsSchema = z.object({
  status: payoutStatusFilterEnum.default('all'),
  source: payoutSourceFilterEnum.default('all'),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});

/**
 * List the current creator's own payouts across ALL orgs that paid them
 * (paginated). Maps to GET /subscriptions/me/payouts.
 *
 * Security invariant: NO organizationId / userId — the worker filters by
 * ctx.user.id + personal payout types. Returns {items, pagination} envelope.
 */
export const getMyPayouts = query(
  getMyPayoutsQueryArgsSchema,
  async ({ status, source, fromDate, toDate, page, limit }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    const params = new URLSearchParams();
    params.set('status', status);
    params.set('source', source);
    if (fromDate) params.set('fromDate', fromDate);
    if (toDate) params.set('toDate', toDate);
    params.set('page', String(page));
    params.set('limit', String(limit));
    return api.subscription.getMyPayouts(params);
  }
);

const getMyEarningsSummaryQueryArgsSchema = z.object({
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

/**
 * KPI numbers for the creator earnings hub (earned in period, total earned,
 * in transit, needs-attention count). userId-scoped across all orgs.
 * Maps to GET /subscriptions/me/earnings-summary — single {data} envelope.
 *
 * Security invariant: NO organizationId / userId — backend uses ctx.user.id.
 */
export const getMyEarningsSummary = query(
  getMyEarningsSummaryQueryArgsSchema,
  async ({ fromDate, toDate }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    const params = new URLSearchParams();
    if (fromDate) params.set('fromDate', fromDate);
    if (toDate) params.set('toDate', toDate);
    return api.subscription.getMyEarningsSummary(params);
  }
);
