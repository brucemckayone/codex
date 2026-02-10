/**
 * Auth Worker Email Helper
 *
 * Sends transactional auth emails (verification, password reset) using
 * the @codex/notifications provider layer directly. In development,
 * emails are logged to the worker terminal via ConsoleProvider.
 * In production, emails are sent via Resend.
 */

import type { EmailProvider } from '@codex/notifications';
import { createEmailProvider } from '@codex/notifications';
import type { AuthBindings } from './types';

let cachedProvider: EmailProvider | null = null;

/**
 * Get or create the email provider based on worker environment bindings.
 * Cached per-isolate to avoid re-creating the Resend client on every request.
 */
export function getEmailProvider(env: AuthBindings): EmailProvider {
  if (!cachedProvider) {
    cachedProvider = createEmailProvider({
      useMock: env.USE_MOCK_EMAIL === 'true',
      resendApiKey: env.RESEND_API_KEY,
    });
  }
  return cachedProvider;
}

/**
 * Send a verification email to a newly registered user.
 */
export async function sendVerificationEmail(
  env: AuthBindings,
  user: { name?: string | null; email: string },
  token: string
): Promise<void> {
  const provider = getEmailProvider(env);
  const verificationUrl = `${env.WEB_APP_URL}/verify-email?token=${token}`;
  const userName = user.name || 'there';

  const result = await provider.send(
    {
      to: user.email,
      toName: user.name ?? undefined,
      subject: 'Verify your email - Codex',
      html: buildVerificationHtml(userName, verificationUrl),
      text: buildVerificationText(userName, verificationUrl),
    },
    {
      email: env.FROM_EMAIL || 'noreply@codex.local',
      name: env.FROM_NAME || 'Codex',
    }
  );

  if (!result.success) {
    console.error(
      `[Auth Email] Failed to send verification email to ${user.email}: ${result.error}`
    );
  }
}

// ---------------------------------------------------------------------------
// Inline email templates — hardcoded to avoid DB dependency for auth emails
// ---------------------------------------------------------------------------

function buildVerificationHtml(
  userName: string,
  verificationUrl: string
): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#ffffff;border-radius:8px;overflow:hidden;">
        <tr><td style="padding:32px 32px 24px;text-align:center;">
          <h1 style="margin:0 0 8px;font-size:22px;color:#18181b;">Verify your email</h1>
          <p style="margin:0;color:#71717a;font-size:15px;">Hi ${userName}, thanks for signing up!</p>
        </td></tr>
        <tr><td style="padding:0 32px 32px;text-align:center;">
          <a href="${verificationUrl}"
             style="display:inline-block;padding:12px 32px;background:#18181b;color:#ffffff;text-decoration:none;border-radius:6px;font-size:15px;font-weight:500;">
            Verify email address
          </a>
          <p style="margin:20px 0 0;color:#a1a1aa;font-size:13px;">
            Or copy this link:<br>
            <a href="${verificationUrl}" style="color:#3b82f6;word-break:break-all;">${verificationUrl}</a>
          </p>
          <p style="margin:16px 0 0;color:#a1a1aa;font-size:12px;">This link expires in 24 hours.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildVerificationText(
  userName: string,
  verificationUrl: string
): string {
  return `Hi ${userName},

Thanks for signing up for Codex! Please verify your email address by visiting the link below:

${verificationUrl}

This link expires in 24 hours.

If you didn't create an account, you can safely ignore this email.`;
}
