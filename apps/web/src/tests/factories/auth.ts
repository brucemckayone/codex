/**
 * Auth Factories
 *
 * Mock data generators for users and sessions.
 */

import type { SessionData, UserData } from '@codex/shared-types';

/**
 * Create a mock user
 *
 * @param overrides - Partial user data to override defaults
 * @returns A mock user object
 */
export function createMockUser(overrides: Partial<UserData> = {}): UserData {
  return {
    id: `user-${Math.random().toString(36).substring(2, 11)}`,
    email: 'test@example.com',
    name: 'Test User',
    role: 'customer',
    emailVerified: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create a mock session
 *
 * @param userId - The ID of the user the session belongs to
 * @param overrides - Partial session data to override defaults
 * @returns A mock session object
 */
export function createMockSession(
  userId: string,
  overrides: Partial<SessionData> = {}
): SessionData {
  return {
    id: `session-${Math.random().toString(36).substring(2, 11)}`,
    userId,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    token: 'mock-session-token',
    ...overrides,
  };
}
