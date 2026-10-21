/**
 * Sales Routes (studio Sales ledger — Codex-1csms)
 *
 * Org-scoped inverse of /purchases. Powers the /studio/sales page so an org
 * owner can see every sale that landed on their org, including refunds and
 * disputes, plus headline KPI totals for the active date window.
 *
 * Endpoints:
 *   GET /sales           — paginated rows joined with content + customer
 *   GET /sales/stats     — aggregate KPIs (gross / net / refunded / count)
 *   GET /sales/me        — a solo creator's own orgless sales, same rows
 *   GET /sales/me/stats  — the same KPIs for those sales
 *
 * The org routes use `requireOrgManagement` which gates to owner OR admin at the
 * worker layer. The /studio/sales page applies the stricter owner-only gate
 * via a client-side $effect redirect — same pattern as /studio/payouts.
 * Defence-in-depth: even if the UI gate is bypassed, an admin would only see
 * their own org's rows; cross-org leaks remain impossible because the service
 * always re-derives scope from `ctx.organizationId` (set from membership) and
 * ignores any client-supplied `organizationId` beyond URL resolution.
 *
 * The `/me` routes have no organisation: they need only a session, and the
 * service scopes them to orgless purchases of content `ctx.user.id` created
 * (Codex-2hxff.21). The solo creator is the seller, so they see the buyer's
 * name and email, as an organisation owner does.
 *
 * Cache: not version-cached. Sales data mutates on every purchase + refund +
 * dispute webhook — TTL cache would lag, and the studio is auth-gated so KV
 * cache wouldn't help anyway.
 */

import type { HonoEnv } from '@codex/shared-types';
import { salesQuerySchema, salesStatsQuerySchema } from '@codex/validation';
import { PaginatedResult, procedure } from '@codex/worker-utils';
import { Hono } from 'hono';

const sales = new Hono<HonoEnv>();

/**
 * GET /sales
 *
 * Paginated org-scoped sales ledger.
 *
 * Query: ?page=1&limit=20&status=completed&contentId=...&customerId=...
 *        &fromDate=ISO&toDate=ISO&organizationId=UUID
 *
 * `organizationId` in the query string is consumed only by the procedure
 * helper to *resolve* org context; the service receives the authenticated
 * `ctx.organizationId` and ignores any client-supplied value beyond that.
 */
sales.get(
  '/',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: { query: salesQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.purchase.listSales(
        ctx.organizationId,
        ctx.input.query
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * GET /sales/stats
 *
 * Aggregate KPIs for the studio Sales ledger header tiles. Returns gross,
 * net (org share), refundedCents, count, currency for the active date
 * window. No pagination — single row.
 */
sales.get(
  '/stats',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: { query: salesStatsQuerySchema },
    handler: async (ctx) => {
      return await ctx.services.purchase.getSalesStats(
        ctx.organizationId,
        ctx.input.query
      );
    },
  })
);

/**
 * GET /sales/me
 *
 * A solo creator's own sales ledger: their content sold outside any
 * organisation. Same query, filters and `SaleListItem` rows as GET /sales.
 *
 * Query: ?page=1&limit=20&status=completed&contentId=...&customerId=...
 *        &fromDate=ISO&toDate=ISO
 */
sales.get(
  '/me',
  procedure({
    policy: { auth: 'required' },
    input: { query: salesQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.purchase.listMySales(
        ctx.user.id,
        ctx.input.query
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * GET /sales/me/stats
 *
 * The header KPIs for GET /sales/me, in the same shape as GET /sales/stats.
 */
sales.get(
  '/me/stats',
  procedure({
    policy: { auth: 'required' },
    input: { query: salesStatsQuerySchema },
    handler: async (ctx) => {
      return await ctx.services.purchase.getMySalesStats(
        ctx.user.id,
        ctx.input.query
      );
    },
  })
);

export default sales;
