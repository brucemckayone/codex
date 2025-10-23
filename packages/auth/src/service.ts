// Placeholder for the shared BetterAuth service.
// This is based on the configuration from the Auth TDD.

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle';
import { db, schema } from '@codex/database';
// Note: This introduces a dependency on a new @codex/notifications package
// import { notificationService } from '@codex/notifications';

// TODO: The notificationService dependency needs to be resolved once the package is created.

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      ...schema,
      // @ts-ignore
      user: schema.users,
      // @ts-ignore
      session: schema.sessions,
      // @ts-ignore
      verification: schema.verificationTokens
    }
  }),
  session: {
    expiresIn: 60 * 60 * 24, // 24 hours
    cookieName: 'codex-session',
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      // await notificationService.sendEmail({
      //   template: 'email-verification',
      //   recipient: user.email,
      //   data: { userName: user.name, verificationUrl: url }
      // });
      console.log(`Sending verification email to ${user.email} with link ${url}`)
    },
    sendResetPasswordEmail: async ({ user, url }) => {
      // await notificationService.sendEmail({
      //   template: 'password-reset',
      //   recipient: user.email,
      //   data: { userName: user.name, resetUrl: url }
      // });
      console.log(`Sending password reset to ${user.email} with link ${url}`)
    }
  },
  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: true,
        defaultValue: 'customer',
      }
    }
  },
  // These will be read from environment variables
  secret: process.env.AUTH_SECRET,
  baseURL: process.env.AUTH_URL,
});

// The SvelteKit-specific parts, like the handler and hooks,
// will live in the `apps/web` project and import this `auth` instance.
