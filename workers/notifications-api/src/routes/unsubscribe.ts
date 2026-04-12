/**
 * Unsubscribe Routes (Public)
 *
 * GET  /unsubscribe/:token — Validate token, return category info
 * POST /unsubscribe/:token — Process unsubscribe, update preferences
 *
 * No auth required — token-based verification (HMAC-signed).
 * Required for CAN-SPAM / GDPR compliance.
 */

import { createDbClient, schema } from '@codex/database';
import { verifyUnsubscribeToken } from '@codex/notifications';
import type { HonoEnv } from '@codex/shared-types';
import { Hono } from 'hono';

const app = new Hono<HonoEnv>();

/**
 * GET /:token — Validate unsubscribe token (no side effects)
 * Used by the SvelteKit page to display confirmation UI.
 */
app.get('/:token', async (c) => {
  const token = c.req.param('token');
  const secret = c.env.WORKER_SHARED_SECRET;

  if (!secret) {
    return c.json({ valid: false, reason: 'Server misconfigured' }, 500);
  }

  const payload = await verifyUnsubscribeToken(token, secret);

  if (!payload) {
    return c.json({ valid: false, reason: 'Token is invalid or expired' }, 200);
  }

  return c.json({
    valid: true,
    category: payload.category,
  });
});

/**
 * POST /:token — Process unsubscribe (updates preferences)
 * Idempotent — re-unsubscribing the same category is a no-op.
 */
app.post('/:token', async (c) => {
  const token = c.req.param('token');
  const secret = c.env.WORKER_SHARED_SECRET;

  if (!secret) {
    return c.json({ success: false, error: 'Server misconfigured' }, 500);
  }

  const db = createDbClient(c.env);

  const payload = await verifyUnsubscribeToken(token, secret);

  if (!payload) {
    return c.json(
      { success: false, error: 'Token is invalid or expired' },
      400
    );
  }

  // Update the preference — set the matching column to false
  const updateField =
    payload.category === 'marketing'
      ? { emailMarketing: false }
      : { emailDigest: false };

  // Upsert: create if doesn't exist, update if exists
  try {
    await db
      .insert(schema.notificationPreferences)
      .values({
        userId: payload.userId,
        ...updateField,
      })
      .onConflictDoUpdate({
        target: schema.notificationPreferences.userId,
        set: updateField,
      });
  } catch {
    return c.json(
      {
        success: false,
        error: 'Failed to update preferences. Please try again.',
      },
      500
    );
  }

  return c.json({ success: true, category: payload.category });
});

export default app;
