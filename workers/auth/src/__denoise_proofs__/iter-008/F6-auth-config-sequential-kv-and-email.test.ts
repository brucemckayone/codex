/**
 * Denoise iter-008 F6 — `sendVerificationEmail` callback in
 * BetterAuth `auth-config.ts` runs the dev-only `KV.put(verification:
 * ${email}, token)` and the cross-worker `sendVerificationEmail` HTTP
 * call sequentially. They are independent — no value flows from one
 * to the other.
 *
 * Fingerprint: performance:sequential-await-independent-queries
 * Severity: minor (dev/test path only — KV.put is gated on
 *   ENVIRONMENT === 'development' || 'test'; in production only the
 *   email send runs).
 * File:Lines: workers/auth/src/auth-config.ts:122 + :128
 *
 * Site (lines 113-129):
 *
 *   sendVerificationEmail: async ({ user, token }) => {
 *     if (env.AUTH_SESSION_KV && (env.ENVIRONMENT === DEVELOPMENT ||
 *                                  env.ENVIRONMENT === TEST)) {
 *       await env.AUTH_SESSION_KV.put(`verification:${user.email}`,
 *                                       token, { expirationTtl: 300 });
 *     }
 *     await sendVerificationEmail(env, user, token);
 *   }
 *
 * R12 violation per SKILL.md §1 (just promoted from iter-007):
 *   "Service methods MUST launch independent DB/API awaits via
 *    Promise.all. Sequential await is permitted only when a later
 *    query consumes a prior query's value."
 *
 * The KV write is dev/test only; sendVerificationEmail does not
 * consume the KV-stored token. Sequential here adds ~5-50ms (KV
 * write latency) to every dev/test register flow before the worker
 * fetch fires.
 *
 * Proof shape: synthetic load harness (Catalogue row 6) — in-flight
 * counter via mocked `KV.put` and mocked `sendVerificationEmail`. A
 * `Promise.all` parallel transform shows peak overlap >= 2; the
 * sequential code keeps peak == 1. Fixed-delay mocks isolate the
 * timing question from real KV/HTTP latency.
 *
 * Fix:
 *   const tasks: Promise<unknown>[] = [
 *     sendVerificationEmail(env, user, token),
 *   ];
 *   if (env.AUTH_SESSION_KV && (env.ENVIRONMENT === DEVELOPMENT ||
 *                                env.ENVIRONMENT === TEST)) {
 *     tasks.push(env.AUTH_SESSION_KV.put(`verification:${user.email}`,
 *                                          token, { expirationTtl: 300 }));
 *   }
 *   await Promise.all(tasks);
 *
 * `it.skip` while the bug stands.
 */
import { describe, expect, it } from 'vitest';

interface InFlightCounter {
  active: number;
  peak: number;
  total: number;
}

function createCounter(): InFlightCounter {
  return { active: 0, peak: 0, total: 0 };
}

async function delayedTask(
  counter: InFlightCounter,
  ms: number,
  label: string
): Promise<string> {
  counter.active += 1;
  counter.total += 1;
  if (counter.active > counter.peak) counter.peak = counter.active;
  await new Promise((r) => setTimeout(r, ms));
  counter.active -= 1;
  return label;
}

// Sequential reproduction of the live auth-config.ts shape.
async function sendVerificationEmailSequential(
  counter: InFlightCounter,
  isDev: boolean
): Promise<void> {
  if (isDev) {
    await delayedTask(counter, 10, 'kv-put-verification');
  }
  await delayedTask(counter, 10, 'send-verification-email');
}

// Parallel post-fix transform.
async function sendVerificationEmailParallel(
  counter: InFlightCounter,
  isDev: boolean
): Promise<void> {
  const tasks: Promise<string>[] = [
    delayedTask(counter, 10, 'send-verification-email'),
  ];
  if (isDev) {
    tasks.push(delayedTask(counter, 10, 'kv-put-verification'));
  }
  await Promise.all(tasks);
}

describe.skip('iter-008 F6 — auth-config sendVerificationEmail sequential awaits', () => {
  it('current sequential code never overlaps (peak === 1) in dev path', async () => {
    const counter = createCounter();
    await sendVerificationEmailSequential(counter, true);
    expect(counter.peak).toBe(1);
    expect(counter.total).toBe(2);
  });

  it('post-fix parallel code overlaps (peak >= 2) in dev path', async () => {
    const counter = createCounter();
    await sendVerificationEmailParallel(counter, true);
    expect(counter.peak).toBeGreaterThanOrEqual(2);
    expect(counter.total).toBe(2);
  });

  it('production path runs only the email send (peak === 1, total === 1)', async () => {
    const counter = createCounter();
    await sendVerificationEmailParallel(counter, false);
    expect(counter.peak).toBe(1);
    expect(counter.total).toBe(1);
  });
});
