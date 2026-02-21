/**
 * E2E Authentication Helper
 *
 * Provides persistent test users with reusable session tokens for E2E testing.
 * Creates users and sessions directly in the database for use with Playwright.
 *
 * This approach:
 * - Creates real users and sessions in the database
 * - Generates valid session tokens that SvelteKit will recognize
 * - Caches session tokens locally for fast subsequent test runs
 * - Supports parallel test execution with multiple test users
 * - Works independently of Vitest (no test-utils dependency issues)
 */

import * as crypto from 'node:crypto';
import { randomBytes, scrypt } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { COOKIES } from '@codex/constants';
import { createDbClient, schema } from '@codex/database';

const TOKENS_FILE = path.join(process.cwd(), '.e2e-tokens.json');
const NUM_TEST_USERS = 10;

// Session expiration buffer (1 minute) to ensure tokens are still valid
const EXPIRY_BUFFER_MS = 60 * 1000;
// Session duration: 24 hours (matches BetterAuth config)
const SESSION_EXPIRY_MS = 60 * 60 * 24 * 1000;

/**
 * Stored token data for a test user
 */
export interface StoredToken {
  userId: string;
  email: string;
  name: string;
  token: string;
  expiresAt: string;
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
  }>;
}

/**
 * Token store file structure
 */
interface TokensStore {
  users: StoredToken[];
  lastUpdated: string;
}

/**
 * Get environment variable with error handling
 */
