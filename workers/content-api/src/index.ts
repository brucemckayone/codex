/**
 * Content API Worker
 *
 * Cloudflare Worker providing RESTful API endpoints for content management.
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
 * - @codex/content services for business logic
 * - @codex/database for data persistence (HTTP client)
 * - @codex/validation for request validation
 * - @codex/security for authentication middleware
 * - @codex/worker-utils for standardized worker setup
 *
 * Routes:
 * - /health - Health check endpoint (public)
 * - /api/content - Content management endpoints
 * - /api/media - Media item endpoints
 * - /api/access - Content access and playback endpoints
 */

import { testDbConnection } from '@codex/database';
import type { Bindings } from '@codex/shared-types';
import { createKvCheck, createWorker } from '@codex/worker-utils';
import type { Context } from 'hono';
// Import route modules
import contentRoutes from './routes/content';
import contentAccessRoutes from './routes/content-access';
import mediaRoutes from './routes/media';

// ============================================================================
// Application Setup
// ============================================================================

const app = createWorker({
  serviceName: 'content-api',
  version: '1.0.0',
  enableRequestTracking: true, // UUID request IDs, IP tracking, user agent
  enableLogging: true,
  enableCors: true,
  enableSecurityHeaders: true,
  enableGlobalAuth: false, // Using route-level withPolicy() instead
  healthCheck: {
    checkDatabase: async (_c: Context) => {
      const isConnected = await testDbConnection();
      return {
        status: isConnected ? 'ok' : 'error',
        message: isConnected
          ? 'Database connection is healthy.'
          : 'Database connection failed.',
      };
    },
    checkKV: createKvCheck(['RATE_LIMIT_KV']),
    checkR2: async (c: Context) => {
      try {
        const env = c.env as Bindings;

        // Check if R2 bucket binding is available
        if (!env.MEDIA_BUCKET) {
          return {
            status: 'error',
            message: 'R2 bucket binding (MEDIA_BUCKET) not configured',
          };
        }

        // Check if R2 credentials are configured
        if (
          !env.R2_ACCOUNT_ID ||
          !env.R2_ACCESS_KEY_ID ||
          !env.R2_SECRET_ACCESS_KEY
        ) {
          return {
            status: 'error',
            message:
              'R2 credentials not configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY required)',
          };
        }

        // Test bucket accessibility by attempting to list objects (limited to 1)
        // This verifies both bucket binding and credentials without creating objects
        await env.MEDIA_BUCKET.list({ limit: 1 });

        return {
          status: 'ok',
          message: 'R2 bucket accessible',
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown R2 error';
        return {
          status: 'error',
          message: `R2 bucket check failed: ${errorMessage}`,
        };
      }
    },
  },
});

// ============================================================================
// Rate Limiting
// ============================================================================

// Note: Rate limiting is now applied at the route level via withPolicy()
// Each route declares its own rate limit preset (api, auth, etc.)

// ============================================================================
// API Routes
// ============================================================================

/**
 * Mount API routes
 * All routes inherit authentication from createWorker middleware
 */
app.route('/api/content', contentRoutes);
app.route('/api/media', mediaRoutes);
app.route('/api/access', contentAccessRoutes);

// ============================================================================
// Export
// ============================================================================

export default app;
