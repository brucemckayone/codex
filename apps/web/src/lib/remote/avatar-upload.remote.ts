/**
 * Avatar Upload Remote Function
 *
 * Handles avatar file uploads using SvelteKit remote functions.
 * Validates file type and size before uploading.
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import { VersionedCache } from '@codex/cache';
import { z } from 'zod';
import { form, getRequestEvent } from '$app/server';
import { createServerApi } from '$lib/server/api';
import { getProfile } from './account.remote';

/**
 * Avatar upload schema
 */
const avatarUploadSchema = z.object({
  avatar: z
    .instanceof(File)
    .refine((file) => file.type.startsWith('image/'), 'Must be an image file')
    .refine(
      (file) => file.size <= 5 * 1024 * 1024,
      'File must be less than 5MB'
    ),
});

/**
 * Avatar upload form
 *
 * Usage in Svelte:
 * ```svelte
 * <form {...avatarUploadForm}>
 *   <input type="file" name="avatar" accept="image/*" />
 *   <button disabled={$avatarUploadForm.pending}>Upload</button>
 * </form>
 * ```
 */
export const avatarUploadForm = form(avatarUploadSchema, async ({ avatar }) => {
  const { platform, cookies, locals } = getRequestEvent();
  const api = createServerApi(platform, cookies);

  try {
    const result = await api.account.uploadAvatar(avatar);

    // Invalidate web app's cache after successful upload
    const cache = platform?.env?.CACHE_KV
      ? new VersionedCache({ kv: platform.env.CACHE_KV as KVNamespace })
      : null;

    if (cache && locals?.user?.id) {
      await cache.invalidate(locals.user.id);
    }

    await getProfile().refresh();

    return {
      success: true,
      data: result.data,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload avatar',
    };
  }
});
