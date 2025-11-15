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
 */

import { createWorker } from '@codex/worker-utils';

// Import route modules
import contentRoutes from './routes/content';
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

// ============================================================================
// Export
// ============================================================================

export default app;
