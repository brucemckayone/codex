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
      // Process avatar image via service registry
      const result = await ctx.services.imageProcessing.processUserAvatar(
        ctx.user.id,
        new File([ctx.files.avatar.buffer], ctx.files.avatar.name, {
          type: ctx.files.avatar.type,
        })
      );

      return {
        data: {
          avatarUrl: result.url,
          size: result.size,
          mimeType: result.mimeType,
        },
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
