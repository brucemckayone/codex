/**
 * Auth Remote Functions Tests
 *
 * Tests for authentication remote functions.
 * Note: Remote functions run on the server, so we test exports and schemas.
 * Mocks are centralized in src/tests/mocks.ts
 *
 * History
 * -------
 * Codex-ttavz.12 / Codex-ttavz.15 (2026-04-27): registerForm export removed.
 * Register flow uses the page action at routes/(auth)/register/+page.server.ts
 * because it requires direct access to the auth worker's Set-Cookie header
 * to set the session cookie. forgotPasswordForm and resetPasswordForm are
 * the canonical paths for their respective flows (page actions removed).
 */

import { beforeAll, describe, expect, it } from 'vitest';

describe('remote/auth.remote', () => {
  // Pre-warm dynamic imports (slow on first load)
  beforeAll(async () => {
    await import('./auth.remote');
  }, 30_000);

  it('exports forgotPasswordForm', async () => {
    const { forgotPasswordForm } = await import('./auth.remote');
    expect(forgotPasswordForm).toBeDefined();
  });

  it('exports resetPasswordForm', async () => {
    const { resetPasswordForm } = await import('./auth.remote');
    expect(resetPasswordForm).toBeDefined();
  });

  it('exports getSession query', async () => {
    const { getSession } = await import('./auth.remote');
    expect(getSession).toBeDefined();
  });
});
