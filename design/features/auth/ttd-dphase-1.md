# Authentication & Authorization - Phase 1 TDD (Technical Design Document)

**See [EVOLUTION.md](./EVOLUTION.md) for complete architecture vision and Phase 1→4 roadmap.**
**See [PHASE_1_AUTH_DESIGN.md](../../PHASE_1_AUTH_DESIGN.md) for detailed implementation guide.**

## System Overview

Phase 1 authentication provides secure user identity management and organization-based authorization using BetterAuth with:

- **Primary Storage**: Neon Postgres (users, sessions, organization members, invitations)
- **Session Caching**: Cloudflare KV (high-performance session lookups with organization context)
- **Email Delivery**: Notification service abstraction (see [Notifications TDD](../notifications/ttd-dphase-1.md))
- **Authorization**: BetterAuth organization plugin + custom guards + RLS policies (prepared)

**Architecture Principles**:
- BetterAuth handles authentication (login, register, password reset)
- Custom organization module manages teams and invitations
- Session includes `activeOrganizationId` for organization context
- RLS policies designed for Phase 2+ multi-tenant enforcement
- Drizzle ORM manages database schema with future-proof design

**Architecture Diagram**:

![Auth System Architecture](./assets/auth-architecture.png)

The diagram illustrates the complete authentication flow including BetterAuth integration, session caching in Cloudflare KV, organization context in sessions, and the foundation for Phase 2+ multi-tenancy.

---

## Dependencies

