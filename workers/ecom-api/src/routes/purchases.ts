/**
 * Purchase Routes
 *
 * Handles purchase listing and retrieval for authenticated customers.
 *
 * Endpoints:
 * - GET /purchases - List customer's purchases with pagination/filters
 * - GET /purchases/:id - Get single purchase by ID
 *
 * Security:
 * - Requires authentication (user must be logged in)
 * - Scoped to customer's own purchases only
 * - Rate limited via standard API preset (100 req/min)
 *
 * Integration:
 * - PurchaseService - Queries purchases from database
 */

import { dbHttp } from '@codex/database';
import {
  createStripeClient,
  type Purchase,
  PurchaseService,
  type PurchaseWithContent,
} from '@codex/purchase';
import type {
  Bindings,
  HonoEnv,
  PaginatedListResponse,
  SingleItemResponse,
} from '@codex/shared-types';
import { createIdParamsSchema, purchaseQuerySchema } from '@codex/validation';
import { createAuthenticatedHandler, withPolicy } from '@codex/worker-utils';
import { Hono } from 'hono';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get Stripe API key from environment with type safety.
 * STRIPE_SECRET_KEY is validated at worker startup via createEnvValidationMiddleware.
 * This helper provides type-safe access after validation.
 */
function getStripeKey(env: Bindings): string {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY not configured');
  }
  return env.STRIPE_SECRET_KEY;
}

// ============================================================================
// Routes
// ============================================================================

const purchases = new Hono<HonoEnv>();

/**
 * GET /purchases
 *
 * List customer's purchases with pagination and filters
 *
 * Query Parameters:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 20, max: 100)
 * - status: Filter by status (completed, refunded, failed)
 * - contentId: Filter by content ID
 *
 * Response (200):
 * {
 *   "data": [...purchases with content],
 *   "pagination": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 }
 * }
 *
 * Security:
 * - Requires authentication
 * - Only returns customer's own purchases
 *
 * Example:
 * GET /purchases?page=1&limit=20&status=completed
 */
purchases.get(
  '/',
  withPolicy({
    auth: 'required',
    rateLimit: 'api', // 100 req/min
  }),
  createAuthenticatedHandler({
    schema: {
      query: purchaseQuerySchema,
    },
    handler: async (_c, ctx) => {
      const stripe = createStripeClient(getStripeKey(ctx.env));

      const purchaseService = new PurchaseService(
        {
          db: dbHttp,
          environment: ctx.env.ENVIRONMENT || 'development',
        },
        stripe
      );

      // Get purchase history for authenticated user
      const result = await purchaseService.getPurchaseHistory(
        ctx.user.id,
        ctx.validated.query
      );

      // Return paginated response
      const response: PaginatedListResponse<PurchaseWithContent> = {
        items: result.items,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / result.limit),
        },
      };

      return response;
    },
  })
);

/**
 * GET /purchases/:id
 *
 * Get single purchase by ID
 *
 * Path Parameters:
 * - id: Purchase UUID
 *
 * Response (200):
 * {
 *   "data": { ...purchase }
 * }
 *
 * Error Responses:
 * - 401 Unauthorized: Not authenticated
 * - 403 Forbidden: Purchase belongs to another customer
 * - 404 Not Found: Purchase doesn't exist
 *
 * Security:
 * - Requires authentication
 * - Verifies purchase belongs to authenticated user
 *
 * Example:
 * GET /purchases/550e8400-e29b-41d4-a716-446655440000
 */
purchases.get(
  '/:id',
  withPolicy({
    auth: 'required',
    rateLimit: 'api', // 100 req/min
  }),
  createAuthenticatedHandler({
    schema: {
      params: createIdParamsSchema(),
    },
    handler: async (_c, ctx) => {
      const stripe = createStripeClient(getStripeKey(ctx.env));

      const purchaseService = new PurchaseService(
        {
          db: dbHttp,
          environment: ctx.env.ENVIRONMENT || 'development',
        },
        stripe
      );

      // Get purchase (throws 404 if not found, 403 if not owner)
      const purchase = await purchaseService.getPurchase(
        ctx.validated.params.id,
        ctx.user.id
      );

      // Return single item response
      const response: SingleItemResponse<Purchase> = {
        data: purchase,
      };

      return response;
    },
  })
);

export default purchases;
