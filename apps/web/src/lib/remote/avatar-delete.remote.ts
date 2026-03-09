/**
 * Avatar Delete Remote Function
 *
 * Handles avatar deletion using SvelteKit remote functions.
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import { VersionedCache } from '@codex/cache';
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
  const { platform, cookies, locals } = getRequestEvent();
  const api = createServerApi(platform, cookies);

  try {
    await api.account.deleteAvatar();

    // Invalidate web app's cache after successful delete
    const cache = platform?.env?.CACHE_KV
      ? new VersionedCache({ kv: platform.env.CACHE_KV as KVNamespace })
      : null;

    if (cache && locals?.user?.id) {
      await cache.invalidate(locals.user.id);
    }

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
