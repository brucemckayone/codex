/**
 * Identity API Worker
 *
 * Cloudflare Worker providing RESTful API endpoints for identity management.
 *
 * Security Features:
 * - Session-based authentication on all routes (via @codex/security)
 * - Rate limiting via KV namespace
 * - Security headers (CSP, XFO, etc.)
 * - Input validation with Zod schemas
 * - Error sanitization (no internal details exposed)
 *
 * Architecture:
 * - Hono framework for routing and middleware
 * - @codex/identity services for business logic
 * - @codex/database for data persistence (HTTP client)
 * - @codex/validation for request validation
 * - @codex/security for authentication middleware
 *
 * Routes:
 * - /health - Health check endpoint (public)
 * - /api/organizations - Organization management endpoints
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { securityHeaders, requireAuth } from '@codex/security';
import type { HonoEnv } from './types';

// Import route modules
import organizationRoutes from './routes/organizations';

// ============================================================================
// Application Setup
// ============================================================================

const app = new Hono<HonoEnv>();

// ============================================================================
// Global Middleware
// ============================================================================

/**
 * Request logging
 * Logs: method, path, status, duration
 */
app.use('*', logger());

/**
 * CORS configuration
 * Allows requests from web app and API domains
 */
app.use(
  '*',
  cors({
    origin: (origin, c) => {
      const allowedOrigins = [
        c.env.WEB_APP_URL,
        c.env.API_URL,
        'http://localhost:3000',
        'http://localhost:5173',
      ].filter(Boolean) as string[];

      if (allowedOrigins.includes(origin)) {
        return origin;
      }

      // Block unknown origins
      return allowedOrigins[0] || '*';
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'Cookie'],
    exposeHeaders: ['Content-Length', 'X-Request-Id'],
    maxAge: 86400, // 24 hours
  })
);

/**
 * Security headers
 * - Content-Security-Policy (API mode)
 * - X-Frame-Options: DENY
 * - X-Content-Type-Options: nosniff
 * - Referrer-Policy: strict-origin-when-cross-origin
 */
app.use('*', async (c, next) => {
  const middleware = securityHeaders({
    environment: (c.env.ENVIRONMENT || 'development') as
      | 'development'
      | 'staging'
      | 'production',
  });
  return middleware(c, next);
});

// ============================================================================
// Public Routes (No Authentication)
// ============================================================================

/**
 * Health check endpoint
 * Returns service status without requiring authentication
 */
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'identity-api',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// Protected Routes (Authentication Required)
// ============================================================================

/**
 * Authentication middleware
 * All routes below this point require valid session
 * Sets c.get('user') and c.get('session') on successful auth
 */
app.use('/api/*', async (c, next) => {
  const authMiddleware = requireAuth({
    cookieName: 'codex-session',
    enableLogging: c.env.ENVIRONMENT === 'development',
  });
  return authMiddleware(c, next);
});

/**
 * Mount API routes
 * All routes inherit authentication from middleware above
 */
app.route('/api/organizations', organizationRoutes);

// ============================================================================
// Error Handling
// ============================================================================

/**
 * 404 Not Found handler
 */
app.notFound((c) => {
  return c.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found',
      },
    },
    404
  );
});

/**
 * Global error handler
 * Catches uncaught errors and returns sanitized responses
 */
app.onError((err, c) => {
  console.error('Unhandled error:', {
    error: err.message,
    stack: err.stack,
    path: c.req.path,
    method: c.req.method,
  });

  // Don't expose internal error details in production
  if (c.env.ENVIRONMENT === 'production') {
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      },
      500
    );
  }

  // Development: include error details
  return c.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: err.message,
        stack: err.stack?.split('\n').slice(0, 5),
      },
    },
    500
  );
});

// ============================================================================
// Export
// ============================================================================

export default app;
