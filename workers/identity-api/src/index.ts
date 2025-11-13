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

import { createWorker } from '@codex/worker-utils';
import { rateLimit, RATE_LIMIT_PRESETS } from '@codex/security';

// Import route modules
import organizationRoutes from './routes/organizations';

// ============================================================================
// Application Setup
// ============================================================================

const app = createWorker({
  serviceName: 'identity-api',
  version: '1.0.0',
});

// ============================================================================
// Rate Limiting
// ============================================================================

/**
 * Apply rate limiting to all API routes
 * Uses moderate preset: 100 requests per minute per IP
 */
app.use('/api/*', (c, next) => {
  return rateLimit({
    kv: c.env.RATE_LIMIT_KV,
    ...RATE_LIMIT_PRESETS.api,
  })(c, next);
});

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
