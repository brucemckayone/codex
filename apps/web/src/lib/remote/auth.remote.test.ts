/**
 * Auth Remote Functions Tests
 *
 * Tests for authentication remote functions.
 * Note: Remote functions run on the server, so we test exports and schemas.
 * Mocks are centralized in src/tests/mocks.ts
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

// Additional mock for @sveltejs/kit redirect function
vi.mock('@sveltejs/kit', () => ({
  redirect: vi.fn(),
}));

describe('remote/auth.remote', () => {
  // Pre-warm dynamic imports (slow on first load)
  beforeAll(async () => {
    await import('./auth.remote');
  }, 30_000);

  it('exports loginForm', async () => {
    const { loginForm } = await import('./auth.remote');
    expect(loginForm).toBeDefined();
  });

  it('exports registerForm', async () => {
    const { registerForm } = await import('./auth.remote');
    expect(registerForm).toBeDefined();
  });

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

  it('exports logout command', async () => {
    const { logout } = await import('./auth.remote');
    expect(logout).toBeDefined();
  });
});
