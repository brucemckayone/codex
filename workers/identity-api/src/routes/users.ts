/**
 * User Management Endpoints
 *
 * RESTful API for user profile management including avatar uploads.
 * All routes require authentication.
 *
 * Endpoints:
 * - POST /api/user/avatar - Upload user avatar
 */

import {
  MAX_IMAGE_SIZE_BYTES,
  SUPPORTED_IMAGE_MIME_TYPES,
} from '@codex/image-processing';
import type { HonoEnv } from '@codex/shared-types';
import {
  updateNotificationPreferencesSchema,
  updateProfileSchema,
  upgradeToCreatorSchema,
} from '@codex/validation';
import { multipartProcedure, procedure } from '@codex/worker-utils';
import { Hono } from 'hono';

const app = new Hono<HonoEnv>();

/**
 * POST /api/user/avatar
 * Upload and process user avatar
 *
 * Security: Authenticated user only, must own their own profile
 * Content-Type: multipart/form-data
 * Form field: avatar (file)
 */
app.post(
  '/avatar',
  multipartProcedure({
    policy: { auth: 'required' },
    files: {
      avatar: {
        required: true,
        maxSize: MAX_IMAGE_SIZE_BYTES,
        allowedMimeTypes: Array.from(SUPPORTED_IMAGE_MIME_TYPES),
      },
    },
    handler: async (ctx) => {
      // Process avatar image via identity service (handles cache invalidation)
      const result = await ctx.services.identity.uploadAvatar(
        ctx.user.id,
        new File([ctx.files.avatar.buffer], ctx.files.avatar.name, {
          type: ctx.files.avatar.type,
        })
      );

      return {
        avatarUrl: result.url,
        size: result.size,
        mimeType: result.mimeType,
      };
    },
  })
);

/**
 * DELETE /api/user/avatar
 * Remove user avatar (revert to default)
 *
 * Security: Authenticated user (own avatar only)
 */
app.delete(
  '/avatar',
  procedure({
    policy: { auth: 'required' },
    successStatus: 204,
    handler: async (ctx) => {
      // Use service method for cleanup (deletes R2 files + clears DB field)
      await ctx.services.imageProcessing.deleteUserAvatar(ctx.user.id);

      return null;
    },
  })
);

/**
 * GET /api/user/profile
 * Get authenticated user's profile
 *
 * Security: Authenticated user only
 */
app.get(
  '/profile',
  procedure({
    policy: { auth: 'required' },
    handler: async (ctx) => {
      return await ctx.services.identity.getProfile(ctx.user.id);
    },
  })
);

/**
 * PATCH /api/user/profile
 * Update authenticated user's profile
 *
 * Security: Authenticated user only
 */
app.patch(
  '/profile',
  procedure({
    policy: { auth: 'required' },
    input: { body: updateProfileSchema },
    handler: async (ctx) => {
      return await ctx.services.identity.updateProfile(
        ctx.user.id,
        ctx.input.body
      );
    },
  })
);

/**
 * POST /api/user/upgrade-to-creator
 * Upgrade authenticated customer to creator role
 *
 * Security: Authenticated user only, must currently be role 'customer'
 * Rate limit: strict (20/min) — sensitive one-time operation
 */
app.post(
  '/upgrade-to-creator',
  procedure({
    policy: { auth: 'required', rateLimit: 'strict' },
    input: { body: upgradeToCreatorSchema },
    handler: async (ctx) => {
      const result = await ctx.services.identity.upgradeToCreator(
        ctx.user.id,
        ctx.input.body
      );

      // Invalidate session KV cache so next request picks up new role from DB.
      // Must await (not waitUntil) — the redirect that follows needs the cache
      // cleared before the browser's next request arrives.
      // Delete both key formats: session-auth middleware uses "session:{token}",
      // BetterAuth secondaryStorage uses the raw token.
      const kv = ctx.env.AUTH_SESSION_KV;
      if (kv && ctx.session?.token) {
        await Promise.all([
          kv.delete(`session:${ctx.session.token}`),
          kv.delete(ctx.session.token),
        ]).catch((err: unknown) => {
          ctx.obs?.error('Failed to invalidate session KV after role upgrade', {
            error: err instanceof Error ? err.message : String(err),
            userId: ctx.user.id,
          });
        });
      }

      return result;
    },
  })
);

/**
 * GET /api/user/notification-preferences
 * Get authenticated user's notification preferences
 * Upserts default preferences on first access
 *
 * Security: Authenticated user only
 */
app.get(
  '/notification-preferences',
  procedure({
    policy: { auth: 'required' },
    handler: async (ctx) => {
      return await ctx.services.identity.getNotificationPreferences(
        ctx.user.id
      );
    },
  })
);

/**
 * PUT /api/user/notification-preferences
 * Update authenticated user's notification preferences
 *
 * Security: Authenticated user only
 */
app.put(
  '/notification-preferences',
  procedure({
    policy: { auth: 'required' },
    input: { body: updateNotificationPreferencesSchema },
    handler: async (ctx) => {
      return await ctx.services.identity.updateNotificationPreferences(
        ctx.user.id,
        ctx.input.body
      );
    },
  })
);

export default app;
