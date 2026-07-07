/**
 * Avatar Upload Remote Function
 *
 * Handles avatar file uploads using SvelteKit remote functions.
 * Validates file type and size before uploading.
 */

import {
  MAX_IMAGE_SIZE_BYTES,
  SUPPORTED_IMAGE_MIME_TYPES,
  z,
} from '@codex/validation';
import { form, getRequestEvent } from '$app/server';
import { createServerApi } from '$lib/server/api';
import { invalidateCache } from '$lib/server/cache';
import { getProfile } from './account.remote';

const MAX_IMAGE_SIZE_MB = Math.round(MAX_IMAGE_SIZE_BYTES / 1024 / 1024);

/**
 * Avatar upload schema.
 *
 * Mirrors the server's `SUPPORTED_IMAGE_MIME_TYPES` / `MAX_IMAGE_SIZE_BYTES`
 * (from `@codex/validation`) so the client rejects unsupported files with a
 * clear, actionable message BEFORE the round-trip. The previous
 * `type.startsWith('image/')` check let iPhone HEIC/HEIF photos through — the
 * server then rejected them, surfacing as a confusing "failed upload".
 *
 * An empty `file.type` is allowed through: the browser occasionally omits it,
 * and the server re-validates by magic bytes regardless.
 */
const avatarUploadSchema = z.object({
  avatar: z
    .instanceof(File)
    .refine(
      (file) => !file.type || SUPPORTED_IMAGE_MIME_TYPES.has(file.type),
      'Use a JPG, PNG, WebP, or GIF image — HEIC and other formats are not supported.'
    )
    .refine(
      (file) => file.size <= MAX_IMAGE_SIZE_BYTES,
      `Image must be ${MAX_IMAGE_SIZE_MB}MB or smaller.`
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
      data: result,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload avatar',
    };
  }
});
