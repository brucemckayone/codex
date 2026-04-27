/**
 * Auth Remote Functions
 *
 * Server-side functions for authentication flows using SvelteKit Remote Functions.
 * Uses `form()` for progressive enhancement - works without JS, enhances with JS.
 *
 * Security notes:
 * - Fields prefixed with `_` (like `_password`) are NOT repopulated on validation failure
 * - Direct auth worker calls are used to access Set-Cookie header
 * - Session cookies are HTTPOnly and Secure in production
 */

import { z } from 'zod';
import { form, getRequestEvent, query } from '$app/server';
import { logger } from '$lib/observability';
import { createServerApi, serverApiUrl } from '$lib/server/api';

// ─────────────────────────────────────────────────────────────────────────────
// Schemas for forms (use _password prefix to prevent repopulation)
// ─────────────────────────────────────────────────────────────────────────────

const forgotPasswordFormSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
});

const resetPasswordFormSchema = z
  .object({
    token: z.string().min(1, 'Token is required'),
    _password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[a-zA-Z]/, 'Password must contain at least one letter')
      .regex(/[0-9]/, 'Password must contain at least one number'),
    _confirmPassword: z.string(),
  })
  .refine((data) => data._password === data._confirmPassword, {
    message: 'Passwords do not match',
    path: ['_confirmPassword'],
  });

// ─────────────────────────────────────────────────────────────────────────────
// Forgot Password Form
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Forgot password form - sends reset email
 */
export const forgotPasswordForm = form(
  forgotPasswordFormSchema,
  async ({ email }) => {
    const { platform } = getRequestEvent();

    const authUrl = serverApiUrl(platform, 'auth');
    const response = await fetch(`${authUrl}/api/auth/forget-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, redirectTo: '/reset-password' }),
    });

    // Log failures server-side for monitoring (but don't expose to user)
    if (!response.ok) {
      logger.warn('Forgot password request failed', {
        status: response.status,
        // Don't log email to avoid PII in logs
      });
    }

    // Always return success to prevent email enumeration
    return {
      success: true,
      message: 'If an account exists, a reset email has been sent.',
    };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Reset Password Form
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reset password form - completes password reset with token
 */
export const resetPasswordForm = form(
  resetPasswordFormSchema,
  async ({ token, _password }) => {
    const { platform } = getRequestEvent();

    const authUrl = serverApiUrl(platform, 'auth');
    const response = await fetch(`${authUrl}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: _password }),
    });

    if (!response.ok) {
      const error = (await response
        .json()
        .catch(() => ({ message: 'Reset failed' }))) as { message?: string };
      return {
        success: false as const,
        error:
          error.message ||
          'Password reset failed. Token may be invalid or expired.',
      };
    }

    return { success: true as const };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Session Query
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get current session (for components)
 *
 * Usage:
 * ```svelte
 * {#await getSession()}
 *   <p>Loading...</p>
 * {:then session}
 *   {#if session.user}
 *     <p>Welcome, {session.user.name}</p>
 *   {/if}
 * {/await}
 * ```
 */
export const getSession = query(async () => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);

  try {
    return await api.auth.getSession();
  } catch {
    return { user: null, session: null };
  }
});
