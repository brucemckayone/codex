/**
 * Organization API Worker
 *
 * Cloudflare Worker providing RESTful API endpoints for organization management.
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

import {
  createEnvValidationMiddleware,
  createKvCheck,
  createWorker,
  standardDatabaseCheck,
} from '@codex/worker-utils';

// Import route modules
import organizationRoutes from './routes/organizations';
import settingsRoutes from './routes/settings';

// ============================================================================
// Application Setup
// ============================================================================

const app = createWorker({
  serviceName: 'organization-api',
  version: '1.0.0',
  enableRequestTracking: true, // UUID request IDs, IP tracking, user agent
  enableCors: true,
  enableSecurityHeaders: true,
  enableGlobalAuth: false, // Using route-level procedure() instead
  healthCheck: {
    checkDatabase: standardDatabaseCheck,
    checkKV: createKvCheck(['RATE_LIMIT_KV', 'AUTH_SESSION_KV']),
  },
});

/**
 * Environment validation
 * Validates required environment variables on first request
 * Runs once per worker instance (not per request)
 */
app.use(
  '*',
  createEnvValidationMiddleware({
    required: ['DATABASE_URL', 'RATE_LIMIT_KV'],
    optional: ['ENVIRONMENT', 'WEB_APP_URL', 'API_URL'],
  })
);

// ============================================================================
// Rate Limiting
// ============================================================================

// Note: Rate limiting is now applied at the route level via procedure()
// Each route declares its own rate limit preset (api, auth, etc.)

// ============================================================================
// API Routes
// ============================================================================

/**
 * Mount API routes
 * All routes inherit authentication from createWorker middleware
 */
app.route('/api/organizations', organizationRoutes);

// Mount settings routes under /api/organizations/:id/settings
// Settings are nested under organization to scope them properly
app.route('/api/organizations/:id/settings', settingsRoutes);

// ============================================================================
// Export
// ============================================================================

export default app;
