/**
 * Notification Preferences Routes
 *
 * User-facing endpoints for managing notification preferences.
 * Allows users to control which types of notifications they receive.
 *
 * Security: All endpoints scoped to authenticated user.
 */

import type { HonoEnv } from '@codex/shared-types';
import { updateNotificationPreferencesSchema } from '@codex/validation';
import { procedure } from '@codex/worker-utils';
import { Hono } from 'hono';

const app = new Hono<HonoEnv>();

// ============================================================================
// Notification Preferences Routes
// ============================================================================

/**
 * GET /preferences
 * Get current user's notification preferences
 *
 * Returns the user's current email notification settings.
 * Creates default preferences if none exist.
 */
app.get(
  '/preferences',
  procedure({
    policy: { auth: 'required' },
    handler: async (ctx) => {
      return ctx.services.preferences.getPreferences(ctx.user.id);
    },
  })
);

/**
 * PUT /preferences
 * Update current user's notification preferences
 *
 * Allows users to opt-in/opt-out of different notification types.
 * Only provided fields are updated; unspecified fields remain unchanged.
 */
app.put(
  '/preferences',
  procedure({
    policy: { auth: 'required' },
    input: { body: updateNotificationPreferencesSchema },
    handler: async (ctx) => {
      return ctx.services.preferences.updatePreferences(
        ctx.user.id,
        ctx.input.body
      );
    },
  })
);

export default app;