See the centralized [Cross-Feature Dependencies](../../cross-feature-dependencies.md#2-auth-authentication--authorization) document for details on dependencies between features.

### Technical Prerequisites

1.  **Drizzle ORM Setup**: Drizzle must be configured with Neon Postgres, as BetterAuth requires a Drizzle adapter.
2.  **Cloudflare KV Namespace**: The `AUTH_SESSION_KV` namespace must be created and bound for session caching.
3.  **Notification Service**: The email abstraction layer must be implemented for sending transactional emails.

---

## Component List

### 1. BetterAuth Core (`packages/web/src/lib/server/auth.ts`)

**Responsibility**: Initialize and configure BetterAuth with Drizzle adapter and Cloudflare KV secondary storage

**Configuration**:

```typescript
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import { notificationService } from '$lib/server/notifications';

export const auth = betterAuth({
  // Database: Drizzle + Neon Postgres
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

  // Secondary Storage: Cloudflare KV for session caching
  // Note: Configured per-request in hooks (see Component #2)

  // Session Configuration
  session: {
    expiresIn: 60 * 60 * 24, // 24 hours
    updateAge: 60 * 60 * 24, // Update session every 24 hours
    cookieName: 'codex-session',

    // Cookie caching: store session data in signed cookie (fallback if KV unavailable)
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes (short-lived)
    },
  },

  // Email Sender: Use notification abstraction (NOT direct Resend)
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,

    sendVerificationEmail: async ({ user, url }) => {
      await notificationService.sendEmail({
        template: 'email-verification',
        recipient: user.email,
        data: {
          userName: user.name,
          verificationUrl: url,
        },
      });
    },

    sendResetPasswordEmail: async ({ user, url }) => {
      await notificationService.sendEmail({
        template: 'password-reset',
        recipient: user.email,
        data: {
          userName: user.name,
          resetUrl: url,
        },
      });
    },
  },

  // User Schema: Extend with custom fields
  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: true,
        defaultValue: 'customer',
        // Enum: 'customer' | 'owner' | 'creator' (Phase 3)
      },
    },
  },

  // Security
  secret: process.env.AUTH_SECRET, // 32+ character random string
  baseURL: process.env.AUTH_URL, // http://localhost:5173 (dev) or https://yourdomain.com (prod)

  // Trusted origins (CORS)
  trustedOrigins: [process.env.AUTH_URL],
});

// Export types for use in app
export type { Session, User } from 'better-auth';
```

**Key Design Decisions**:

-  **Drizzle Adapter**: Native integration with our ORM
-  **Cookie Cache Fallback**: If KV unavailable, uses signed cookies (5min cache)
-  **User Role Extension**: Add `role` field to BetterAuth's user schema
-  **Email Abstraction**: All emails via notification service (easy to swap providers)

---

### 2. Server Hooks Middleware (`packages/web/src/hooks.server.ts`)

**Responsibility**:

1. Mount BetterAuth handler
2. Populate `event.locals` with session/user data
3. Use Cloudflare KV for session caching

**Implementation**:

```typescript
import { auth } from '$lib/server/auth';
import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit';

// Handle 1: Mount BetterAuth API routes
const authHandler: Handle = async ({ event, resolve }) => {
  // BetterAuth handles /api/auth/* routes
  return auth.handler(event.request);
};

// Handle 2: Session validation with KV caching
const sessionHandler: Handle = async ({ event, resolve }) => {
  const sessionCookie = event.cookies.get('codex-session');

  if (!sessionCookie) {
    // No session cookie
    event.locals.session = null;
    event.locals.user = null;
    return resolve(event);
  }

  // Try to get session from Cloudflare KV (fast)
  const kv = event.platform?.env?.AUTH_SESSION_KV;

  if (kv) {
    const cachedSession = await kv.get(`session:${sessionCookie}`, 'json');

    if (cachedSession) {
      // Cache hit! No database query needed
      event.locals.session = cachedSession.session;
      event.locals.user = cachedSession.user;
      return resolve(event);
    }
  }

  // Cache miss (or KV unavailable): fetch from database via BetterAuth
  try {
    const session = await auth.api.getSession({
      headers: event.request.headers,
    });

    if (session) {
      event.locals.session = session;
      event.locals.user = session.user;

      // Store in KV for next request (TTL = session expiry)
      if (kv) {
        const ttl = Math.floor(
          (new Date(session.expiresAt).getTime() - Date.now()) / 1000
        );
        await kv.put(
          `session:${sessionCookie}`,
          JSON.stringify({ session, user: session.user }),
          { expirationTtl: ttl }
        );
      }
    } else {
      event.locals.session = null;
      event.locals.user = null;
    }
  } catch (error) {
    console.error('Session validation error:', error);
    event.locals.session = null;
    event.locals.user = null;
  }

  return resolve(event);
};

// Compose handlers
export const handle = sequence(authHandler, sessionHandler);
```

**Performance**:

- **Cache Hit** (KV): ~5-10ms (no DB query)
- **Cache Miss**: ~50-100ms (DB query + cache population)
- **Cache Hit Rate**: Expected >95% after warmup

**Design Notes**:

-  Cloudflare KV used as **read-through cache**
-  Automatic cache invalidation via TTL (matches session expiry)
-  Graceful degradation: works without KV (falls back to DB)
-  User role stored in cached session data (no additional DB query needed)

---

### 3. Route Guards (`packages/web/src/lib/server/guards.ts`)

**Responsibility**: Reusable authorization checks for protecting routes

**Implementation**:

```typescript
import { redirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Require user to be authenticated
 * Redirects to /login if not authenticated
 */
export function requireAuth(event: RequestEvent) {
  if (!event.locals.user) {
    throw redirect(
      303,
      `/login?redirect=${encodeURIComponent(event.url.pathname)}`
    );
  }
  return event.locals.user;
}

/**
 * Require user to be Platform Owner
 * Redirects to /library if not owner
 */
export function requireOwner(event: RequestEvent) {
  const user = requireAuth(event);
  if (user.role !== 'owner') {
    throw redirect(303, '/library?error=unauthorized');
  }
  return user;
}

/**
 * Require email to be verified
 * Redirects to /verify-email if not verified
 */
export function requireVerifiedEmail(event: RequestEvent) {
  const user = requireAuth(event);
  if (!user.emailVerified) {
    throw redirect(303, '/verify-email?prompt=true');
  }
  return user;
}

/**
 * Future-proof: Support for Media Owner role (Phase 3)
 * Require user to be Owner or Creator
 */
export function requireCreatorAccess(event: RequestEvent) {
  const user = requireAuth(event);
  if (user.role !== 'owner' && user.role !== 'creator') {
    throw redirect(303, '/library?error=unauthorized');
  }
  return user;
}

/**
 * Optional auth: populate user if available, but don't require
 */
export function optionalAuth(event: RequestEvent) {
  return event.locals.user || null;
}
```

**Usage in Route Handlers**:

```typescript
// Example: Admin route
// src/routes/admin/+page.server.ts
import { requireOwner } from '$lib/server/guards';

export async function load(event) {
  const user = requireOwner(event);

  // User is guaranteed to be authenticated and owner role
  // ... load admin data
}
```

---

### 4. Client-Side Auth Store (`packages/web/src/lib/stores/auth.ts`)

**Responsibility**: Reactive Svelte store for auth state (client-side)

**Implementation**:

```typescript
import { writable, derived } from 'svelte/store';
import type { User, Session } from '$lib/server/auth';

// Store state
interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
}

function createAuthStore() {
  const { subscribe, set, update } = writable<AuthState>({
    user: null,
    session: null,
    loading: true,
  });

  return {
    subscribe,

    // Initialize from page data (SSR)
    init(user: User | null, session: Session | null) {
      set({ user, session, loading: false });
    },

    // Update user data
    setUser(user: User | null) {
      update((state) => ({ ...state, user }));
    },

    // Clear auth state (logout)
    clear() {
      set({ user: null, session: null, loading: false });
    },

    // Refresh session from server
    async refresh() {
      update((state) => ({ ...state, loading: true }));

      try {
        const response = await fetch('/api/auth/session');
        if (response.ok) {
          const { user, session } = await response.json();
          set({ user, session, loading: false });
        } else {
          set({ user: null, session: null, loading: false });
        }
      } catch (error) {
        console.error('Failed to refresh session:', error);
        set({ user: null, session: null, loading: false });
      }
    },
  };
}

export const authStore = createAuthStore();

// Derived stores for convenience
export const user = derived(authStore, ($auth) => $auth.user);
export const session = derived(authStore, ($auth) => $auth.session);
export const isAuthenticated = derived(authStore, ($auth) => !!$auth.user);
export const isOwner = derived(
  authStore,
  ($auth) => $auth.user?.role === 'owner'
);
export const isCustomer = derived(
  authStore,
  ($auth) => $auth.user?.role === 'customer'
);
export const isCreator = derived(
  authStore,
  ($auth) => $auth.user?.role === 'creator'
); // Phase 3
```

**Usage in Components**:

```svelte
<script>
  import { authStore, isAuthenticated, isOwner } from '$lib/stores/auth';
  import { page } from '$app/stores';

  // Initialize store from page data (on mount)
  $: authStore.init($page.data.user, $page.data.session);
</script>

{#if $isAuthenticated}
  <p>Welcome, {$authStore.user.name}!</p>

  {#if $isOwner}
    <a href="/admin">Admin Dashboard</a>
  {/if}

  <button on:click={logout}>Logout</button>
{:else}
  <a href="/login">Login</a>
  <a href="/register">Register</a>
{/if}
```

**Root Layout** (`src/routes/+layout.server.ts`):

```typescript
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  return {
    user: locals.user,
    session: locals.session,
  };
};
```

---

### 5. Authentication Actions

#### Registration (`src/routes/register/+page.server.ts`)

**Flow Diagram**: See [Registration Sequence Diagram](../_assets/auth-registration-sequence.png)

```typescript
import { auth } from '$lib/server/auth';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
  default: async ({ request, cookies }) => {
    const data = await request.formData();
    const email = data.get('email') as string;
    const password = data.get('password') as string;
    const confirmPassword = data.get('confirmPassword') as string;
    const name = data.get('name') as string;

    // Validation
    if (!email || !password || !name) {
      return fail(400, { error: 'All fields are required' });
    }

    if (password !== confirmPassword) {
      return fail(400, { error: 'Passwords do not match' });
    }

    if (password.length < 8) {
      return fail(400, { error: 'Password must be at least 8 characters' });
    }

    try {
      // Create user via BetterAuth
      const result = await auth.api.signUpEmail({
        email,
        password,
        name,
        role: 'customer', // Default role
      });

      // BetterAuth automatically:
      // 1. Hashes password
      // 2. Stores user in database
      // 3. Generates verification token
      // 4. Sends verification email (via our emailSender config)
      // 5. Creates session

      // Set session cookie
      cookies.set('codex-session', result.session.token, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30, // 30 days
      });

      // Redirect to verification prompt
      throw redirect(303, '/verify-email?new=true');
    } catch (error) {
      if (error.code === 'USER_EXISTS') {
        return fail(400, {
          error: 'An account with this email already exists',
        });
      }

      console.error('Registration error:', error);
      return fail(500, { error: 'Registration failed. Please try again.' });
    }
  },
};
```

#### Login (`src/routes/login/+page.server.ts`)

**Flow Diagram**: See [Login Sequence Diagram](../_assets/auth-login-sequence.png)

```typescript
import { auth } from '$lib/server/auth';
import { fail, redirect } from '@sveltejs/kit';
import { rateLimit } from '$lib/server/rateLimit';
import type { Actions } from './$types';

export const actions: Actions = {
  default: async ({ request, cookies, getClientAddress, platform, url }) => {
    const data = await request.formData();
    const email = data.get('email') as string;
    const password = data.get('password') as string;
    const rememberMe = data.get('rememberMe') === 'on';

    // Rate limiting (see Security/RateLimiting.md)
    const kv = platform?.env?.AUTH_SESSION_KV;
    if (kv) {
      const ip = getClientAddress();
      const limitResult = await rateLimit(kv, ip, {
        limit: 5,
        window: 900, // 15 minutes
        keyPrefix: 'rl:login:',
      });

      if (!limitResult.allowed) {
        return fail(429, {
          error: 'Too many login attempts. Please try again in 15 minutes.',
        });
      }
    }

    if (!email || !password) {
      return fail(400, { error: 'Email and password are required' });
    }

    try {
      // Authenticate via BetterAuth
      const result = await auth.api.signInEmail({
        email,
        password,
      });

      // Set session cookie
      const maxAge = rememberMe ? 60 * 60 * 24 * 30 : undefined; // 30 days or session
      cookies.set('codex-session', result.session.token, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge,
      });

      // Redirect based on role
      const redirectTo =
        url.searchParams.get('redirect') || getDefaultRoute(result.user.role);
      throw redirect(303, redirectTo);
    } catch (error) {
      // Generic error (don't reveal if user exists)
      return fail(400, { error: 'Invalid email or password' });
    }
  },
};

function getDefaultRoute(role: string): string {
  switch (role) {
    case 'owner':
      return '/admin';
    case 'creator':
      return '/creator-dashboard'; // Phase 3
    case 'customer':
    default:
      return '/library';
  }
}
```

#### Password Reset Request (`src/routes/forgot-password/+page.server.ts`)

```typescript
import { auth } from '$lib/server/auth';
import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
  default: async ({ request }) => {
    const data = await request.formData();
    const email = data.get('email') as string;

    if (!email) {
      return fail(400, { error: 'Email is required' });
    }

    try {
      // BetterAuth handles:
      // 1. Check if user exists
      // 2. Generate reset token
      // 3. Send email (via our emailSender config)
      await auth.api.forgetPassword({ email });

      // ALWAYS return success (prevent user enumeration)
      return {
        success: true,
        message:
          'If an account exists with this email, a password reset link has been sent.',
      };
    } catch (error) {
      // Still return success (security)
      return {
        success: true,
        message:
          'If an account exists with this email, a password reset link has been sent.',
      };
    }
  },
};
```

#### Password Reset (`src/routes/reset-password/+page.server.ts`)

```typescript
import { auth } from '$lib/server/auth';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
  const token = url.searchParams.get('token');

  if (!token) {
    throw redirect(303, '/forgot-password?error=missing-token');
  }

  return { token };
};

export const actions: Actions = {
  default: async ({ request, url, platform }) => {
    const data = await request.formData();
    const token = url.searchParams.get('token') as string;
    const password = data.get('password') as string;
    const confirmPassword = data.get('confirmPassword') as string;

    if (!password || !confirmPassword) {
      return fail(400, { error: 'All fields are required' });
    }

    if (password !== confirmPassword) {
      return fail(400, { error: 'Passwords do not match' });
    }

    if (password.length < 8) {
      return fail(400, { error: 'Password must be at least 8 characters' });
    }

    try {
      // BetterAuth handles:
      // 1. Validate token
      // 2. Hash new password
      // 3. Update user record
      // 4. Invalidate token
      // 5. Invalidate all existing sessions
      await auth.api.resetPassword({
        token,
        password,
      });

      // Invalidate KV session cache for this user
      // (sessions already invalidated in DB by BetterAuth)
      const kv = platform?.env?.AUTH_SESSION_KV;
      if (kv) {
        // Get user sessions from DB and delete from KV
        // (BetterAuth already deleted from DB, we just clean cache)
        // This is handled automatically by TTL, but we can force it for immediate effect
      }

      throw redirect(303, '/login?message=password-reset-success');
    } catch (error) {
      if (error.code === 'INVALID_TOKEN') {
        return fail(400, {
          error: 'This password reset link is invalid or expired',
        });
      }

      console.error('Password reset error:', error);
      return fail(500, { error: 'Password reset failed. Please try again.' });
    }
  },
};
```

#### Email Verification (`src/routes/verify-email/+page.server.ts`)

```typescript
import { auth } from '$lib/server/auth';
import { fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ url }) => {
  const token = url.searchParams.get('token');

  if (!token) {
    return { needsVerification: true };
  }

  try {
    // Verify email via BetterAuth
    await auth.api.verifyEmail({ token });

    throw redirect(303, '/library?message=email-verified');
  } catch (error) {
    if (error.code === 'INVALID_TOKEN') {
      return {
        error: 'This verification link is invalid or expired',
        canResend: true,
      };
    }

    return {
      error: 'Verification failed. Please try again.',
      canResend: true,
    };
  }
};

// Action to resend verification email
export const actions: Actions = {
  resend: async ({ locals }) => {
    if (!locals.user) {
      return fail(401, { error: 'You must be logged in' });
    }

    if (locals.user.emailVerified) {
      return fail(400, { error: 'Your email is already verified' });
    }

    try {
      await auth.api.sendVerificationEmail({
        email: locals.user.email,
      });

      return { success: true, message: 'Verification email sent' };
    } catch (error) {
      return fail(500, { error: 'Failed to send verification email' });
    }
  },
};
```

#### Logout (`src/routes/logout/+server.ts`)

```typescript
import { auth } from '$lib/server/auth';
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies, locals, platform }) => {
  const sessionToken = cookies.get('codex-session');

  if (sessionToken && locals.session) {
    // Invalidate session in database
    await auth.api.signOut({
      sessionId: locals.session.id,
    });

    // Remove from KV cache
    const kv = platform?.env?.AUTH_SESSION_KV;
    if (kv) {
      await kv.delete(`session:${sessionToken}`);
    }
  }

  // Clear cookie
  cookies.delete('codex-session', { path: '/' });

  throw redirect(303, '/');
};
```

---

## API Contracts / Interfaces

**Type Definitions** (`packages/shared-types/src/auth.ts`):

```typescript
export type UserRole = 'customer' | 'owner' | 'creator';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Session {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuthLocals {
  user: User | null;
  session: Session | null;
}
```

**SvelteKit App.Locals** (`packages/web/src/app.d.ts`):

```typescript
import type { User, Session } from '@codex/shared-types/auth';

declare global {
  namespace App {
    interface Locals {
      user: User | null;
      session: Session | null;
    }

    interface Platform {
      env?: {
        AUTH_SESSION_KV: KVNamespace;
        // ... other KV namespaces
      };
    }
  }
}

export {};
```

---

## Data Models / Schema

**Schema Definition** (`packages/web/src/lib/server/db/schema/auth.ts`):

```typescript
import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  pgEnum,
} from 'drizzle-orm/pg-core';

// User roles enum
export const userRoleEnum = pgEnum('user_role', [
  'customer',
  'owner',
  'creator',
]);

// Users table (extended by BetterAuth)
export const users = pgTable('user', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  emailVerified: boolean('emailVerified').default(false),
  name: varchar('name', { length: 255 }).notNull(),
  role: userRoleEnum('role').default('customer').notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
});

// Sessions table (managed by BetterAuth)
export const sessions = pgTable('session', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('userId')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  token: varchar('token', { length: 255 }).unique().notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  ipAddress: varchar('ipAddress', { length: 45 }),
  userAgent: varchar('userAgent', { length: 500 }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
});

// Verification tokens (managed by BetterAuth)
export const verificationTokens = pgTable('verification', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('userId')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  token: varchar('token', { length: 255 }).unique().notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
});
```

**Note**: BetterAuth CLI (`npx @better-auth/cli generate`) can generate these schemas automatically. The above is for reference.

---

## Third-Party Integrations

### BetterAuth

- **Version**: Latest (check compatibility with SvelteKit 2.x)
- **Adapter**: Drizzle ORM
- **Installation**: `pnpm add better-auth`

### Cloudflare KV

- **Purpose**: Session caching (secondary storage)
- **Namespace**: `AUTH_SESSION_KV`
- **Key Format**: `session:{sessionToken}`
- **Value**: `{ session: Session, user: User }`
- **TTL**: Matches session expiry

### Notification Service

- **Purpose**: Send transactional emails
- **Integration**: Via abstraction layer
- **See**: [Notifications TDD](../notifications/ttd-dphase-1.md)

---

## Scaling / Reliability

### Session Performance

| Scenario            | Response Time | DB Queries |
| ------------------- | ------------- | ---------- |
| Cache Hit (KV)      | ~5-10ms       | 0          |
| Cache Miss          | ~50-100ms     | 1          |
| No Cache (fallback) | ~50-100ms     | 1          |

**Expected Cache Hit Rate**: >95% after warmup

### Session Invalidation Strategy

- **Logout**: Delete from DB + delete from KV
- **Password Change**: BetterAuth invalidates all sessions in DB + KV entries expire naturally via TTL
- **Session Expiry**: TTL in KV matches session expiry (automatic cleanup)

### High Availability

- **Neon Postgres**: Automatic failover, connection pooling
- **Cloudflare KV**: Globally distributed, no single point of failure
- **Graceful Degradation**: If KV unavailable, falls back to database queries

---

## Testing Strategy

See [Testing Strategy](../../infrastructure/TestingStrategy.md) for full details.

### Unit Tests

```typescript
// guards.test.ts
describe('requireAuth', () => {
  it('returns user if authenticated', () => {
    const event = { locals: { user: mockUser() }, url: { pathname: '/admin' } };
    expect(requireAuth(event)).toEqual(mockUser());
  });

  it('redirects to login if not authenticated', () => {
    const event = { locals: { user: null }, url: { pathname: '/admin' } };
    expect(() => requireAuth(event)).toThrow();
  });
});
```

### Integration Tests

```typescript
// login.integration.test.ts
describe('POST /login', () => {
  it('creates session on successful login', async () => {
    await createTestUser({
      email: 'test@example.com',
      password: 'Password123',
    });

    const response = await POST({
      request: new Request('http://localhost/login', {
        method: 'POST',
        body: formData({ email: 'test@example.com', password: 'Password123' }),
      }),
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('set-cookie')).toContain('codex-session');
  });
});
```

### E2E Tests

```typescript
// auth.spec.ts (Playwright)
test('user can register, verify, and login', async ({ page }) => {
  // ... (see PRD for full E2E test examples)
});
```

---

## Security Considerations

### Session Security

-  HTTP-only cookies (no JS access)
-  Secure flag in production (HTTPS only)
-  SameSite=Lax (CSRF protection)
-  KV cache invalidation on logout/password change

### Rate Limiting

-  Login: 5 attempts / 15 minutes
-  Registration: 3 attempts / 1 hour
-  See [Rate Limiting Strategy](../../security/RateLimiting.md)

### Password Security

-  BetterAuth handles hashing (bcrypt/argon2)
-  Minimum 8 characters, complexity requirements
-  Never logged or displayed

---

## Related Documents

- **PRD**: [Auth Phase 1 PRD](./pdr-phase-1.md)
- **Cross-Feature Dependencies**:
  - [Notifications TDD](../notifications/ttd-dphase-1.md) - Email abstraction
  - [Drizzle Setup](../../infrastructure/DatabaseSetup.md) - Required first
  - [Cloudflare Setup](../../infrastructure/CloudflareSetup.md) - KV namespace
- **Security**:
  - [Rate Limiting Strategy](../../security/RateLimiting.md)
- **Infrastructure**:
  - [Testing Strategy](../../infrastructure/TestingStrategy.md)
  - [Database Schema](../../infrastructure/DatabaseSchema.md)

---

**Document Version**: 1.0
**Last Updated**: 2025-10-20
**Status**: Draft - Awaiting Review
