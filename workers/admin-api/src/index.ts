/**
 * Admin API Worker
 *
 * Provides admin dashboard functionality for platform owners including:
 * - Revenue analytics
 * - Content management across creators
 * - Customer management and support tools
 *
 * Security Features:
 * - Request tracking (UUID request IDs, IP tracking, user agent)
 * - Security headers (CSP, XFO, etc.)
 * - Rate limiting for all endpoints
 * - Session-based authentication with platform owner role verification
 *
 * Most endpoints require:
 * 1. Valid session (authenticated user)
 * 2. Organization membership with 'owner' or 'admin' role
 * The fee, ownership-support, support-refund and media-restore routes are
 * `platform_owner` instead, with no org policy.
 *
 * Uses the procedure() pattern for unified policy, validation, and error handling.
 */

import { AccessRevocation } from '@codex/access';
import { invalidateUserLibrary } from '@codex/cache';
import type { CONTENT_STATUS } from '@codex/constants';
import {
  combineSubjects,
  presentedSessionSubject,
  rateLimit,
  trustedIpSubject,
} from '@codex/security';
import {
  adminActivityQuerySchema,
  adminContentIdParamsSchema,
  adminContentListQuerySchema,
  adminContentPerformanceQuerySchema,
  adminCustomerGrantsQuerySchema,
  adminCustomerIdParamsSchema,
  adminCustomerListQuerySchema,
  adminDashboardStatsQuerySchema,
  adminFollowersQuerySchema,
  adminGrantAccessParamsSchema,
  adminRevenueByCreatorQuerySchema,
  adminRevenueQuerySchema,
  adminRevokeGrantParamsSchema,
  adminSubscribersQuerySchema,
  adminTopContentQuerySchema,
  createIdParamsSchema,
  feeAuditLogQuerySchema,
  feeChangeIdParamsSchema,
  orgCreatorParamsSchema,
  orgIdParamsSchema,
  reassignOwnerSchema,
  supportChargeParamsSchema,
  supportChargeSearchQuerySchema,
  supportClosePriceMoveSchema,
  supportCreditIdParamsSchema,
  supportFeeNoticeIdParamsSchema,
  supportIssueRefundSchema,
  supportPriceChangeIdParamsSchema,
  supportPriceMoveIdParamsSchema,
  supportQueueQuerySchema,
  supportRefundIdParamsSchema,
  supportRefundPreviewQuerySchema,
  supportResolveCreatorDebtSchema,
  supportResolveCreditSchema,
  supportResolveFailedRefundSchema,
  supportReviewIdParamsSchema,
  supportToldAnotherWaySchema,
  updateOrgFeesSchema,
  updatePlatformFeesSchema,
  upsertCreatorOverrideSchema,
} from '@codex/validation';
import {
  createKvCheck,
  createWorker,
  invalidateMemberCaches,
  PaginatedResult,
  procedure,
  standardDatabaseCheck,
} from '@codex/worker-utils';
import type { AdminApiEnv } from './types';

// ============================================================================
// Application Setup
// ============================================================================

/**
 * Create worker with standard middleware
 *
 * Configuration:
 * - enableGlobalAuth: false (admin routes use org management policy)
 * - healthCheck: database and KV checks
 */
const app = createWorker<AdminApiEnv>({
  serviceName: 'admin-api',
  version: '1.0.0',
  enableGlobalAuth: false,
  healthCheck: {
    checkDatabase: standardDatabaseCheck,
    // RATE_LIMIT_KV is gone: the limiter below counts in RATE_LIMIT_API.
    checkKV: createKvCheck(['AUTH_SESSION_KV']),
  },
});

// ============================================================================
// Custom Middleware
// ============================================================================

/**
 * Rate limiting for all API endpoints (100 req/min, `api` preset).
 *
 * Two buckets, either of which can block:
 *   - the presented session (`presentedSessionSubject`, which reads the
 *     forwarded cookie because `sessionSubject()` needs `c.get('user')` and
 *     this mount runs before procedure() populates it), covering the
 *     legitimate path — apps/web calls admin-api server-side, so the transport
 *     address is a Cloudflare egress address and NOT the operator's;
 *   - the client address, which covers a direct hit on the public
 *     admin-api.revelations.studio custom domain, where it genuinely is the
 *     caller's.
 * Keying on the address alone is what collapsed every operator into one shared
 * 100-per-minute bucket (Codex-kgrdp.16); counting in the native binding is
 * what takes the KV read+write off every admin call (Codex-kgrdp.17).
 */
app.use('/api/*', (c, next) => {
  const { RATE_LIMIT_API } = c.env;

  return rateLimit({
    preset: 'api',
    binding: RATE_LIMIT_API,
    subject: combineSubjects(presentedSessionSubject(), trustedIpSubject()),
  })(c, next);
});

