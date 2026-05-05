/**
 * Password-Changed Confirmation Hook
 *
 * BetterAuth v1.4.11 has no native afterPasswordChange callback. We bind into
 * the top-level `hooks.after` middleware (runs after every BetterAuth endpoint)
 * and explicitly match the request path to `/change-password`.
 *
 * The reset-password flow (`/reset-password`) writes to the same `account` row
 * via `internalAdapter.updateAccount({ password })`, so a
 * `databaseHooks.account.update.after` hook would fire for both. Path-based
 * matching here is the explicit way to send only on user-initiated changes —
 * reset has its own confirmation surface.
 *
 * Once-per-event guarantee: each successful POST `/change-password`
 * produces exactly one BetterAuth invocation, which produces exactly one
 * `hooks.after` call, which fires exactly one email. On failure
 * (`ctx.context.returned` is an APIError instance, not the success shape),
 * the success-shape narrowing returns early without sending.
 *
 * Failure isolation: `sendPasswordChangedEmail` already swallows network
 * errors internally; this hook also wraps in try/catch so a defect in the
 * email pipeline can never break the auth response.
 */

import { sendPasswordChangedEmail } from './email';
import type { AuthBindings } from './types';

export const CHANGE_PASSWORD_PATH = '/change-password';

interface PasswordChangedHookContext {
  path?: string;
  context?: {
    returned?: unknown;
  };
}

interface ChangePasswordSuccessUser {
  email: string;
  name?: string | null;
}

function isChangePasswordSuccess(
  returned: unknown
): returned is { user: ChangePasswordSuccessUser } {
  if (!returned || typeof returned !== 'object') return false;
  const user = (returned as { user?: unknown }).user;
  if (!user || typeof user !== 'object') return false;
  const email = (user as { email?: unknown }).email;
  return typeof email === 'string' && email.length > 0;
}

/**
 * BetterAuth after-hook handler. No-op for any path other than
 * `/change-password`, and no-op for non-success responses.
 */
export async function handlePasswordChangedHook(
  env: AuthBindings,
  ctx: PasswordChangedHookContext
): Promise<void> {
  if (ctx.path !== CHANGE_PASSWORD_PATH) return;

  const returned = ctx.context?.returned;
  if (!isChangePasswordSuccess(returned)) return;

  try {
    await sendPasswordChangedEmail(env, returned.user);
  } catch {
    // Email pipeline must never break the auth response.
  }
}
