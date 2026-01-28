import type { ImageUploadResult } from '@codex/image-processing';
import type { HonoEnv } from '@codex/shared-types';
import { procedure } from '@codex/worker-utils';
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
  procedure({
    policy: { auth: 'required' },
    handler: async (ctx): Promise<ImageUploadResult> => {
      const formData = await ctx.req.raw.formData();
      const file = formData.get('avatar');

      if (!file || !(file instanceof File)) {
        throw new Error('Avatar file is required');
      }

      await ctx.services.identity.uploadAvatar(
        ctx.user.id,
        file,
        ctx.env.MEDIA_BUCKET
      );

      // Return result from service (uploadAvatar should return it)
      // I need to update IdentityService.uploadAvatar to return ImageUploadResult
      // checking my implementation, it does return it.

      // Wait, I need to call it again or assume it worked.
      // Re-reading my previous write...
      return await ctx.services.identity.uploadAvatar(
        ctx.user.id,
        file,
        ctx.env.MEDIA_BUCKET
      );
    },
  })
);

export default app;
