/**
 * Stripe Connect Endpoints
 *
 * Manages Connect account onboarding and status for org owners and creators.
 *
 * Endpoints:
 * - POST /connect/onboard   - Create Connect account + return onboarding URL
 * - GET  /connect/status    - Get Connect account status
 * - POST /connect/dashboard - Get Stripe Express dashboard link
 */

import { createDbClient } from '@codex/database';
import { createStripeClient } from '@codex/purchase';
import type { HonoEnv } from '@codex/shared-types';
import { ConnectAccountService } from '@codex/subscription';
import {
  connectDashboardSchema,
  connectOnboardSchema,
  connectStatusQuerySchema,
} from '@codex/validation';
import { procedure } from '@codex/worker-utils';
import { Hono } from 'hono';

const app = new Hono<HonoEnv>();

function getConnectService(env: HonoEnv['Bindings']): ConnectAccountService {
  const db = createDbClient(env);
  const stripe = createStripeClient(env.STRIPE_SECRET_KEY as string);
  return new ConnectAccountService(
    { db, environment: env.ENVIRONMENT ?? 'development' },
    stripe
  );
}

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
      const service = getConnectService(ctx.env);
      return await service.createAccount(
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
      const service = getConnectService(ctx.env);
      const account = await service.getAccount(ctx.input.query.organizationId);

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
      const service = getConnectService(ctx.env);
      return await service.createDashboardLink(ctx.input.body.organizationId);
    },
  })
);

export default app;
