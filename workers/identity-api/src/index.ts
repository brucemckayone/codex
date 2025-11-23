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
 * - @codex/worker-utils for standardized worker setup
 *
 * Routes:
 * - /health - Health check endpoint (public)
 * - /api/organizations - Organization management endpoints
 */

import { testDbConnection } from '@codex/database';
import { createKvCheck, createWorker } from '@codex/worker-utils';
import type { Context } from 'hono';

// Import route modules
import organizationRoutes from './routes/organizations';

// ============================================================================
// Application Setup
// ============================================================================

const app = createWorker({
  serviceName: 'identity-api',
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
app.route('/api/organizations', organizationRoutes);

// ============================================================================
// Export
// ============================================================================

export default app;
