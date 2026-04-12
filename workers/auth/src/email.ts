/**
 * Auth Worker Email Helper
 *
 * Sends transactional auth emails (verification, password reset, welcome)
 * via the notifications-api internal endpoint. Uses the template system
 * for consistent branding and audit logging.
 *
 * In development, ConsoleProvider logs emails to terminal.
 * In production, Resend delivers real emails.
 */

import { getServiceUrl } from '@codex/constants';
import { workerFetch } from '@codex/security';
import type { AuthBindings } from './types';

interface SendParams {
  to: string;
  toName?: string;
  templateName: string;
  category: 'transactional' | 'marketing';
  data: Record<string, string>;
}

/**
 * Send an email via the notifications-api internal endpoint.
 * Auth emails are awaited (not fire-and-forget) because the user
 * is waiting for the verification/reset link.
 */
async function sendViaNotificationsApi(
  env: AuthBindings,
  params: SendParams
): Promise<void> {
  const url = `${getServiceUrl('notifications', env)}/internal/send`;
  const body = JSON.stringify(params);

  try {
    const response = await workerFetch(
      url,
      { method: 'POST', body },
      env.WORKER_SHARED_SECRET
    );

    if (!response.ok) {
      // Email send failed — notifications-api audit log captures details.
      // Don't throw — email failure shouldn't block registration.
    }
  } catch {
    // Swallow network errors — notifications-api may not be running in dev
  }
}

/**
 * Send a verification email to a newly registered user.
 */
export async function sendVerificationEmail(
  env: AuthBindings,
  user: { name?: string | null; email: string },
  token: string
): Promise<void> {
  const verificationUrl = `${env.WEB_APP_URL}/verify-email?token=${encodeURIComponent(token)}`;

  await sendViaNotificationsApi(env, {
    to: user.email,
    toName: user.name ?? undefined,
    templateName: 'email-verification',
    category: 'transactional',
    data: {
      userName: user.name || 'there',
      verificationUrl,
      expiryHours: '24',
    },
  });
}

/**
 * Send a password reset email.
 */
export async function sendPasswordResetEmail(
  env: AuthBindings,
  user: { name?: string | null; email: string },
  resetUrl: string
): Promise<void> {
  await sendViaNotificationsApi(env, {
    to: user.email,
    toName: user.name ?? undefined,
    templateName: 'password-reset',
    category: 'transactional',
    data: {
      userName: user.name || 'there',
      resetUrl,
      expiryHours: '1',
    },
  });
}

/**
 * Send a password changed confirmation email.
 */
export async function sendPasswordChangedEmail(
  env: AuthBindings,
  user: { name?: string | null; email: string }
): Promise<void> {
  await sendViaNotificationsApi(env, {
    to: user.email,
    toName: user.name ?? undefined,
    templateName: 'password-changed',
    category: 'transactional',
    data: {
      userName: user.name || 'there',
    },
  });
}

/**
 * Send a welcome email after verification.
 */
export async function sendWelcomeEmail(
  env: AuthBindings,
  user: { name?: string | null; email: string }
): Promise<void> {
  const webAppUrl = env.WEB_APP_URL || '';

  await sendViaNotificationsApi(env, {
    to: user.email,
    toName: user.name ?? undefined,
    templateName: 'welcome',
    category: 'marketing',
    data: {
      userName: user.name || 'there',
      loginUrl: `${webAppUrl}/login`,
      exploreUrl: webAppUrl,
    },
  });
}
