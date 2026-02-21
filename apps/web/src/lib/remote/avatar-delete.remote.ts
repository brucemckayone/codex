/**
 * Avatar Delete Remote Function
 *
 * Handles avatar deletion using SvelteKit remote functions.
 */

import { z } from 'zod';
import { form, getRequestEvent } from '$app/server';
import { createServerApi } from '$lib/server/api';

/**
 * Avatar delete schema (no fields needed)
 */
const avatarDeleteSchema = z.object({});

/**
 * Avatar delete form
 *
 * Usage in Svelte:
 * ```svelte
 * <form {...avatarDeleteForm}>
 *   <button type="submit" disabled={$avatarDeleteForm.pending}>Remove Avatar</button>
 * </form>
 * ```
 */
export const avatarDeleteForm = form(avatarDeleteSchema, async () => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);

  try {
    await api.account.deleteAvatar();
    return {
      success: true,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to remove avatar',
    };
  }
});