// ============================================================================
// Analytics Endpoints
// ============================================================================

/**
 * GET /api/admin/analytics/revenue
 * Get revenue statistics for the platform owner's organization
 */
app.get(
  '/api/admin/analytics/revenue',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { query: adminRevenueQuerySchema },
    handler: async (ctx) => {
      return await ctx.services.adminAnalytics.getRevenueStats(
        ctx.organizationId,
        ctx.input.query
      );
    },
  })
);

/**
 * GET /api/admin/analytics/customers
 * Get customer statistics for the platform owner's organization
 */
app.get(
  '/api/admin/analytics/customers',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    handler: async (ctx) => {
      return await ctx.services.adminAnalytics.getCustomerStats(
        ctx.organizationId
      );
    },
  })
);

/**
 * GET /api/admin/analytics/top-content
 * Get top content by revenue for the platform owner's organization
 */
app.get(
  '/api/admin/analytics/top-content',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { query: adminTopContentQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.adminAnalytics.getTopContent(
        ctx.organizationId,
        ctx.input.query
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * GET /api/admin/analytics/subscribers
 * Get subscriber statistics (active/new/churned + daily breakdown)
 * for the platform owner's organization. Supports optional main date range
 * and optional compare-period for period-over-period KPIs.
 */
app.get(
  '/api/admin/analytics/subscribers',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { query: adminSubscribersQuerySchema },
    handler: async (ctx) => {
      return await ctx.services.adminAnalytics.getSubscriberStats(
        ctx.organizationId,
        ctx.input.query
      );
    },
  })
);

/**
 * GET /api/admin/analytics/followers
 * Get follower statistics (total/new + daily breakdown) for the platform
 * owner's organization. Supports optional main date range and optional
 * compare-period for period-over-period KPIs.
 */
app.get(
  '/api/admin/analytics/followers',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { query: adminFollowersQuerySchema },
    handler: async (ctx) => {
      return await ctx.services.adminAnalytics.getFollowerStats(
        ctx.organizationId,
        ctx.input.query
      );
    },
  })
);

/**
 * GET /api/admin/analytics/revenue-by-creator
 * Studio > Analytics "Revenue by creator" (Codex-mtv05; Codex-zsh2p).
 *
 * Returns one row per CREATOR who holds an active agreement in the
 * organisation, earned in the window, or is still owed money by it:
 * earnedCents (their cut of every kind from the payouts ledger, sent or not,
 * after refunds), subscriptionShare and salesShare (`none`, `unreadable` or a
 * display percentage, never basis points), lastPayoutAt, and
 * pendingPayoutCents (money owed them and not yet sent: pending and failed
 * rows, held ones included, less partial refunds).
 *
 * The UI shows the section when more than one creator is listed; this
 * endpoint returns the same shape regardless.
 */
