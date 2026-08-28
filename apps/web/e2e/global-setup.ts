/**
 * Playwright globalSetup — prime the seeded-creator session cache (Codex-ty7ly).
 *
 * Runs ONCE per `playwright test` invocation, after the webServers are up and
 * before any worker process starts. Signing in here (rather than in each
 * spec's `beforeAll`) means CI retries and `workers: 2` parallelism can never
 * multiply the rate-limited `/api/auth/sign-in/email` call: the 5-per-15-min
 * credential bucket for `creator@test.com` is charged exactly once per run,
 * and every later `captureSeededCreatorCookies()` call reads the validated
 * cache instead.
 *
 * Failure here is deliberately non-fatal: if the sign-in 429s (e.g. a
 * previous run's window is still draining) or the auth worker is unreachable,
 * specs fall back to their own live capture, which fails with the established
 * per-spec error rather than killing the entire run — including the majority
 * of specs that never touch the seeded creator.
 */

import { saveSeededCreatorCookies } from './helpers/seeded-creator-session';
import { signInSeededCreatorForCapture } from './helpers/subscription';

export default async function globalSetup(): Promise<void> {
  try {
    const cookies = await signInSeededCreatorForCapture();
    await saveSeededCreatorCookies(cookies);
    console.log(
      '[global-setup] seeded creator session cached — specs will reuse it (no further sign-ins)'
    );
  } catch (error) {
    console.error(
      `[global-setup] could not prime seeded creator session (specs will fall back to live capture): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
