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
    // BetterAuth's email/password reset endpoint is `/request-password-reset`.
    // There is NO `/forget-password` in core (only the email-otp plugin's
    // `/forget-password/email-otp`, which is not enabled), so the old path 404'd
    // and no reset email was ever sent. Verified against better-auth@1.4.11.
    const response = await fetch(`${authUrl}/api/auth/request-password-reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, redirectTo: '/reset-password' }),
    });

    // A non-2xx here is a genuine transport/config failure (unknown emails
    // still return 200 by design), so log at error level — a silent success on
    // a broken endpoint is exactly what hid this bug for months.
    if (!response.ok) {
      logger.error('Password reset request failed', {
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
// Resend Email Verification Form
// ─────────────────────────────────────────────────────────────────────────────

const resendVerificationFormSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
});

/**
 * Resend the email-verification link.
 *
 * Post-registration, the user lands on /verify-email with no way to request a
 * fresh link if the first never arrived (the old "try again" link pointed at
 * /register, which 409s for an existing-but-unverified account). This wires the
 * page to BetterAuth's `send-verification-email` endpoint.
 *
 * Always returns a neutral success message — never reveals whether the address
 * exists or is already verified — to avoid account enumeration.
 */
export const resendVerificationEmailForm = form(
  resendVerificationFormSchema,
  async ({ email }) => {
    const { platform, request } = getRequestEvent();
    const authUrl = serverApiUrl(platform, 'auth');

    // Forward the browser Origin so BetterAuth's trustedOrigins check accepts
    // the server-side fetch (same reason as register/login sign-in).
    const incomingOrigin = request.headers.get('origin');
    const incomingHost = request.headers.get('host');
    const forwardedOrigin =
      incomingOrigin ??
      (incomingHost ? `http://${incomingHost}` : 'http://lvh.me:5173');

    const response = await fetch(
      `${authUrl}/api/auth/send-verification-email`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: forwardedOrigin,
        },
        body: JSON.stringify({ email }),
      }
    );

    if (!response.ok) {
      // Log server-side for monitoring; never surface details (PII / enumeration).
      logger.warn('Resend verification email failed', {
        status: response.status,
      });
    }

    return {
      success: true as const,
      message:
        'If your account still needs verification, a new link is on its way. Check your inbox and spam folder.',
    };
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
