/**
 * Auth Remote Functions Tests
 *
 * Tests for authentication remote functions.
 * Note: Remote functions run on the server, so we test exports and schemas.
 */

import { describe, expect, it, vi } from 'vitest';

// Mock SvelteKit server modules before importing
vi.mock('$app/server', () => ({
  command: vi.fn((fn) => fn),
  form: vi.fn((_schema, fn) => fn),
  query: vi.fn((fn) => fn),
  getRequestEvent: vi.fn(() => ({
    platform: { env: {} },
    cookies: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
    url: new URL('http://localhost:3000'),
  })),
}));

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    auth: { getSession: vi.fn() },
  })),
  serverApiUrl: vi.fn(() => 'http://localhost:42069'),
}));

vi.mock('@sveltejs/kit', () => ({
  redirect: vi.fn(),
}));

describe('remote/auth.remote', () => {
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
