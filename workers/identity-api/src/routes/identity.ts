import type { ImageProcessingResult } from '@codex/image-processing';
import { SUPPORTED_MIME_TYPES } from '@codex/image-processing';
import type { HonoEnv } from '@codex/shared-types';
import { multipartProcedure } from '@codex/worker-utils';
import { Hono } from 'hono';

const app = new Hono<HonoEnv>();

/**
 * POST /api/identity/avatar
 * Upload user avatar
 *
 * Security: Authenticated user only
 */
app.post(
  '/avatar',
  multipartProcedure({
    policy: { auth: 'required' },
    files: {
      avatar: {
        required: true,
        maxSizeBytes: 5 * 1024 * 1024, // 5MB
        allowedMimeTypes: Array.from(SUPPORTED_MIME_TYPES),
      },
    },
    handler: async (ctx): Promise<ImageProcessingResult> => {
      const { avatar } = ctx.files;

      if (!avatar) {
        throw new Error('Avatar file is required');
      }

      // Convert ValidatedFile to File object
      const file = new File([avatar.buffer], avatar.name, {
        type: avatar.type,
      });

      // IdentityService is configured with r2Service and mediaBucket
      // via the service registry, so we only pass userId and file
      return await ctx.services.identity.uploadAvatar(ctx.user.id, file);
    },
  })
);

export default app;
