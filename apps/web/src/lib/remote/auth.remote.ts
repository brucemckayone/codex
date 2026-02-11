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

import { COOKIES } from '@codex/constants';
import { redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { command, form, getRequestEvent, query } from '$app/server';
import { logger } from '$lib/observability';
import { createServerApi, serverApiUrl } from '$lib/server/api';
import { extractSessionToken } from '$lib/server/auth-utils';

// ─────────────────────────────────────────────────────────────────────────────
// Schemas for forms (use _password prefix to prevent repopulation)
// ─────────────────────────────────────────────────────────────────────────────

const loginFormSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  _password: z.string().min(1, 'Password is required'),
});

const registerFormSchema = z
  .object({
    name: z
      .string()
      .min(2, 'Name must be at least 2 characters')
      .max(100)
      .optional(),
    email: z.string().email('Please enter a valid email address'),
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
// Helper to extract and set session cookie from auth response
// ─────────────────────────────────────────────────────────────────────────────

function extractAndSetSessionCookie(
  response: Response,
  cookies: ReturnType<typeof getRequestEvent>['cookies'],
  isSecure: boolean
): boolean {
  const token = extractSessionToken(response);
  if (!token) return false;

  cookies.set(COOKIES.SESSION_NAME, token, {
    path: '/',
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
  });

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Login Form
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Login form with progressive enhancement
 *
 * Usage in Svelte:
 * ```svelte
 * <form {...loginForm}>
 *   <input {...loginForm.fields.email.as('email')} />
 *   <input {...loginForm.fields._password.as('password')} />
 *   <button disabled={loginForm.pending}>Sign In</button>
 * </form>
 * ```
 */
export const loginForm = form(loginFormSchema, async ({ email, _password }) => {
  const { platform, cookies } = getRequestEvent();

  // Call auth worker directly for Set-Cookie header access
  const authUrl = serverApiUrl(platform, 'auth');
  const response = await fetch(`${authUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: _password }),
  });

  if (!response.ok) {
    const error = (await response
      .json()
      .catch(() => ({ message: 'Login failed' }))) as { message?: string };
    return {
      success: false,
      error: error.message || 'Invalid email or password',
    };
  }

  // Extract and set session cookie
  const isSecure = !platform?.env || platform.env.ENVIRONMENT !== 'development';
  extractAndSetSessionCookie(response, cookies, isSecure);

  // Redirect to library on success
  redirect(303, '/library');
});

// ─────────────────────────────────────────────────────────────────────────────
// Register Form
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registration form with progressive enhancement
 */
export const registerForm = form(
  registerFormSchema,
  async ({ name, email, _password }) => {
    const { platform, cookies } = getRequestEvent();

    const authUrl = serverApiUrl(platform, 'auth');
    const response = await fetch(`${authUrl}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password: _password }),
    });

    if (!response.ok) {
      const error = (await response
        .json()
        .catch(() => ({ message: 'Registration failed' }))) as {
        message?: string;
      };
      return {
        success: false,
        error: error.message || 'Failed to create account',
      };
    }

    // Extract and set session cookie
    const isSecure =
      !platform?.env || platform.env.ENVIRONMENT !== 'development';
    extractAndSetSessionCookie(response, cookies, isSecure);

    redirect(303, '/library');
  }
);

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
    const response = await fetch(`${authUrl}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
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
        success: false,
        error: error.message || 'Failed to reset password',
      };
    }

    redirect(303, '/login?reset=success');
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

// ─────────────────────────────────────────────────────────────────────────────
// Logout Command
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Logout command - clears session cookie and redirects
 *
 * Usage:
 * ```svelte
 * <button onclick={() => logout()}>Sign Out</button>
 * ```
 */
export const logout = command(async () => {
  const { cookies } = getRequestEvent();

  // Clear the session cookie
  cookies.delete(COOKIES.SESSION_NAME, { path: '/' });

  redirect(303, '/login');
});
