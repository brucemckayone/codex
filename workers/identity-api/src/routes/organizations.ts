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

import { dbHttp } from '@codex/database';
import {
  createOrganizationSchema,
  OrganizationService,
  updateOrganizationSchema,
} from '@codex/identity';
import type {
  CheckSlugResponse,
  CreateOrganizationResponse,
  DeleteOrganizationResponse,
  OrganizationBySlugResponse,
  OrganizationListResponse,
  OrganizationResponse,
  UpdateOrganizationResponse,
} from '@codex/shared-types';
import {
  createSlugSchema,
  organizationQuerySchema,
  uuidSchema,
} from '@codex/validation';
import {
  createAuthenticatedHandler,
  POLICY_PRESETS,
  withPolicy,
} from '@codex/worker-utils';
import { Hono } from 'hono';
import { z } from 'zod';
import type { HonoEnv } from '../types';

const app = new Hono<HonoEnv>();

// Note: Route-level security policies applied via withPolicy()
// Each route declares its own authentication and authorization requirements

/**
 * POST /api/organizations
 * Create new organization
 *
 * Body: CreateOrganizationInput
 * Returns: Organization (201)
 * Security: Authenticated users, API rate limit (100 req/min)
 * @returns {CreateOrganizationResponse}
 */
app.post(
  '/',
  withPolicy(POLICY_PRESETS.authenticated()),
  createAuthenticatedHandler({
    schema: {
      body: createOrganizationSchema,
    },
    handler: async (_c, ctx): Promise<CreateOrganizationResponse> => {
      const service = new OrganizationService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });
      const organization = await service.create(ctx.validated.body);
      return { data: organization };
    },
    successStatus: 201,
  })
);

/**
 * GET /api/organizations/check-slug/:slug
 * Check if slug is available
 *
 * Returns: { available: boolean } (200)
 * Security: Authenticated users, API rate limit (100 req/min)
 * @returns {CheckSlugResponse}
 */
app.get(
  '/check-slug/:slug',
  withPolicy(POLICY_PRESETS.authenticated()),
  createAuthenticatedHandler({
    schema: {
      params: z.object({ slug: createSlugSchema(255) }),
    },
    handler: async (_c, ctx): Promise<CheckSlugResponse> => {
      const service = new OrganizationService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      const available = await service.isSlugAvailable(
        ctx.validated.params.slug
      );

      return { available };
    },
  })
);

/**
 * GET /api/organizations/slug/:slug
 * Get organization by slug
 *
 * Returns: Organization (200)
 * Security: Authenticated users, API rate limit (100 req/min)
 * @returns {OrganizationBySlugResponse}
 */
app.get(
  '/slug/:slug',
  withPolicy(POLICY_PRESETS.authenticated()),
  createAuthenticatedHandler({
    schema: {
      params: z.object({ slug: createSlugSchema(255) }),
    },
    handler: async (_c, ctx): Promise<OrganizationBySlugResponse> => {
      const service = new OrganizationService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      const organization = await service.getBySlug(ctx.validated.params.slug);

      if (!organization) {
        throw {
          code: 'NOT_FOUND',
          message: 'Organization not found',
        };
      }

      return { data: organization };
    },
  })
);

/**
 * GET /api/organizations/:id
 * Get organization by ID
 *
 * Returns: Organization (200)
 * Security: Authenticated users, API rate limit (100 req/min)
 * @returns {OrganizationResponse}
 */
app.get(
  '/:id',
  withPolicy(POLICY_PRESETS.authenticated()),
  createAuthenticatedHandler({
    schema: {
      params: z.object({ id: uuidSchema }),
    },
    handler: async (_c, ctx): Promise<OrganizationResponse> => {
      const service = new OrganizationService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      const organization = await service.get(ctx.validated.params.id);

      if (!organization) {
        throw {
          code: 'NOT_FOUND',
          message: 'Organization not found',
        };
      }

      return { data: organization };
    },
  })
);

/**
 * PATCH /api/organizations/:id
 * Update organization
 *
 * Body: UpdateOrganizationInput
 * Returns: Organization (200)
 * Security: Authenticated users, API rate limit (100 req/min)
 * @returns {UpdateOrganizationResponse}
 */
app.patch(
  '/:id',
  withPolicy(POLICY_PRESETS.authenticated()),
  createAuthenticatedHandler({
    schema: {
      params: z.object({ id: uuidSchema }),
      body: updateOrganizationSchema,
    },
    handler: async (_c, ctx): Promise<UpdateOrganizationResponse> => {
      const service = new OrganizationService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });
      const organization = await service.update(
        ctx.validated.params.id,
        ctx.validated.body
      );
      return { data: organization };
    },
  })
);

/**
 * GET /api/organizations
 * List organizations with filters
 *
 * Query params: search, sortBy, sortOrder, page, limit
 * Returns: PaginatedResponse<Organization> (200)
 * Security: Authenticated users, API rate limit (100 req/min)
 * @returns {OrganizationListResponse}
 */
app.get(
  '/',
  withPolicy(POLICY_PRESETS.authenticated()),
  createAuthenticatedHandler({
    schema: {
      query: organizationQuerySchema,
    },
    handler: async (_c, ctx): Promise<OrganizationListResponse> => {
      const { search, sortBy, sortOrder, page, limit } = ctx.validated.query;

      const service = new OrganizationService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      const result = await service.list(
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

      // Service returns PaginatedResponse<T> which already matches our response type
      return result;
    },
  })
);

/**
 * DELETE /api/organizations/:id
 * Soft delete organization
 *
 * Returns: Success message (200)
 * Security: Authenticated users, Strict rate limit (5 req/15min)
 * @returns {DeleteOrganizationResponse}
 */
app.delete(
  '/:id',
  withPolicy({
    auth: 'required',
    rateLimit: 'auth', // Stricter rate limit for deletion
  }),
  createAuthenticatedHandler({
    schema: {
      params: z.object({ id: uuidSchema }),
    },
    handler: async (_c, ctx): Promise<DeleteOrganizationResponse> => {
      const service = new OrganizationService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      await service.delete(ctx.validated.params.id);

      return {
        success: true,
        message: 'Organization deleted successfully',
      };
    },
  })
);

export default app;
