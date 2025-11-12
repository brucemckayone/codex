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
  mapErrorToResponse,
  createOrganizationSchema,
  updateOrganizationSchema,
  organizationQuerySchema,
} from '@codex/identity';
import { dbHttp } from '@codex/database';

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
app.post('/', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        },
        401
      );
    }

    const body = await c.req.json();

    // Validate request body
    const validationResult = createOrganizationSchema.safeParse(body);
    if (!validationResult.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: validationResult.error.errors.map((err) => ({
              path: err.path.join('.'),
              message: err.message,
            })),
          },
        },
        400
      );
    }

    const service = createOrganizationService({
      db: dbHttp,
      environment: c.env.ENVIRONMENT || 'development',
    });

    const organization = await service.create(validationResult.data);

    return c.json({ data: organization }, 201);
  } catch (err) {
    const { statusCode, response } = mapErrorToResponse(err);
    return c.json(response, statusCode);
  }
});

/**
 * GET /api/organizations/:id
 * Get organization by ID
 *
 * Returns: Organization (200)
 */
app.get('/:id', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        },
        401
      );
    }

    const id = c.req.param('id');

    const service = createOrganizationService({
      db: dbHttp,
      environment: c.env.ENVIRONMENT || 'development',
    });

    const organization = await service.get(id);

    if (!organization) {
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'Organization not found',
          },
        },
        404
      );
    }

    return c.json({ data: organization });
  } catch (err) {
    const { statusCode, response } = mapErrorToResponse(err);
    return c.json(response, statusCode);
  }
});

/**
 * GET /api/organizations/slug/:slug
 * Get organization by slug
 *
 * Returns: Organization (200)
 */
app.get('/slug/:slug', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        },
        401
      );
    }

    const slug = c.req.param('slug');

    const service = createOrganizationService({
      db: dbHttp,
      environment: c.env.ENVIRONMENT || 'development',
    });

    const organization = await service.getBySlug(slug);

    if (!organization) {
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'Organization not found',
          },
        },
        404
      );
    }

    return c.json({ data: organization });
  } catch (err) {
    const { statusCode, response } = mapErrorToResponse(err);
    return c.json(response, statusCode);
  }
});

/**
 * PATCH /api/organizations/:id
 * Update organization
 *
 * Body: UpdateOrganizationInput
 * Returns: Organization (200)
 */
app.patch('/:id', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        },
        401
      );
    }

    const id = c.req.param('id');
    const body = await c.req.json();

    // Validate request body
    const validationResult = updateOrganizationSchema.safeParse(body);
    if (!validationResult.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: validationResult.error.errors.map((err) => ({
              path: err.path.join('.'),
              message: err.message,
            })),
          },
        },
        400
      );
    }

    const service = createOrganizationService({
      db: dbHttp,
      environment: c.env.ENVIRONMENT || 'development',
    });

    const organization = await service.update(id, validationResult.data);

    return c.json({ data: organization });
  } catch (err) {
    const { statusCode, response } = mapErrorToResponse(err);
    return c.json(response, statusCode);
  }
});

/**
 * GET /api/organizations
 * List organizations with filters
 *
 * Query params: search, sortBy, sortOrder, page, limit
 * Returns: PaginatedResponse<Organization> (200)
 */
app.get('/', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        },
        401
      );
    }

    // Extract query parameters
    const search = c.req.query('search');
    const sortBy = c.req.query('sortBy') as 'createdAt' | 'name' | undefined;
    const sortOrder = c.req.query('sortOrder') as 'asc' | 'desc' | undefined;
    const page = parseInt(c.req.query('page') || '1', 10);
    const limit = parseInt(c.req.query('limit') || '20', 10);

    const service = createOrganizationService({
      db: dbHttp,
      environment: c.env.ENVIRONMENT || 'development',
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

    return c.json({ data: result });
  } catch (err) {
    const { statusCode, response } = mapErrorToResponse(err);
    return c.json(response, statusCode);
  }
});

/**
 * DELETE /api/organizations/:id
 * Soft delete organization
 *
 * Returns: Success message (200)
 */
app.delete('/:id', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        },
        401
      );
    }

    const id = c.req.param('id');

    const service = createOrganizationService({
      db: dbHttp,
      environment: c.env.ENVIRONMENT || 'development',
    });

    await service.delete(id);

    return c.json({
      data: {
        success: true,
        message: 'Organization deleted successfully',
      },
    });
  } catch (err) {
    const { statusCode, response } = mapErrorToResponse(err);
    return c.json(response, statusCode);
  }
});

/**
 * GET /api/organizations/check-slug/:slug
 * Check if slug is available
 *
 * Returns: { available: boolean } (200)
 */
app.get('/check-slug/:slug', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        },
        401
      );
    }

    const slug = c.req.param('slug');

    const service = createOrganizationService({
      db: dbHttp,
      environment: c.env.ENVIRONMENT || 'development',
    });

    const available = await service.isSlugAvailable(slug);

    return c.json({
      data: {
        slug,
        available,
      },
    });
  } catch (err) {
    const { statusCode, response } = mapErrorToResponse(err);
    return c.json(response, statusCode);
  }
});

export default app;