function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Required environment variable ${key} is not set. ` +
        `Please set it in your environment or .env file.`
    );
  }
  return value;
}

/**
 * Generate a consistent UUID for a test user based on index
 *
 * This ensures that the same test user always gets the same ID,
 * allowing tokens to be reused across test runs.
 */
function getTestUserId(index: number): string {
  // Generate a UUID v5 using a namespace UUID and the index as a name
  // For simplicity, we'll generate a consistent UUID v4-like string
  // The important part is that it's consistent for the same index
  const hash = crypto
    .createHash('sha256')
    .update(`e2e-test-user-${index}`)
    .digest('hex');
  return `e2e_${hash.substring(0, 27)}`; // UUID-like format: 32 hex chars
}

/**
 * Generate a random session token
 */
function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Hash a password using bcrypt (compatible with BetterAuth)
 *
 * Note: This is a simplified implementation for test purposes.
 * BetterAuth uses bcrypt with 10 rounds.
 */
async function hashPassword(password: string): Promise<string> {
  // For test purposes, we use scrypt as a simpler alternative
  // In production, BetterAuth uses bcrypt
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
  return `scrypt:${salt}:${derivedKey.toString('hex')}`;
}

/**
 * Create or update a test user in the database
 */
async function createTestUser(
  db: ReturnType<typeof createDbClient>,
  index: number
) {
  const userId = getTestUserId(index);
  const email = `e2e-test-${index}@example.com`;
  const name = `E2E Test User ${index}`;
  const password = await hashPassword(`TestPassword123-${index}`);

  // Check if user exists
  const existingUser = await db.query.users.findFirst({
    where: (users, { eq }) => eq(users.id, userId),
  });

  if (existingUser) {
    return existingUser;
  }

  // Create new user
  const newUser = {
    id: userId,
    email,
    name,
    emailVerified: true,
    role: 'customer',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await db.insert(schema.users).values(newUser).onConflictDoNothing();

  // Create account with password
  await db
    .insert(schema.accounts)
    .values({
      id: crypto.randomUUID(),
      accountId: userId,
      providerId: 'email',
      userId,
      password,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing();

  return newUser;
}

/**
 * Create a session for a user
 */
async function createSession(
  db: ReturnType<typeof createDbClient>,
  userId: string
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_MS);
  const sessionId = crypto.randomUUID();

  await db.insert(schema.sessions).values({
    id: sessionId,
    userId,
    token,
    expiresAt,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return { token, expiresAt };
}

/**
 * Get or create persistent test users with fresh sessions
 *
 * On first run or when tokens are expired, creates 10 test users in the database
 * and generates session tokens for each. Tokens are cached locally in
 * .e2e-tokens.json for reuse across test runs.
 *
 * @returns Array of stored tokens for all test users
 * @throws Error if database connection fails or user creation fails
 */
export async function getTestUsers(): Promise<StoredToken[]> {
  const now = Date.now();

  // Try to load existing tokens
  if (fs.existsSync(TOKENS_FILE)) {
    try {
      const store: TokensStore = JSON.parse(
        fs.readFileSync(TOKENS_FILE, 'utf-8')
      );

      // Check if tokens are still valid (not expired)
      const validUsers = store.users.filter(
        (u) => new Date(u.expiresAt).getTime() > now + EXPIRY_BUFFER_MS
      );

      if (validUsers.length === NUM_TEST_USERS) {
        // All tokens still valid, reuse them
        return validUsers;
      }

      // Some tokens expired, we'll need to recreate
      console.log(
        `[E2E Auth] ${NUM_TEST_USERS - validUsers.length} expired tokens, refreshing...`
      );
    } catch (error) {
      console.warn(`[E2E Auth] Failed to parse tokens file: ${error}`);
    }
  }

  // Create fresh test users using transaction for consistency
  console.log('[E2E Auth] Creating fresh test users...');

  const db = createDbClient({
    DATABASE_URL: getRequiredEnv('DATABASE_URL'),
    DB_METHOD: process.env.DB_METHOD || 'local',
  });

  const users: StoredToken[] = [];

  for (let i = 1; i <= NUM_TEST_USERS; i++) {
    const _userId = getTestUserId(i);
    const email = `e2e-test-${i}@example.com`;
    const _name = `E2E Test User ${i}`;

    try {
      // Create user (idempotent - will update if exists)
      const user = await createTestUser(db, i);

      // Create session
      const { token, expiresAt } = await createSession(db, user.id);

      // Format cookies for Playwright
      const sessionCookieName = COOKIES.SESSION_NAME;
      const playwrightCookies = [
        {
          name: sessionCookieName,
          value: token,
          domain: 'localhost',
          path: '/',
          httpOnly: true,
          secure: false, // false for localhost
          sameSite: 'Lax' as const,
        },
      ];

      users.push({
        userId: user.id,
        email: user.email,
        name: user.name,
        token,
        expiresAt: expiresAt.toISOString(),
        cookies: playwrightCookies,
      });

      console.log(`[E2E Auth] Created test user: ${email} (${user.id})`);
    } catch (error) {
      console.error(`[E2E Auth] Failed to create test user ${email}:`, error);
      throw error;
    }
  }

  // Save to file for reuse
  const store: TokensStore = {
    users,
    lastUpdated: new Date().toISOString(),
  };

  fs.writeFileSync(TOKENS_FILE, JSON.stringify(store, null, 2));
  console.log(
    `[E2E Auth] Saved ${users.length} test user tokens to ${TOKENS_FILE}`
  );

  return users;
}

/**
 * Get a specific test user by index (1-based)
 *
 * @param index - User index (1-10)
 * @returns Stored token for the requested user
 * @throws Error if index is out of range
 */
export async function getTestUser(index: number): Promise<StoredToken> {
  if (index < 1 || index > NUM_TEST_USERS) {
    throw new Error(
      `Invalid test user index: ${index}. Must be between 1 and ${NUM_TEST_USERS}.`
    );
  }

  const users = await getTestUsers();
  return users[index - 1]; // Convert to 0-based
}

/**
 * Clear cached test user tokens
 *
 * This forces regeneration of tokens on the next test run.
 * Useful when tokens are corrupted or you want fresh sessions.
 */
export function clearTestTokens(): void {
  if (fs.existsSync(TOKENS_FILE)) {
    fs.unlinkSync(TOKENS_FILE);
    console.log('[E2E Auth] Cleared cached test tokens');
  }
}

/**
 * Get the session cookie name from BetterAuth config
 *
 * This should match the cookie name used in production.
 */
export function getSessionCookieName(): string {
  return COOKIES.SESSION_NAME;
}
