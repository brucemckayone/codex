/**
 * Avatar Upload Remote Function
 *
 * Handles avatar file uploads using SvelteKit remote functions.
 * Validates file type and size before uploading.
 */

import { z } from 'zod';
import { form, getRequestEvent } from '$app/server';
import { ApiError } from '$lib/api/errors';
import { createServerApi } from '$lib/server/api';

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
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);

  try {
    const result = await api.account.uploadAvatar(avatar);
    return {
      success: true,
      data: result.data,
    };
  } catch (error) {
    // Preserve ApiError codes if available
    if (error instanceof ApiError) {
      return {
        success: false,
        error: error.message,
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload avatar',
    };
  }
});
