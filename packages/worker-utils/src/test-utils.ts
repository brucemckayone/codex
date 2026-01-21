/**
 * Test Utilities for Integration Tests
 *
 * Provides helpers for creating real test sessions and users
 * for integration testing without mocking authentication.
 *
 * SECURITY: These utilities should ONLY be used in test files.
 * They create real sessions in the test database.
 */

import { randomUUID } from 'node:crypto';
import { dbHttp, schema } from '@codex/database';
import type { SessionData, UserData } from '@codex/security';
import { eq } from 'drizzle-orm';

/**
 * Test user data structure
 */
export interface TestUser {
  user: UserData;
  session: SessionData;
  sessionToken: string;
}

/**
 * Creates a real test user and session in the database
 *
 * This function:
 * 1. Creates a user in the database
 * 2. Creates a valid session for that user
 * 3. Returns the session token for use in test requests
 *
 * IMPORTANT: Use this in integration tests instead of mocking auth.
 * This provides true integration testing with real database sessions.
 *
 * @param email - Optional custom email (defaults to test@example.com)
 * @returns Test user data with valid session token
 *
 * @example
 * ```typescript
 * import { createTestUser } from '@codex/worker-utils/test-utils';
 *
 * describe('Content API', () => {
 *   let testUser: TestUser;
 *
 *   beforeAll(async () => {
 *     testUser = await createTestUser();
 *   });
 *
 *   it('should create content with valid auth', async () => {
 *     const req = new Request('http://localhost/api/content', {
 *       method: 'POST',
 *       headers: {
 *         'Content-Type': 'application/json',
 *         'Cookie': `codex-session=${testUser.sessionToken}`,
 *       },
 *       body: JSON.stringify({ title: 'Test', slug: 'test', contentType: 'video' }),
 *     });
 *
 *     const res = await app.fetch(req, testEnv);
 *     expect(res.status).toBe(201);
 *   });
 * });
 * ```
 */
export async function createTestUser(
  _email: string = 'test@example.com',
  db: typeof dbHttp = dbHttp
): Promise<TestUser> {
  // Generate unique email to avoid conflicts
  const uniqueEmail = `test-${Date.now()}-${Math.random().toString(36).substring(7)}@example.com`;

  // Generate UUID for user
  const userId = randomUUID();

  // Create test user
  const [user] = await db
    .insert(schema.users)
    .values({
      id: userId,
      email: uniqueEmail,
      name: 'Test User',
      emailVerified: true,
      image: null,
    })
    .returning();

  if (!user) {
    throw new Error('Failed to create test user');
  }

  // Generate session token and ID
  const sessionId = randomUUID();
  const sessionToken = `test-session-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  // Create session with 24 hour expiration
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const [session] = await db
    .insert(schema.sessions)
    .values({
      id: sessionId,
      userId: user.id,
      token: sessionToken,
      expiresAt,
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
    })
    .returning();

  if (!session) {
    throw new Error('Failed to create test session');
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
      image: user.image,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    session: {
      id: session.id,
      userId: session.userId,
      token: session.token,
      expiresAt: session.expiresAt,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    },
    sessionToken,
  };
}

/**
 * Cleans up test user and associated sessions from database
 *
 * SECURITY: Cascade delete is configured in schema, so deleting
 * the user will automatically delete associated sessions.
 *
 * @param userId - User ID to clean up
 */
export async function cleanupTestUser(
  userId: string,
  db: typeof dbHttp = dbHttp
): Promise<void> {
  // Delete sessions first (foreign key constraint)
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));

  // Delete user
  await db.delete(schema.users).where(eq(schema.users.id, userId));
}

/**
 * Creates a Request with authentication cookie
 *
 * Helper to create authenticated requests for integration tests.
 *
 * @param url - Request URL
 * @param sessionToken - Session token from createTestUser()
 * @param options - Additional RequestInit options
 * @returns Request with authentication cookie
 *
 * @example
 * ```typescript
 * const testUser = await createTestUser();
 * const req = createAuthenticatedRequest(
 *   'http://localhost/api/content',
 *   testUser.sessionToken,
 *   {
 *     method: 'POST',
 *     body: JSON.stringify({ title: 'Test' }),
 *   }
 * );
 * ```
 */
export function createAuthenticatedRequest(
  url: string,
  sessionToken: string,
  options: RequestInit = {}
): Request {
  return new Request(url, {
    ...options,
    headers: {
      ...options.headers,
      Cookie: `codex-session=${sessionToken}`,
    },
  });
}
