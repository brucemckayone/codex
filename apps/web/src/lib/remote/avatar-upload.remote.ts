/**
 * Avatar Upload Remote Function
 *
 * Handles avatar file uploads using SvelteKit remote functions.
 * Validates file type and size before uploading.
 */

import { z } from 'zod';
import { form, getRequestEvent } from '$app/server';
import { createServerApi } from '$lib/server/api';
import { invalidateCache } from '$lib/server/cache';
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
    if (locals?.user?.id) {
      await invalidateCache(platform, locals.user.id);
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
