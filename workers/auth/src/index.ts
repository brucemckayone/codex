import { Hono, Next, Context } from 'hono';
import { betterAuth, User } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db, schema } from '@codex/database';
import {
  securityHeaders,
  rateLimit,
  RATE_LIMIT_PRESETS,
} from 'packages/content-management/src/security/src';

type Bindings = {
  ENVIRONMENT?: string;
  DATABASE_URL?: string;
  SESSION_SECRET?: string;
  BETTER_AUTH_SECRET?: string;
  WEB_APP_URL?: string;
  API_URL?: string;
  AUTH_SESSION_KV: KVNamespace;
  RATE_LIMIT_KV: KVNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

// A simple sequence handler to chain multiple handlers
const sequence = (
  ...handlers: ((c: Context, next: Next) => Promise<Response | void>)[]
): ((c: Context, next: Next) => Promise<Response | void>) => {
  return async (c: Context, next: Next) => {
    for (const handler of handlers) {
      const response = await handler(c, next);
      if (response) {
        return response;
      }
    }
  };
};

const authHandler = async (c: Context, _next: Next) => {
  // Initialize BetterAuth
  // Secrets are accessed from the environment, not hardcoded.
  const auth = betterAuth({
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        ...schema,
        // Map BetterAuth expected names to our schema
        user: schema.users,
        session: schema.sessions,
        verification: schema.verificationTokens,
      },
    }),
    session: {
      expiresIn: 60 * 60 * 24, // 24 hours
      updateAge: 60 * 60 * 24, // Update session every 24 hours
      cookieName: 'codex-session',
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5, // 5 minutes (short-lived)
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendVerificationEmail: async ({
        user,
        url,
      }: {
        user: User;
        url: string;
      }) => {
        // TODO: Implement email sending via notification service
        console.log(
          `Sending verification email to ${user.email} with url: ${url}`
        );
      },
      sendResetPasswordEmail: async ({
        user,
        url,
      }: {
        user: User;
        url: string;
      }) => {
        // TODO: Implement email sending via notification service
        console.log(
          `Sending password reset email to ${user.email} with url: ${url}`
        );
      },
    },
    user: {
      additionalFields: {
        role: {
          type: 'string',
          required: true,
          defaultValue: 'customer',
        },
      },
    },
    secret: c.env.BETTER_AUTH_SECRET,
    baseURL: c.env.WEB_APP_URL,
    trustedOrigins: [c.env.WEB_APP_URL, c.env.API_URL].filter(Boolean),
  });

  return auth.handler(c.req.raw);
};

const sessionHandler = async (c: Context, next: Next) => {
  const sessionCookie = c.req
    .header('cookie')
    ?.match(/codex-session=([^;]+)/)?.[1];

  if (!sessionCookie) {
    return next();
  }

  const kv = c.env.AUTH_SESSION_KV;
  if (kv) {
    const cachedSession = await kv.get(`session:${sessionCookie}`, 'json');
    if (cachedSession) {
      c.set('session', cachedSession.session);
      c.set('user', cachedSession.user);
      return next();
    }
  }

  // If not in cache, BetterAuth will handle it and we can cache it on the way out
  await next();

  if (c.get('session') && kv) {
    const session = c.get('session');
    const user = c.get('user');
    const ttl = Math.floor(
      (new Date(session.expiresAt).getTime() - Date.now()) / 1000
    );
    await kv.put(
      `session:${sessionCookie}`,
      JSON.stringify({ session, user }),
      { expirationTtl: ttl }
    );
  }
};

const rateLimiter = async (c: Context, next: Next) => {
  if (c.req.path === '/api/auth/email/login' && c.req.method === 'POST') {
    const kv = c.env.RATE_LIMIT_KV;
    if (kv) {
      const success = await rateLimit({
        kv,
        keyGenerator: (c: Context) =>
          c.req.header('cf-connecting-ip') || '127.0.0.1',
        ...RATE_LIMIT_PRESETS.auth,
      })(c, next);

      console.log('success', success);
      if (!success) {
        return c.json({ error: 'Too many requests' }, 429);
      }
      return next();
    }
  }
  return next();
};

// Health check endpoint (must be before the catch-all auth handler)
app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'auth-worker' }, 200);
});

app.use(
  '*',
  sequence(
    securityHeaders({ environment: 'development' }),
    rateLimiter,
    sessionHandler,
    authHandler
  )
);

export default app;
