/**
 * Regression test for the production registration incident (2026-06-22):
 *
 * BetterAuth AWAITS the `sendVerificationEmail` / `sendResetPassword`
 * callbacks. The callbacks used to `await` the notifications-api → Resend
 * round-trip, whose 2× retry + exponential backoff can take ~20s when Resend
 * is slow or rejecting. That stalled the sign-up HTTP response past
 * Cloudflare's worker-subrequest budget → the web app's fetch returned 522
 * and users saw "Registration failed" even though the account was created.
 *
 * The fix decouples email delivery from the auth response: the send is
 * scheduled on `executionCtx.waitUntil` (fire-and-forget) so the callback
 * returns immediately. These tests pin that contract by exercising the REAL
 * callbacks wired into the constructed BetterAuth instance — not a reimplemented
 * copy — so a regression to `await`-ing the send is caught here.
 *
 * See workers/auth/src/auth-config.ts (emailVerification.sendVerificationEmail,
 * emailAndPassword.sendResetPassword).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Control the email-send promises so we can prove the callback does NOT
// await them. email.ts already swallows its own delivery errors; these mocks
// let us drive the timing/rejection explicitly.
vi.mock('../email', () => ({
  sendVerificationEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendWelcomeEmail: vi.fn(),
  wasWelcomeEmailSent: vi.fn(),
}));

import { createAuthInstance } from '../auth-config';
import { sendPasswordResetEmail, sendVerificationEmail } from '../email';
import type { AuthBindings } from '../types';

/** A never-settling promise — if the callback awaited it, the test would hang. */
function pendingForever(): Promise<void> {
  return new Promise<void>(() => {
    /* intentionally never resolves */
  });
}

interface ScheduledCtx {
  ctx: ExecutionContext;
  scheduled: Promise<unknown>[];
}

function makeExecutionCtx(): ScheduledCtx {
  const scheduled: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: vi.fn((p: Promise<unknown>) => {
      scheduled.push(p);
    }),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
  return { ctx, scheduled };
}

const kvPut = vi.fn().mockResolvedValue(undefined);

function makeEnv(environment: string): AuthBindings {
  return {
    ENVIRONMENT: environment,
    DB_METHOD: 'PRODUCTION',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
    BETTER_AUTH_SECRET: 'test-better-auth-secret',
    WEB_APP_URL: 'https://revelations.studio',
    API_URL: 'https://auth.revelations.studio',
    WORKER_SHARED_SECRET: 'test-worker-secret',
    AUTH_SESSION_KV: {
      get: vi.fn().mockResolvedValue(null),
      put: kvPut,
      delete: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as AuthBindings;
}

// better-auth exposes the resolved user options under `.options`. We reach
// in to invoke the exact callback objects auth-config.ts registered.
function getVerificationCallback(env: AuthBindings, ctx: ExecutionContext) {
  const auth = createAuthInstance({ env, executionCtx: ctx });
  const cb = (
    auth.options as { emailVerification?: { sendVerificationEmail?: unknown } }
  ).emailVerification?.sendVerificationEmail;
  if (typeof cb !== 'function') {
    throw new Error(
      'sendVerificationEmail callback not wired into BetterAuth options'
    );
  }
  return cb as (args: {
    user: { email: string; name?: string | null };
    token: string;
  }) => Promise<void>;
}

function getResetCallback(env: AuthBindings, ctx: ExecutionContext) {
  const auth = createAuthInstance({ env, executionCtx: ctx });
  const cb = (
    auth.options as { emailAndPassword?: { sendResetPassword?: unknown } }
  ).emailAndPassword?.sendResetPassword;
  if (typeof cb !== 'function') {
    throw new Error(
      'sendResetPassword callback not wired into BetterAuth options'
    );
  }
  return cb as (args: {
    user: { email: string; name?: string | null };
    url: string;
  }) => Promise<void>;
}

const user = { email: 'newuser@example.com', name: 'New User' };

describe('auth-config — verification email is fire-and-forget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    kvPut.mockResolvedValue(undefined);
  });

  it('returns without awaiting the email send (no 20s stall → no 522)', async () => {
    vi.mocked(sendVerificationEmail).mockReturnValue(pendingForever());
    const { ctx } = makeExecutionCtx();
    const callback = getVerificationCallback(makeEnv('production'), ctx);

    // If the callback awaited the (never-settling) send, this await would hang
    // and the test would time out. It resolves because the send is backgrounded.
    await expect(callback({ user, token: 'tok-123' })).resolves.toBeUndefined();

    expect(sendVerificationEmail).toHaveBeenCalledWith(
      expect.anything(),
      user,
      'tok-123'
    );
  });

  it('schedules the send on executionCtx.waitUntil', async () => {
    vi.mocked(sendVerificationEmail).mockResolvedValue(undefined);
    const { ctx, scheduled } = makeExecutionCtx();
    const callback = getVerificationCallback(makeEnv('production'), ctx);

    await callback({ user, token: 'tok-123' });

    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
    expect(scheduled).toHaveLength(1);
  });

  it('does NOT write the token to KV in production (dev/test-only path)', async () => {
    vi.mocked(sendVerificationEmail).mockResolvedValue(undefined);
    const { ctx } = makeExecutionCtx();
    const callback = getVerificationCallback(makeEnv('production'), ctx);

    await callback({ user, token: 'tok-123' });

    expect(kvPut).not.toHaveBeenCalled();
  });

  it('awaits the KV token write in development AND still backgrounds the send', async () => {
    vi.mocked(sendVerificationEmail).mockReturnValue(pendingForever());
    const { ctx } = makeExecutionCtx();
    const callback = getVerificationCallback(makeEnv('development'), ctx);

    await callback({ user, token: 'tok-dev' });

    expect(kvPut).toHaveBeenCalledWith(
      `verification:${user.email}`,
      'tok-dev',
      { expirationTtl: 300 }
    );
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
  });

  it('swallows a send rejection so it never surfaces as an auth error', async () => {
    vi.mocked(sendVerificationEmail).mockRejectedValue(new Error('Resend 500'));
    const { ctx, scheduled } = makeExecutionCtx();
    const callback = getVerificationCallback(makeEnv('production'), ctx);

    await expect(callback({ user, token: 'tok-123' })).resolves.toBeUndefined();
    // The backgrounded promise must resolve (error caught), not reject —
    // otherwise waitUntil would log an unhandled rejection.
    await expect(scheduled[0]).resolves.toBeUndefined();
  });
});

describe('auth-config — password reset email is fire-and-forget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns without awaiting the reset email send', async () => {
    vi.mocked(sendPasswordResetEmail).mockReturnValue(pendingForever());
    const { ctx } = makeExecutionCtx();
    const callback = getResetCallback(makeEnv('production'), ctx);

    await expect(
      callback({
        user,
        url: 'https://revelations.studio/reset-password?token=x',
      })
    ).resolves.toBeUndefined();
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
  });

  it('swallows a reset-send rejection', async () => {
    vi.mocked(sendPasswordResetEmail).mockRejectedValue(
      new Error('Resend down')
    );
    const { ctx, scheduled } = makeExecutionCtx();
    const callback = getResetCallback(makeEnv('production'), ctx);

    await callback({ user, url: 'https://revelations.studio/reset' });
    await expect(scheduled[0]).resolves.toBeUndefined();
  });
});
