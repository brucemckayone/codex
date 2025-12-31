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

import type { Purchase, PurchaseWithContent } from '@codex/purchase';
import type { HonoEnv, PaginatedListResponse } from '@codex/shared-types';
import { createIdParamsSchema, purchaseQuerySchema } from '@codex/validation';
import { procedure } from '@codex/worker-utils';
import { Hono } from 'hono';

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
 *   "items": [...purchases with content],
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
  procedure({
    policy: { auth: 'required' },
    input: { query: purchaseQuerySchema },
    handler: async (
      ctx
    ): Promise<PaginatedListResponse<PurchaseWithContent>> => {
      const result = await ctx.services.purchase.getPurchaseHistory(
        ctx.user.id,
        ctx.input.query
      );

      return {
        items: result.items,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / result.limit),
        },
      };
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
  procedure({
    policy: { auth: 'required' },
    input: { params: createIdParamsSchema() },
    handler: async (ctx): Promise<Purchase> => {
      return await ctx.services.purchase.getPurchase(
        ctx.input.params.id,
        ctx.user.id
      );
    },
  })
);

export default purchases;
