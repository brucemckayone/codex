/**
 * Stripe Connect Endpoints
 *
 * Manages Connect account onboarding and status. Two route families:
 *
 * Org-scoped (owner/admin, `requireOrgManagement`) — the org's primary account:
 * - POST /connect/onboard    - Create Connect account + return onboarding URL
 * - GET  /connect/status     - Get Connect account status
 * - POST /connect/sync       - Force a Stripe status sync
 * - POST /connect/dashboard  - Get Stripe Express dashboard link
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
  connectDashboardSchema,
  connectMeOnboardSchema,
  connectOnboardSchema,
  connectStatusQuerySchema,
} from '@codex/validation';
import { procedure } from '@codex/worker-utils';
import { Hono } from 'hono';

const app = new Hono<HonoEnv>();

/**
 * POST /connect/onboard
 * Create a Stripe Connect Express account and return the onboarding URL.
 */
app.post(
  '/onboard',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'strict',
    },
    input: { body: connectOnboardSchema },
    successStatus: 201,
    handler: async (ctx) => {
      return await ctx.services.connect.createAccount(
        ctx.input.body.organizationId,
        ctx.user.id,
        ctx.input.body.returnUrl,
        ctx.input.body.refreshUrl
      );
    },
  })
);

/**
 * GET /connect/status
 * Get the Connect account status for an org.
 *
 * Returns the full status payload including Stripe's `requirements`
 * (currently_due, eventually_due, current_deadline, errors). Cached
 * 10 min via VersionedCache; invalidated by `account.updated` webhook.
 */
app.get(
  '/status',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
    },
    input: { query: connectStatusQuerySchema },
    handler: async (ctx) => {
      return await ctx.services.connect.getStatus(
        ctx.input.query.organizationId
      );
    },
  })
);

/**
 * POST /connect/sync
 * Sync Connect account status with Stripe (polls Stripe API).
 * Used when webhooks can't reach the server (local dev) or as a fallback.
 */
app.post(
  '/sync',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'strict',
    },
    input: { body: connectDashboardSchema },
    handler: async (ctx) => {
      const account = await ctx.services.connect.syncAccountStatus(
        ctx.input.body.organizationId,
        ctx.user.id
      );

      if (!account) {
        return {
          isConnected: false,
          accountId: null,
          chargesEnabled: false,
          payoutsEnabled: false,
          status: null,
        };
      }

      return {
        isConnected: true,
        accountId: account.stripeAccountId,
        chargesEnabled: account.chargesEnabled,
        payoutsEnabled: account.payoutsEnabled,
        status: account.status,
      };
    },
  })
);

/**
 * POST /connect/dashboard
 * Get a Stripe Express dashboard login link for the org owner.
 */
app.post(
  '/dashboard',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
    },
    input: { body: connectDashboardSchema },
    handler: async (ctx) => {
      return await ctx.services.connect.createDashboardLink(
        ctx.input.body.organizationId
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
