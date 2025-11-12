/**
 * Organization Management Endpoints
 *
 * RESTful API for managing organizations.
 * All routes require authentication.
 *
 * Endpoints:
 * - POST   /api/organizations           - Create organization
 * - GET    /api/organizations/:id       - Get by ID
 * - GET    /api/organizations/slug/:slug - Get by slug
 * - PATCH  /api/organizations/:id       - Update organization
 * - GET    /api/organizations           - List with filters
 * - DELETE /api/organizations/:id       - Soft delete
 * - GET    /api/organizations/check-slug/:slug - Check slug availability
 */

import { Hono } from 'hono';
import type { HonoEnv } from '../types';
import {
  createOrganizationService,
  createOrganizationSchema,
  updateOrganizationSchema,
} from '@codex/identity';
import { dbHttp } from '@codex/database';
import {
  createAuthenticatedHandler,
  createAuthenticatedGetHandler,
} from '@codex/worker-utils';

const app = new Hono<HonoEnv>();

// Note: Authentication is applied at the app level in index.ts
// All routes mounted under /api/* inherit requireAuth middleware

/**
 * POST /api/organizations
 * Create new organization
 *
 * Body: CreateOrganizationInput
 * Returns: Organization (201)
 */
app.post(
  '/',
  createAuthenticatedHandler({
    schema: createOrganizationSchema,
    handler: async (input, c, ctx) => {
      const service = createOrganizationService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });
      return service.create(input);
    },
    successStatus: 201,
  })
);

/**
 * GET /api/organizations/:id
 * Get organization by ID
 *
 * Returns: Organization (200)
 */
app.get(
  '/:id',
  createAuthenticatedGetHandler({
    handler: async (c, ctx) => {
      const id = c.req.param('id');
      const service = createOrganizationService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      const organization = await service.get(id);

      if (!organization) {
        throw {
          code: 'NOT_FOUND',
          message: 'Organization not found',
        };
      }

      return organization;
    },
  })
);

/**
 * GET /api/organizations/slug/:slug
 * Get organization by slug
 *
 * Returns: Organization (200)
 */
app.get(
  '/slug/:slug',
  createAuthenticatedGetHandler({
    handler: async (c, ctx) => {
      const slug = c.req.param('slug');
      const service = createOrganizationService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      const organization = await service.getBySlug(slug);

      if (!organization) {
        throw {
          code: 'NOT_FOUND',
          message: 'Organization not found',
        };
      }

      return organization;
    },
  })
);

/**
 * PATCH /api/organizations/:id
 * Update organization
 *
 * Body: UpdateOrganizationInput
 * Returns: Organization (200)
 */
app.patch(
  '/:id',
  createAuthenticatedHandler({
    schema: updateOrganizationSchema,
    handler: async (input, c, ctx) => {
      const id = c.req.param('id');
      const service = createOrganizationService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });
      return service.update(id, input);
    },
  })
);

/**
 * GET /api/organizations
 * List organizations with filters
 *
 * Query params: search, sortBy, sortOrder, page, limit
 * Returns: PaginatedResponse<Organization> (200)
 */
app.get(
  '/',
  createAuthenticatedGetHandler({
    handler: async (c, ctx) => {
      // Extract query parameters
      const search = c.req.query('search');
      const sortBy = c.req.query('sortBy') as 'createdAt' | 'name' | undefined;
      const sortOrder = c.req.query('sortOrder') as 'asc' | 'desc' | undefined;
      const page = parseInt(c.req.query('page') || '1', 10);
      const limit = parseInt(c.req.query('limit') || '20', 10);

      const service = createOrganizationService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      return service.list(
        {
          search,
          sortBy,
          sortOrder,
        },
        {
          page,
          limit,
        }
      );
    },
  })
);

/**
 * DELETE /api/organizations/:id
 * Soft delete organization
 *
 * Returns: Success message (200)
 */
app.delete(
  '/:id',
  createAuthenticatedGetHandler({
    handler: async (c, ctx) => {
      const id = c.req.param('id');
      const service = createOrganizationService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      await service.delete(id);

      return {
        success: true,
        message: 'Organization deleted successfully',
      };
    },
  })
);

/**
 * GET /api/organizations/check-slug/:slug
 * Check if slug is available
 *
 * Returns: { available: boolean } (200)
 */
app.get(
  '/check-slug/:slug',
  createAuthenticatedGetHandler({
    handler: async (c, ctx) => {
      const slug = c.req.param('slug');
      const service = createOrganizationService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      const available = await service.isSlugAvailable(slug);

      return {
        slug,
        available,
      };
    },
  })
);

export default app;
