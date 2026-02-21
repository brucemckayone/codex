/**
 * Account Remote Functions
 *
 * Server-side functions for account settings using SvelteKit Remote Functions.
 * Uses `form()` for progressive enhancement - works without JS, enhances with JS.
 *
 * References:
 * - Pattern: apps/web/src/lib/remote/auth.remote.ts
 * - Backend: workers/identity-api/src/routes/users.ts
 */

import { form, getRequestEvent, query } from '$app/server';
import {
  purchaseHistoryQuerySchema,
  updateNotificationsFormSchema,
  updateProfileFormSchema,
} from '$lib/schemas/account';
import { createServerApi } from '$lib/server/api';

// Re-export schemas for test access (SvelteKit remote requires all exports to be remote functions)
// Use a namespace object to avoid the remote function restriction
export const schemas = {
  updateProfileFormSchema,
  updateNotificationsFormSchema,
  purchaseHistoryQuerySchema,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Profile Update Form
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Profile update form with progressive enhancement
 *
 * Usage in Svelte:
 * ```svelte
 * <form {...updateProfileForm}>
 *   <input {...updateProfileForm.fields.displayName.as('text')} />
 *   <button disabled={updateProfileForm.pending}>Save</button>
 * </form>
 * ```
 */
export const updateProfileForm = form(
  updateProfileFormSchema,
  async ({
    displayName,
    username,
    bio,
    website,
    twitter,
    youtube,
    instagram,
  }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    try {
      const response = await api.account.updateProfile({
        displayName,
        username,
        bio,
        socialLinks: {
          ...(website && { website }),
          ...(twitter && { twitter }),
          ...(youtube && { youtube }),
          ...(instagram && { instagram }),
        },
      });

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to update profile',
      };
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Notification Preferences Form
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Notification preferences update form
 *
 * Usage in Svelte:
 * ```svelte
 * <form {...updateNotificationsForm}>
 *   <input type="checkbox" {...updateNotificationsForm.fields.emailMarketing.as('checkbox')} />
 *   <button disabled={updateNotificationsForm.pending}>Save</button>
 * </form>
 * ```
 */
export const updateNotificationsForm = form(
  updateNotificationsFormSchema,
  async ({ emailMarketing, emailTransactional, emailDigest }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    try {
      const response = await api.account.updateNotificationPreferences({
        emailMarketing,
        emailTransactional,
        emailDigest,
      });

      return {
        success: true,
        data: response,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to update preferences',
      };
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Profile Query
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get user profile (for components)
 *
 * Usage:
 * ```svelte
 * {#await getProfile()}
 *   <p>Loading...</p>
 * {:then profile}
 *   {#if profile}
 *     <p>Welcome, {profile.name}</p>
 *   {/if}
 * {/await}
 * ```
 */
export const getProfile = query(async () => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);

  try {
    const response = await api.account.getProfile();
    return response.data;
  } catch {
    return null;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Notification Preferences Query
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get notification preferences
 *
 * Usage:
 * ```svelte
 * {#await getNotificationPreferences()}
 *   <p>Loading...</p>
 * {:then prefs}
 *   <input type="checkbox" checked={prefs?.emailMarketing} />
 * {/await}
 * ```
 */
export const getNotificationPreferences = query(async () => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);

  try {
    return await api.account.getNotificationPreferences();
  } catch {
    // Return defaults if not set
    return {
      emailMarketing: false,
      emailTransactional: true,
      emailDigest: false,
    };
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Purchase History Query
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get purchase history
 *
 * Fetches the authenticated user's purchase history with pagination and optional filtering.
 * Returns a paginated list of purchases including associated content details.
 *
 * Query parameters:
 * - page: number (default: 1, min: 1)
 * - limit: number (default: 20, min: 1, max: 100)
 * - status: Optional filter by purchase status ('pending' | 'complete' | 'refunded' | 'failed')
 * - contentId: Optional filter by content UUID
 *
 * Usage:
 * ```svelte
 * <script>
 *   import { getPurchaseHistory } from '$lib/remote/account.remote';
 *
 *   const purchases = await getPurchaseHistory({ page: 1, limit: 20, status: 'completed' });
 * </script>
 *
 * {#each purchases.items as purchase}
 *   <PurchaseCard {purchase} />
 * {/each}
 *
 * <Pagination pagination={purchases.pagination} />
 * ```
 */
export const getPurchaseHistory = query(
  purchaseHistoryQuerySchema,
  async (params) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    const searchParams = new URLSearchParams();
    searchParams.set('page', String(params.page));
    searchParams.set('limit', String(params.limit));
    if (params.status) searchParams.set('status', params.status);
    if (params.contentId) searchParams.set('contentId', params.contentId);

    return api.account.getPurchaseHistory(
      searchParams.toString() ? searchParams : undefined
    );
  }
);
