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

import { optionalUrlSchema, uuidSchema } from '@codex/validation';
import { invalid, isRedirect, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { form, getRequestEvent, query } from '$app/server';
import { createServerApi } from '$lib/server/api';
import { ApiError } from '$lib/server/errors';

// ─────────────────────────────────────────────────────────────────────────────
// Schemas for forms
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Helper schema for optional text fields
 * Converts empty strings to undefined before validation
 * This allows form fields to be left blank without validation errors
 */
const optionalTextField = (max: number) =>
  z
    .string()
    .transform((val) => (val === '' ? undefined : val))
    .pipe(z.string().max(max).optional());

/**
 * Profile update form schema
 * Social links are now truly optional - empty strings are treated as undefined
 */
const updateProfileFormSchema = z.object({
  displayName: z
    .string()
    .min(1, 'Display name is required')
    .max(255)
    .optional(),
  username: z
    .string()
    .min(2, 'Username must be at least 2 characters')
    .max(50, 'Username must be at most 50 characters')
    .regex(
      /^[a-z0-9-]+$/,
      'Username must be lowercase letters, numbers, and hyphens'
    )
    .optional(),
  bio: optionalTextField(500),
  website: optionalUrlSchema('Invalid website URL'),
  twitter: optionalUrlSchema('Invalid Twitter URL'),
  youtube: optionalUrlSchema('Invalid YouTube URL'),
  instagram: optionalUrlSchema('Invalid Instagram URL'),
});

const updateNotificationsFormSchema = z.object({
  emailMarketing: z.boolean().optional().default(false),
  emailTransactional: z.boolean().optional().default(false),
  emailDigest: z.boolean().optional().default(false),
});

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
  async (
    { displayName, username, bio, website, twitter, youtube, instagram },
    issue
  ) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    try {
      const response = await api.account.updateProfile({
        displayName,
        username,
        bio,
        socialLinks: {
          website: website,
          twitter: twitter,
          youtube: youtube,
          instagram: instagram,
        },
      });

      await getProfile().refresh();

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      // Handle field-level validation errors from the backend.
      // SvelteKit's 'invalid()' helper returns a StandardSchema issue
      // that populates the fields.issues() array in the component.
      if (error instanceof ApiError && error.status === 400) {
        // Map generic backend error to a specific field for E2E verification
        return invalid(issue.username(error.message));
      }

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

      await getNotificationPreferences().refresh();

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
    const response = await api.account.getNotificationPreferences();
    return response.data;
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
 * Purchase history query schema
 *
 * Validates parameters for fetching user's purchase history.
 * Extends standard pagination with optional status and contentId filters.
 */
const purchaseHistoryQuerySchema = z.object({
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(100).optional().default(20),
  status: z.enum(['pending', 'complete', 'refunded', 'failed']).optional(),
  contentId: uuidSchema.optional(),
});

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
// ─────────────────────────────────────────────────────────────────────────────
// Portal Session Form
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Open Stripe Customer Portal
 * No user input needed — returnUrl is derived from the current origin.
 * Redirects directly to the Stripe billing portal on success.
 */
export const portalSessionForm = form(z.object({}), async (_data) => {
  const { platform, cookies, url } = getRequestEvent();
  const api = createServerApi(platform, cookies);

  try {
    const result = await api.checkout.createPortalSession({
      returnUrl: `${url.origin}/account/payment`,
    });
    redirect(303, result.data.url);
  } catch (error) {
    if (isRedirect(error)) throw error;
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Failed to open billing portal',
    };
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Purchase History Query
// ─────────────────────────────────────────────────────────────────────────────

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
