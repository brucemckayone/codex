/**
 * User Management Endpoints
 *
 * RESTful API for user profile management including avatar uploads.
 * All routes require authentication.
 *
 * Endpoints:
 * - POST /api/user/avatar - Upload user avatar
 */

import { Hono } from 'hono';
import type { HonoEnv } from '@codex/shared-types';
import { multipartProcedure } from '@codex/worker-utils';
import { SUPPORTED_MIME_TYPES, MAX_IMAGE_SIZE_BYTES } from '@codex/image-processing';
import { z } from 'zod';

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
        allowedMimeTypes: Array.from(SUPPORTED_MIME_TYPES),
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

export default app;
