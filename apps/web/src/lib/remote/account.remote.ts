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

import { uuidSchema } from '@codex/validation';
import { invalid, isRedirect, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { form, getRequestEvent, query } from '$app/server';
import { createServerApi } from '$lib/server/api';
import { ApiError } from '$lib/server/errors';

// ─────────────────────────────────────────────────────────────────────────────
// Schemas for forms
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Profile update form schema
 *
 * Uses simple Zod types (no .transform().pipe()) so SvelteKit's form()
 * can introspect field types for the remote function export marker.
 * Empty-string → undefined conversion is handled in the form handler instead.
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
  bio: z.string().max(500).optional(),
  website: z.string().url('Invalid website URL').or(z.literal('')).optional(),
  twitter: z.string().url('Invalid Twitter URL').or(z.literal('')).optional(),
  youtube: z.string().url('Invalid YouTube URL').or(z.literal('')).optional(),
  instagram: z
    .string()
    .url('Invalid Instagram URL')
    .or(z.literal(''))
    .optional(),
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

    // Convert empty strings to undefined (form fields submit '' when blank)
    const emptyToUndef = (v: string | undefined) => (v === '' ? undefined : v);

    try {
      const response = await api.account.updateProfile({
        displayName,
        username,
        bio: emptyToUndef(bio),
        socialLinks: {
          website: emptyToUndef(website),
          twitter: emptyToUndef(twitter),
          youtube: emptyToUndef(youtube),
          instagram: emptyToUndef(instagram),
        },
      });

      await getProfile().refresh();

      return {
        success: true,
        data: response,
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
    return response;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
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
    return response;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return {
        emailMarketing: false,
        emailTransactional: true,
        emailDigest: false,
      };
    }
    throw error;
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
  status: z.enum(['pending', 'completed', 'refunded', 'failed']).optional(),
  contentId: uuidSchema.optional(),
});

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

    // Validate the redirect URL to prevent open redirect attacks
    const portalUrl = new URL(result.url);
    if (!portalUrl.hostname.endsWith('.stripe.com')) {
      throw new Error('Invalid billing portal URL');
    }

    redirect(303, result.url);
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