app.get(
  '/api/admin/analytics/revenue-by-creator',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { query: adminRevenueByCreatorQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.adminAnalytics.getRevenueByCreator(
        ctx.organizationId,
        ctx.input.query
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * GET /api/admin/analytics/content-performance
 * Get content performance ranked by watch time, with optional main date
 * range and optional compare-period for per-row trend deltas.
 */
app.get(
  '/api/admin/analytics/content-performance',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { query: adminContentPerformanceQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.adminAnalytics.getContentPerformance(
        ctx.organizationId,
        ctx.input.query
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * GET /api/admin/analytics/dashboard-stats
 * Get combined dashboard statistics for platform owner's organization
 */
app.get(
  '/api/admin/analytics/dashboard-stats',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { query: adminDashboardStatsQuerySchema },
    handler: async (ctx) => {
      return await ctx.services.adminAnalytics.getDashboardStats(
        ctx.organizationId,
        ctx.input.query
      );
    },
  })
);

/**
 * GET /api/admin/activity
 * Get recent activity feed for the platform owner's organization
 * Returns purchases, content published, and member joined events
 */
app.get(
  '/api/admin/activity',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { query: adminActivityQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.adminAnalytics.getRecentActivity(
        ctx.organizationId,
        ctx.input.query
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

// ============================================================================
// Content Management Endpoints
// ============================================================================

/**
 * GET /api/admin/content
 * List all content in the platform owner's organization
 */
app.get(
  '/api/admin/content',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { query: adminContentListQuerySchema },
    handler: async (ctx) => {
      // Map 'all' status to undefined for service layer
      const statusFilter =
        ctx.input.query.status === 'all' ? undefined : ctx.input.query.status;

      const result = await ctx.services.adminContent.listAllContent(
        ctx.organizationId,
        {
          page: ctx.input.query.page,
          limit: ctx.input.query.limit,
          status: statusFilter as
            | typeof CONTENT_STATUS.DRAFT
            | typeof CONTENT_STATUS.PUBLISHED
            | typeof CONTENT_STATUS.ARCHIVED
            | undefined,
        }
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * POST /api/admin/content/:contentId/publish
 * Publish content (admin override).
 * URL slot is :contentId (not :id) so the procedure org-resolver doesn't
 * mistake the content UUID for an org id (Codex-mrvid). Org context flows
 * via ?organizationId= query param.
 */
app.post(
  '/api/admin/content/:contentId/publish',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { params: adminContentIdParamsSchema },
    handler: async (ctx) => {
      return await ctx.services.adminContent.publishContent(
        ctx.organizationId,
        ctx.input.params.contentId
      );
    },
  })
);

/**
 * POST /api/admin/content/:contentId/unpublish
 * Unpublish content (admin override). See publish handler for URL slot rationale.
 */
app.post(
  '/api/admin/content/:contentId/unpublish',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { params: adminContentIdParamsSchema },
    handler: async (ctx) => {
      return await ctx.services.adminContent.unpublishContent(
        ctx.organizationId,
        ctx.input.params.contentId
      );
    },
  })
);

/**
 * DELETE /api/admin/content/:contentId
 * Soft delete content (admin override). See publish handler for URL slot rationale.
 */
app.delete(
  '/api/admin/content/:contentId',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { params: adminContentIdParamsSchema },
    successStatus: 204,
    handler: async (ctx) => {
      await ctx.services.adminContent.deleteContent(
        ctx.organizationId,
        ctx.input.params.contentId
      );
      return null;
    },
  })
);

// ============================================================================
// Customer Management Endpoints
// ============================================================================

/**
 * GET /api/admin/customers
 * List customers who have purchased from the organization
 */
app.get(
  '/api/admin/customers',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { query: adminCustomerListQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.adminCustomer.listCustomers(
        ctx.organizationId,
        ctx.input.query
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * GET /api/admin/customers/:customerId
 * Get customer details with purchase history
 *
 * The slot is `:customerId`, not `:id`: procedure()'s org resolver consumes a
 * bare `:id` as the organization id, so this route used to resolve the
 * CUSTOMER as the org — 403 for org admins (not a member of "org <customerId>")
 * and 404 for platform owners. The URL shape is unchanged, so no caller moves.
 */
app.get(
  '/api/admin/customers/:customerId',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { params: adminCustomerIdParamsSchema },
    handler: async (ctx) => {
      return await ctx.services.adminCustomer.getCustomerDetails(
        ctx.organizationId,
        ctx.input.params.customerId
      );
    },
  })
);

/**
 * POST /api/admin/customers/:customerId/grant-access/:contentId
 * Grant complimentary content access (for refunds/support)
 *
 * Writes a `grant` entitlement recording the acting user; a re-grant is a
 * no-op. Rules: docs/payments/access.md#support-grants.
 */
app.post(
  '/api/admin/customers/:customerId/grant-access/:contentId',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { params: adminGrantAccessParamsSchema },
    handler: async (ctx) => {
      const { customerId, contentId } = ctx.input.params;
      await ctx.services.adminCustomer.grantContentAccess(
        ctx.organizationId,
        customerId,
        contentId,
        ctx.user.id
      );
      // The item joins the customer's library shelf. The access decision
      // itself is read live, so nothing else is cached.
      invalidateUserLibrary({
        kv: ctx.env.CACHE_KV,
        waitUntil: ctx.executionCtx.waitUntil.bind(ctx.executionCtx),
        userId: customerId,
        logger: ctx.obs,
      });
      return { success: true };
    },
  })
);

/**
 * GET /api/admin/customers/:customerId/grants
 * This organization's support grants for the customer, newest first, live and
 * revoked (the drawer's audit trail). Not cached: a support view must be
 * current.
 */
app.get(
  '/api/admin/customers/:customerId/grants',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: {
      params: adminCustomerIdParamsSchema,
      query: adminCustomerGrantsQuerySchema,
    },
    handler: async (ctx) => {
      const result = await ctx.services.adminCustomer.listCustomerGrants(
        ctx.organizationId,
        ctx.input.params.customerId,
        ctx.input.query
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * DELETE /api/admin/customers/:customerId/grants/:entitlementId
 * Revoke one support grant. 404 unless it is this organization's `grant` for
 * this customer; 204 when revoked, and again when it already was.
 *
 * It does NOT write the org-wide `revoked:user:` streaming block — that would
 * also cut the customer off from everything else they hold here. A stream URL
 * already issued plays out its expiry. No email: support tells the customer.
 */
app.delete(
  '/api/admin/customers/:customerId/grants/:entitlementId',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { params: adminRevokeGrantParamsSchema },
    successStatus: 204,
    handler: async (ctx) => {
      const { customerId, entitlementId } = ctx.input.params;
      const { revoked } = await ctx.services.adminCustomer.revokeGrant(
        ctx.organizationId,
        customerId,
        entitlementId,
        ctx.user.id
      );
      if (revoked) {
        // The item leaves the customer's library shelf.
        invalidateUserLibrary({
          kv: ctx.env.CACHE_KV,
          waitUntil: ctx.executionCtx.waitUntil.bind(ctx.executionCtx),
          userId: customerId,
          logger: ctx.obs,
        });
      }
      return null;
    },
  })
);

// ============================================================================
// Fee Configuration Endpoints (Codex-m644n, Codex-2hxff.33) — INTERNAL
//
// 3-tier DB-configurable fee model: platform → org → creator-override.
// All routes are gated by `policy: { auth: 'platform_owner' }` — they are NOT
// safe for org-admin consumption (the platform's revenue model lives here).
//
// IMPORTANT: These endpoints are NOT public. They are not described in any
// public OpenAPI document and there is no SvelteKit/web UI that consumes
// them today. The future local desktop admin app (epic Codex-xyb7v) is the
// planned consumer; until it ships, admin tooling on a trusted local machine
// calls them. They are the ONLY way a fee changes: never edit the fee tables
// with SQL (docs/payments/operations.md). A SQL edit skips the notice a rise
// needs, and the dated history every sale is split by.
//
// Every write is a dated change (Codex-2hxff.33): a cut applies at once; a
// rise waits until everyone it pays less has been emailed (notifications-api's
// daily fee step), then 30 days. The write, its audit rows and the old
// current-row table kept in step are one transaction, and the answer carries
// the `change` it made (null when nothing changed). Each write invalidates
// the level's fee cache; a level with a rise waiting is cached for an hour,
// because the daily step that dates it can't invalidate it.
// ============================================================================

app.get(
  '/api/admin/fees/platform',
  procedure({
    policy: { auth: 'platform_owner' },
    handler: async (ctx) => {
      const row = await ctx.services.feeConfig.getPlatformRow();
      return { config: row };
    },
  })
);

app.patch(
  '/api/admin/fees/platform',
  procedure({
    policy: { auth: 'platform_owner' },
    input: { body: updatePlatformFeesSchema },
    handler: async (ctx) => {
      const { change } = await ctx.services.feeConfig.updatePlatformFees(
        ctx.input.body,
        ctx.user.id
      );
      const row = await ctx.services.feeConfig.getPlatformRow();
      return { config: row, change };
    },
  })
);

app.get(
  '/api/admin/fees/org/:orgId',
  procedure({
    policy: { auth: 'platform_owner' },
    input: { params: orgIdParamsSchema },
    handler: async (ctx) => {
      const row = await ctx.services.feeConfig.getOrgRow(
        ctx.input.params.orgId
      );
      return { config: row };
    },
  })
);

app.patch(
  '/api/admin/fees/org/:orgId',
  procedure({
    policy: { auth: 'platform_owner' },
    input: { params: orgIdParamsSchema, body: updateOrgFeesSchema },
    handler: async (ctx) => {
      const { change } = await ctx.services.feeConfig.updateOrgFees(
        ctx.input.params.orgId,
        ctx.input.body,
        ctx.user.id
      );
      const row = await ctx.services.feeConfig.getOrgRow(
        ctx.input.params.orgId
      );
      return { config: row, change };
    },
  })
);

/**
 * Removing the organisation's fees is a change like any other: taking away a
 * lower fee is a rise, and waits. So it answers 200 with the `change` (and
 * the row still in force meanwhile), not 204.
 */
app.delete(
  '/api/admin/fees/org/:orgId',
  procedure({
    policy: { auth: 'platform_owner' },
    input: { params: orgIdParamsSchema },
    handler: async (ctx) => {
      const { change } = await ctx.services.feeConfig.deleteOrgFees(
        ctx.input.params.orgId,
        ctx.user.id
      );
      const row = await ctx.services.feeConfig.getOrgRow(
        ctx.input.params.orgId
      );
      return { config: row, change };
    },
  })
);

app.get(
  '/api/admin/fees/org/:orgId/creators',
  procedure({
    policy: { auth: 'platform_owner' },
    input: { params: orgIdParamsSchema },
    handler: async (ctx) => {
      const rows = await ctx.services.feeConfig.listCreatorOverrides(
        ctx.input.params.orgId
      );
      return { overrides: rows };
    },
  })
);

app.get(
  '/api/admin/fees/org/:orgId/creator/:creatorId',
  procedure({
    policy: { auth: 'platform_owner' },
    input: { params: orgCreatorParamsSchema },
    handler: async (ctx) => {
      const row = await ctx.services.feeConfig.getCreatorOverrideRow(
        ctx.input.params.orgId,
        ctx.input.params.creatorId
      );
      return { override: row };
    },
  })
);

app.put(
  '/api/admin/fees/org/:orgId/creator/:creatorId',
  procedure({
    policy: { auth: 'platform_owner' },
    input: {
      params: orgCreatorParamsSchema,
      body: upsertCreatorOverrideSchema,
    },
    handler: async (ctx) => {
      const { change } = await ctx.services.feeConfig.upsertCreatorOverride(
        ctx.input.params.orgId,
        ctx.input.params.creatorId,
        ctx.input.body,
        ctx.user.id
      );
      const row = await ctx.services.feeConfig.getCreatorOverrideRow(
        ctx.input.params.orgId,
        ctx.input.params.creatorId
      );
      return { override: row, change };
    },
  })
);

/** As the organisation's removal: 200 with the `change`, not 204. */
app.delete(
  '/api/admin/fees/org/:orgId/creator/:creatorId',
  procedure({
    policy: { auth: 'platform_owner' },
    input: { params: orgCreatorParamsSchema },
    handler: async (ctx) => {
      const { change } = await ctx.services.feeConfig.deleteCreatorOverride(
        ctx.input.params.orgId,
        ctx.input.params.creatorId,
        ctx.user.id
      );
      const row = await ctx.services.feeConfig.getCreatorOverrideRow(
        ctx.input.params.orgId,
        ctx.input.params.creatorId
      );
      return { override: row, change };
    },
  })
);

app.get(
  '/api/admin/fees/audit-log',
  procedure({
    policy: { auth: 'platform_owner' },
    input: { query: feeAuditLogQuerySchema },
    handler: async (ctx) => {
      const entries = await ctx.services.feeConfig.getAuditLog(ctx.input.query);
      return { entries };
    },
  })
);

/**
 * POST /api/admin/fees/changes/:changeId/cancel — call off a fee rise that
 * hasn't started. Everyone already told is emailed that it's off, by the
 * next daily run (F2). 409 FEE_CHANGE_NOT_WAITING once it has started, or
 * was cancelled or replaced.
 */
app.post(
  '/api/admin/fees/changes/:changeId/cancel',
  procedure({
    policy: { auth: 'platform_owner', rateLimit: 'strict' },
    input: { params: feeChangeIdParamsSchema },
    handler: async (ctx) => {
      return await ctx.services.feeConfig.cancelChange(
        ctx.input.params.changeId,
        ctx.user.id
      );
    },
  })
);

// ============================================================================
// Organisation ownership — support (Codex-2hxff.2) — INTERNAL
//
// When a transfer is impossible (the owner is unreachable), platform support
// assigns a new owner. No screen yet; the desktop admin app (Codex-xyb7v) is
// the planned consumer. The new owner must be an active admin or creator; any
// open offer is withdrawn (`support_reassigned`); the previous owner becomes an
// admin, and the team is emailed as for an accepted transfer.
// ============================================================================

app.post(
  '/api/admin/organizations/:orgId/owner',
  procedure({
    policy: { auth: 'platform_owner', rateLimit: 'strict' },
    input: { params: orgIdParamsSchema, body: reassignOwnerSchema },
    handler: async (ctx) => {
      const orgId = ctx.input.params.orgId;
      const change = await ctx.services.organization.reassignOwner(
        orgId,
        ctx.input.body.userId
      );
      // Free text from support, logged for the audit trail. Never PII.
      ctx.obs?.info('Organisation owner reassigned by support', {
        organizationId: orgId,
        newOwnerUserId: change.ownerUserId,
        previousOwnerUserId: change.previousOwnerUserId,
        heldPayoutsReleased: change.heldPayoutsReleased,
        actorUserId: ctx.user.id,
        reason: ctx.input.body.reason,
      });

      // Both users' roles changed. Bust what organization-api's accept path
      // busts for each: the membership entry the policy reads (deleted — a
      // version bump would be dead), the org's slug-keyed public caches and
      // the user's library. One shared helper, so the two cannot drift again
      // (Codex-2hxff.44).
      for (const userId of [change.ownerUserId, change.previousOwnerUserId]) {
        if (!userId) continue;
        invalidateMemberCaches(ctx, orgId, userId, ctx.obs);
      }
      return change;
    },
  })
);

// ============================================================================
// Support refunds (Codex-2hxff.28) — platform support only
//
// The /admin pages in apps/web: find a charge, see its split and what was
// taken back, refund it in full or in part inside the 14-day window, and
// settle the queue of failed refunds and creator debts. Design:
// docs/handover/phase3-sources/support-refunds/data-design.md (owner
// decisions 2026-10-24).
//
// Every route is `platform_owner` with no org policy: these reads are
// platform-wide on purpose, and the scope is the charge. `cache: 'fresh'`:
// every number changes with a refund, a webhook or a payout run, and support
// must see it now, so nothing here is cached. Reads take the default `api`
// preset; writes take `strict` (RATE_LIMIT_STRICT, already bound).
// ============================================================================

/**
 * GET /api/admin/support/charges?lookup=
 * Charges found by an exact key: an email, a purchase or subscription id, or
 * a Stripe `sub_`, `pi_`, `ch_` or `py_` id. Anything else finds nothing.
 */
app.get(
  '/api/admin/support/charges',
  procedure({
    policy: { auth: 'platform_owner', cache: 'fresh' },
    input: { query: supportChargeSearchQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.support.searchCharges(ctx.input.query);
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * GET /api/admin/support/charges/:chargeId
 * The charge, its split with each slice's history, its refunds and
 * chargebacks, the window and what is left to refund: one answer, so the
 * form never works from half-loaded data.
 */
app.get(
  '/api/admin/support/charges/:chargeId',
  procedure({
    policy: { auth: 'platform_owner', cache: 'fresh' },
    input: { params: supportChargeParamsSchema },
    handler: async (ctx) => {
      return await ctx.services.support.getChargeDetail(
        ctx.input.params.chargeId
      );
    },
  })
);

/**
 * GET /api/admin/support/charges/:chargeId/refund-preview?amountCents=
 * What a refund of that amount takes from each slice, worked out by the
 * clawback engine's own rules. Writes nothing.
 */
app.get(
  '/api/admin/support/charges/:chargeId/refund-preview',
  procedure({
    policy: { auth: 'platform_owner', cache: 'fresh' },
    input: {
      params: supportChargeParamsSchema,
      query: supportRefundPreviewQuerySchema,
    },
    handler: async (ctx) => {
      return await ctx.services.support.previewRefund(
        ctx.input.params.chargeId,
        ctx.input.query.amountCents
      );
    },
  })
);

/**
 * POST /api/admin/support/charges/:chargeId/refunds
 * Refund the charge. 200, not 201: a repeat of the same submit creates
 * nothing and answers `replayed: true`. Nothing is written here; the
 * `charge.refunded` webhook records the refund and claws back the shares.
 */
app.post(
  '/api/admin/support/charges/:chargeId/refunds',
  procedure({
    policy: { auth: 'platform_owner', cache: 'fresh', rateLimit: 'strict' },
    input: {
      params: supportChargeParamsSchema,
      body: supportIssueRefundSchema,
    },
    handler: async (ctx) => {
      return await ctx.services.support.issueRefund(
        ctx.input.params.chargeId,
        ctx.input.body,
        ctx.user.id
      );
    },
  })
);

/** GET /api/admin/support/queue/counts — the nav badge. */
app.get(
  '/api/admin/support/queue/counts',
  procedure({
    policy: { auth: 'platform_owner', cache: 'fresh' },
    handler: async (ctx) => {
      return await ctx.services.support.getQueueCounts();
    },
  })
);

/** GET /api/admin/support/queue/failed-refunds — oldest first. */
app.get(
  '/api/admin/support/queue/failed-refunds',
  procedure({
    policy: { auth: 'platform_owner', cache: 'fresh' },
    input: { query: supportQueueQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.support.listFailedRefunds(
        ctx.input.query
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * GET /api/admin/support/queue/creator-debts — one row per person, oldest
 * first, with each person's live Stripe balance (Codex-2hxff.73, .30).
 */
app.get(
  '/api/admin/support/queue/creator-debts',
  procedure({
    policy: { auth: 'platform_owner', cache: 'fresh' },
    input: { query: supportQueueQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.support.listCreatorDebts(
        ctx.input.query
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * GET /api/admin/support/queue/owed-to-creators — late take-backs owed back
 * to payees, oldest first (Codex-2hxff.73).
 */
app.get(
  '/api/admin/support/queue/owed-to-creators',
  procedure({
    policy: { auth: 'platform_owner', cache: 'fresh' },
    input: { query: supportQueueQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.support.listOwedToCreators(
        ctx.input.query
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * GET /api/admin/support/queue/fee-changes — fee rises that haven't started,
 * oldest first, with how many are told (Codex-2hxff.33). Each stays until
 * its date, so the date is always visible somewhere.
 */
app.get(
  '/api/admin/support/queue/fee-changes',
  procedure({
    policy: { auth: 'platform_owner', cache: 'fresh' },
    input: { query: supportQueueQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.support.listFeeChanges(ctx.input.query);
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * GET /api/admin/support/queue/fee-notices — the people a fee rise is
 * waiting for: their email failed or may not have gone. Joiners too, flagged.
 */
app.get(
  '/api/admin/support/queue/fee-notices',
  procedure({
    policy: { auth: 'platform_owner', cache: 'fresh' },
    input: { query: supportQueueQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.support.listFeeNotices(ctx.input.query);
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * POST /api/admin/support/fee-notices/:noticeId/told-another-way — support
 * told the person another way (a note is required). Dates the rise when they
 * were the last on its list. 409 FEE_CHANGE_NOT_WAITING,
 * FEE_NOTICE_ALREADY_TOLD (a second press reads as done) or
 * FEE_NOTICE_NOT_NEEDED.
 */
app.post(
  '/api/admin/support/fee-notices/:noticeId/told-another-way',
  procedure({
    policy: { auth: 'platform_owner', cache: 'fresh', rateLimit: 'strict' },
    input: {
      params: supportFeeNoticeIdParamsSchema,
      body: supportToldAnotherWaySchema,
    },
    handler: async (ctx) => {
      return await ctx.services.support.markToldAnotherWay(
        ctx.input.params.noticeId,
        ctx.input.body,
        ctx.user.id
      );
    },
  })
);

// Queue › Price moves (Codex-2hxff.85, .86). Every action is a database flip
// that ecom-api's next hourly run acts on: this worker has no worker secret to
// send an email, and only a refund-restricted Stripe key.

/**
 * GET /api/admin/support/queue/price-moves — subscribers held from a new
 * price after their automatic tries, and those Retry queued until the run
 * takes them, oldest first.
 */
app.get(
  '/api/admin/support/queue/price-moves',
  procedure({
    policy: { auth: 'platform_owner', cache: 'fresh' },
    input: { query: supportQueueQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.support.listHeldPriceMoves(
        ctx.input.query
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * GET /api/admin/support/queue/price-changes-stopped — price changes the run
 * stopped because every email in the first batch was refused.
 */
app.get(
  '/api/admin/support/queue/price-changes-stopped',
  procedure({
    policy: { auth: 'platform_owner', cache: 'fresh' },
    input: { query: supportQueueQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.support.listStoppedPriceChanges(
        ctx.input.query
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * POST /api/admin/support/price-moves/:moveId/retry — queue a held move for
 * the next run: the email again if none was accepted, or else the Stripe
 * write only, with no second email (Q5). No body. 409 PRICE_MOVE_NOT_HELD,
 * with `details.reason`.
 */
app.post(
  '/api/admin/support/price-moves/:moveId/retry',
  procedure({
    policy: { auth: 'platform_owner', cache: 'fresh', rateLimit: 'strict' },
    input: { params: supportPriceMoveIdParamsSchema },
    handler: async (ctx) => {
      return await ctx.services.support.retryPriceMove(
        ctx.input.params.moveId,
        ctx.user.id
      );
    },
  })
);

/**
 * POST /api/admin/support/price-moves/:moveId/close — take a held move off
 * the list without a retry (moved by hand, or not needed), with a note. It
 * moves nobody. 409 PRICE_MOVE_NOT_HELD.
 */
app.post(
  '/api/admin/support/price-moves/:moveId/close',
  procedure({
    policy: { auth: 'platform_owner', cache: 'fresh', rateLimit: 'strict' },
    input: {
      params: supportPriceMoveIdParamsSchema,
      body: supportClosePriceMoveSchema,
    },
    handler: async (ctx) => {
      return await ctx.services.support.closePriceMove(
        ctx.input.params.moveId,
        ctx.input.body,
        ctx.user.id
      );
    },
  })
);

/**
 * POST /api/admin/support/price-changes/:changeId/restart — after the cause
 * is fixed, the next run sets the change running again (Q6). No body. 409
 * PRICE_CHANGE_NOT_STOPPED.
 */
app.post(
  '/api/admin/support/price-changes/:changeId/restart',
  procedure({
    policy: { auth: 'platform_owner', cache: 'fresh', rateLimit: 'strict' },
    input: { params: supportPriceChangeIdParamsSchema },
    handler: async (ctx) => {
      return await ctx.services.support.restartPriceChange(
        ctx.input.params.changeId,
        ctx.user.id
      );
    },
  })
);

/**
 * POST /api/admin/support/refunds/:refundId/resolve
 * Settle a failed refund: `refunded_elsewhere`, or `creators_repaid` (with a
 * note), which pays back what its clawback took and, for a failed full
 * purchase refund, gives the buyer access back.
 */
app.post(
  '/api/admin/support/refunds/:refundId/resolve',
  procedure({
    policy: { auth: 'platform_owner', cache: 'fresh', rateLimit: 'strict' },
    input: {
      params: supportRefundIdParamsSchema,
      body: supportResolveFailedRefundSchema,
    },
    handler: async (ctx) => {
      const { settled, restoredAccess } =
        await ctx.services.support.resolveFailedRefund(
          ctx.input.params.refundId,
          ctx.input.body,
          ctx.user.id
        );
      if (restoredAccess) {
        // The item is back on the buyer's library shelf, as after a grant.
        invalidateUserLibrary({
          kv: ctx.env.CACHE_KV,
          waitUntil: ctx.executionCtx.waitUntil.bind(ctx.executionCtx),
          userId: restoredAccess.userId,
          logger: ctx.obs,
        });
        // As a won dispute's restore does. The stream endpoint still checks
        // access before it signs, so a clear never grants anything; it only
        // lets the restored item stream before a block's TTL runs out.
        const kv = ctx.env.CACHE_KV;
        const { organizationId, userId } = restoredAccess;
        if (kv && organizationId) {
          ctx.executionCtx.waitUntil(
            new AccessRevocation(kv, ctx.obs)
              .clear(userId, organizationId)
              .catch((error: unknown) => {
                ctx.obs?.warn('support: AccessRevocation.clear failed', {
                  userId,
                  organizationId,
                  error: error instanceof Error ? error.message : String(error),
                });
              })
          );
        }
      }
      return settled;
    },
  })
);

/**
 * POST /api/admin/support/creator-debts/:reviewId/resolve
 * Settle a creator debt. `dispute_won` is never accepted: the won-chargeback
 * code writes it, with its re-pay.
 */
app.post(
  '/api/admin/support/creator-debts/:reviewId/resolve',
  procedure({
    policy: { auth: 'platform_owner', cache: 'fresh', rateLimit: 'strict' },
    input: {
      params: supportReviewIdParamsSchema,
      body: supportResolveCreatorDebtSchema,
    },
    handler: async (ctx) => {
      return await ctx.services.support.resolveCreatorDebt(
        ctx.input.params.reviewId,
        ctx.input.body,
        ctx.user.id
      );
    },
  })
);

/**
 * POST /api/admin/support/owed-to-creators/:creditId/resolve
 * Settle a late take-back: Re-pay what Stripe took (a pending re-pay payout
 * the next run pays), count it against the share's own open debt, or mark it
 * not owed (with a note).
 */
app.post(
  '/api/admin/support/owed-to-creators/:creditId/resolve',
  procedure({
    policy: { auth: 'platform_owner', cache: 'fresh', rateLimit: 'strict' },
    input: {
      params: supportCreditIdParamsSchema,
      body: supportResolveCreditSchema,
    },
    handler: async (ctx) => {
      return await ctx.services.support.resolveOwedToCreator(
        ctx.input.params.creditId,
        ctx.input.body,
        ctx.user.id
      );
    },
  })
);

/**
 * POST /api/admin/support/owed-to-creators/:creditId/check
 * "Check Stripe again" on a row Stripe never answered for: one look, no body.
 */
app.post(
  '/api/admin/support/owed-to-creators/:creditId/check',
  procedure({
    policy: { auth: 'platform_owner', cache: 'fresh', rateLimit: 'strict' },
    input: { params: supportCreditIdParamsSchema },
    handler: async (ctx) => {
      return await ctx.services.support.checkOwedToCreator(
        ctx.input.params.creditId
      );
    },
  })
);

// ============================================================================
// Media restore (Codex-6sbn1) — support only, no screen
//
// A creator's media delete keeps the files 30 days ("contact support within 30
// days and we can bring it back"). Support restores the item here, by its id.
// ============================================================================

/**
 * POST /api/admin/media/:id/restore
 * Undo a media delete inside the 30 days. Drafts that used the item heal
 * themselves (they kept the link), and the tile reappears in the creator's
 * open Studio tabs. 409 once the daily purge has claimed the files, for an
 * item deleted before files were kept, or for one that isn't deleted.
 */
app.post(
  '/api/admin/media/:id/restore',
  procedure({
    policy: { auth: 'platform_owner', cache: 'fresh', rateLimit: 'strict' },
    input: { params: createIdParamsSchema() },
    handler: async (ctx) => {
      const media = await ctx.services.media.restore(ctx.input.params.id);
      ctx.obs?.info('Media item restored by support', {
        mediaItemId: media.id,
        actorUserId: ctx.user.id,
      });
      return media;
    },
  })
);

// ============================================================================
// Status Endpoint (for debugging)
// ============================================================================

app.get(
  '/api/admin/status',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    handler: async (ctx) => {
      return {
        status: 'ok',
        message: 'Admin API is operational',
        user: {
          id: ctx.user.id,
          role: ctx.user.role,
        },
      };
    },
  })
);

export default app;
