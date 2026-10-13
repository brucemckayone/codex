/**
 * Stripe Connect Endpoints
 *
 * Manages Connect account onboarding and status. Only the person who owns a
 * Connect account can act on it (docs/payments/connect-and-payouts.md → The
 * payout dashboard and bank details). The org-level onboard/status/sync/
 * dashboard routes are retired (Codex-2hxff.1).
 *
 * Org-scoped, read-only (`requireOrgMembership`):
 * - GET  /connect/organization-status - The org's payout status, status only
 *
 * Creator-scoped (`/connect/me/*`, `auth: 'required'`, self-scoped to
 * `ctx.user.id`) — one Connect account per user, no org context (Codex-69t7c.3):
 * - POST /connect/me/onboard   - Create/reuse the creator's account + onboarding URL
 * - GET  /connect/me/status    - Get the creator's account status
 * - POST /connect/me/sync      - Force sync, return refreshed status payload
 * - POST /connect/me/dashboard - Get the creator's Express dashboard link
 */

import type { HonoEnv } from '@codex/shared-types';
import {
  connectMeOnboardSchema,
  connectStatusQuerySchema,
} from '@codex/validation';
import { procedure } from '@codex/worker-utils';
import { Hono } from 'hono';

const app = new Hono<HonoEnv>();

/**
 * GET /connect/organization-status?organizationId=
 * The organisation's payout readiness, for any member.
 *
 * Reads the org from `ctx.organizationId` — the org the policy resolved AND
 * checked membership of — never from a client-supplied field. The retired
 * `POST /connect/dashboard` authorised the query org but acted on the body org,
 * which let any org owner/admin open any other org's Express Dashboard
 * (Codex-2hxff.1). Status fields only: no account id, no requirements, no
 * login link — those belong to the account holder, through `/connect/me/*`.
 */
app.get(
  '/organization-status',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
    },
    input: { query: connectStatusQuerySchema },
    handler: async (ctx) => {
      return await ctx.services.connect.getOrganizationPayoutStatus(
        ctx.organizationId
      );
    },
  })
);

// ─────────────────────────────────────────────────────────────────────────
// Creator-scoped routes (/connect/me/*) — Codex-69t7c.3 / WP3
//
// One Stripe Connect account per USER. These routes are self-scoped to
// `ctx.user.id` (never a client-supplied id — IDOR prevention, epic decision
// D8) and carry NO org context, so the policy is `auth: 'required'` only: any
// authenticated creator reaches them, regardless of org membership/management
// role. They consume the userId-centric `*ForUser` service methods (WP2).
// ─────────────────────────────────────────────────────────────────────────

/**
 * POST /connect/me/onboard
 * Create (or reuse) the current creator's Connect account and return the
 * Stripe onboarding URL.
 */
app.post(
  '/me/onboard',
  procedure({
    policy: {
      auth: 'required',
      rateLimit: 'strict',
    },
    input: { body: connectMeOnboardSchema },
    successStatus: 201,
    handler: async (ctx) => {
      return await ctx.services.connect.createAccountForUser(
        ctx.user.id,
        ctx.input.body.returnUrl,
        ctx.input.body.refreshUrl
      );
    },
  })
);

/**
 * GET /connect/me/status
 * Get the current creator's Connect account status (cached 10 min,
 * invalidated by the `account.updated` webhook).
 */
app.get(
  '/me/status',
  procedure({
    policy: {
      auth: 'required',
    },
    handler: async (ctx) => {
      return await ctx.services.connect.getStatusForUser(ctx.user.id);
    },
  })
);

/**
 * POST /connect/me/sync
 * Force a Stripe status sync for the current creator, then return the
 * refreshed status payload (shape parity with GET /connect/me/status). Used by
 * the earnings hub on `?connect=success` return from Stripe onboarding, where
 * the `account.updated` webhook may not yet have landed (e.g. local dev).
 *
 * Note: the returned status is best-effort — a `requirements: null` can mean
 * "no outstanding requirements" OR "the live Stripe read degraded"; surfacing
 * that distinction is tracked in Codex-y2htq.
 */
app.post(
  '/me/sync',
  procedure({
    policy: {
      auth: 'required',
      rateLimit: 'strict',
    },
    handler: async (ctx) => {
      await ctx.services.connect.syncAccountStatusForUser(ctx.user.id);
      return await ctx.services.connect.getStatusForUser(ctx.user.id);
    },
  })
);

/**
 * POST /connect/me/dashboard
 * Get a Stripe Express dashboard login link for the current creator.
 */
app.post(
  '/me/dashboard',
  procedure({
    policy: {
      auth: 'required',
    },
    handler: async (ctx) => {
      return await ctx.services.connect.createDashboardLinkForUser(ctx.user.id);
    },
  })
);

export default app;
