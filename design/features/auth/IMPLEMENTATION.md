# Authentication & Authorization - Phase 1 IMPLEMENTATION

**Version**: 1.0
**Last Updated**: 2025-11-04
**Status**: Active Implementation Guide

**Long-Term Vision**: See [EVOLUTION.md](./EVOLUTION.md) for complete Phase 1→4 roadmap and architectural decisions.

---

## 1. Feature Summary

Secure user authentication and organization-based authorization using BetterAuth. Supports email/password registration, login, password reset, and multi-role access control. Phase 1 implements single organization with owner/admin/member roles. Architecture is multi-tenant ready for Phase 2+ growth to multiple organizations and creators.

**Key Capabilities**:
- Email/password authentication with BetterAuth
- Session management with organization context (activeOrganizationId)
- Role-based authorization (Platform Owner, Organization roles, Customer)
- Cloudflare KV session caching for performance
- Email verification and password reset via notification abstraction
- Protected route middleware with guard functions
- Future-proof schema supporting Phase 2+ multi-org without migration

---

## 2. Problem Statement

The platform requires a secure, reliable authentication system that:

- Allows users to create accounts and log in
- Protects sensitive operations (content management, purchases, admin functions)
- Differentiates between Platform Owner (system admin), Organization Owner/Admin (staff), and Customers (end users)
- Handles password recovery securely
- Maintains session state with organization context
- Supports inviting team members to organizations
- Provides foundation for multi-organization expansion (Phase 2+)

Without authentication, the platform cannot:

- Protect admin functionality from unauthorized access
- Track content purchases and access rights
- Manage team member permissions
- Provide personalized user experiences
- Ensure payment security and user accountability
- Support multiple organizations with data isolation

---

## 3. Goals & Success Criteria

### Primary Goals

1. **Secure user registration** - Users can create accounts with email/password
2. **Reliable login** - Users can authenticate and maintain sessions with organization context
3. **Password recovery** - Users can reset forgotten passwords
4. **Role-based access** - System distinguishes Platform Owner, Organization Owner, Admin, and Customer
5. **Session management** - Sessions persist across requests, include organization context, and expire appropriately
6. **Team invitations** - Organization owner can invite staff/creators via email
7. **Multi-tenant foundation** - Code/schema support multi-organization without Phase 2 migration

### Success Metrics

- ✅ User can register with email/password in < 30 seconds
- ✅ User can log in and see authenticated content immediately
- ✅ Password reset email arrives within 60 seconds
- ✅ Sessions persist for 30 days (remember me) or until browser close
- ✅ Unauthorized users cannot access protected routes
- ✅ Platform Owner sees admin UI, Customers do not
- ✅ Zero plaintext passwords stored in database
- ✅ HTTPS-only cookie transmission
- ✅ 100% pass rate on auth unit tests
- ✅ Role system supports adding Creator role without schema migration

### Performance Requirements

- Login response time < 500ms (p95)
- Registration response time < 1s (p95)
- Verification email sent < 60s
- Password reset email sent < 60s
- Session validation < 100ms (cached in locals)

---

## 4. Scope

**See [EVOLUTION.md](./EVOLUTION.md) for complete Phase 1→4 roadmap and architectural decisions.**

### In Scope (Phase 1 MVP)

**Authentication Core**
- ✅ Email/password registration
- ✅ Email verification (confirm email address)
- ✅ Login with email/password
- ✅ Password reset flow (forgot password)
- ✅ Session management with organization context (BetterAuth + KV caching)
- ✅ Logout functionality
- ✅ Basic user profile (name, email)
- ✅ Password strength requirements (min 8 chars, complexity)

**Authorization & Organization**
- ✅ Platform-level roles: `platform_owner` (you) or `customer` (everyone else)
- ✅ Organization-level roles: `owner` (runs org), `admin` (staff), `member` (team members)
- ✅ Protected route middleware with role-based guards
- ✅ Team member invitations via email (7-day expiry)
- ✅ Invitation acceptance flow with secure tokens
- ✅ Session context includes `activeOrganizationId` (foundation for Phase 2 multi-org)

**Database & RLS**
- ✅ Single organization with members
- ✅ Organization invitations table
- ✅ RLS policies designed and documented (enforced Phase 2+)
- ✅ Schema supports unlimited organizations, creators, custom roles (no Phase 2 migration needed)

### Out of Scope (Future Phases)

**Phase 2+**
- ❌ Creator role and multi-organization support
- ❌ Multiple organizations per Platform Owner
- ❌ Organization switching in UI
- ❌ Custom membership tiers
- ❌ Social login (Google, Facebook, Apple)
- ❌ Two-factor authentication (2FA)
- ❌ Magic link authentication
- ❌ Account lockout after failed attempts
- ❌ Session device management

**Phase 3+**
- ❌ Granular permission system (beyond role-based)
- ❌ Custom roles per organization
- ❌ Advanced delegation

**Phase 4+**
- ❌ Single Sign-On (SAML/OIDC)
- ❌ OAuth provider for third-party apps
- ❌ Audit logging
- ❌ Enterprise session policies
- ❌ MFA enforcement

---

## 5. User Stories & Use Cases

### US-AUTH-001: User Registration

**As a** visitor
**I want to** create an account with my email and password
**So that** I can access purchased content and make purchases

**Flow:**

1. User navigates to `/register`
2. User fills form: email, password, confirm password, name
3. User submits form
4. System validates:
   - Email format valid
   - Email not already registered
   - Password meets requirements (8+ chars, 1 uppercase, 1 lowercase, 1 number)
   - Passwords match
5. System creates user record with hashed password, `role: 'customer'`
6. System calls **notification service** to send verification email
7. System creates session and redirects to `/verify-email` prompt
8. User clicks link in email
9. System marks email as verified
10. User redirected to `/library` (or `/admin` if Platform Owner)

**Acceptance Criteria:**

- ✅ User record created in `users` table with correct role
- ✅ Password hashed with bcrypt/argon2
- ✅ Email verification token generated and stored
- ✅ Verification email sent via **notification abstraction** (not direct Resend)
- ✅ User can log in before verification but sees prompt
- ✅ Duplicate email registration blocked with clear error message

**Dependencies:**
- See [Notifications IMPLEMENTATION.md](../notifications/IMPLEMENTATION.md) - Email abstraction

---

### US-AUTH-002: User Login

**As a** registered user
**I want to** log in with my email and password
**So that** I can access my account and purchased content

**Flow:**

1. User navigates to `/login`
2. User fills form: email, password, "remember me" checkbox (optional)
3. User submits form
4. BetterAuth validates credentials against Neon database
5. If valid:
   - Create session record in database
   - Set secure HTTP-only cookie with session ID
   - Populate `event.locals.user` with `{ id, email, name, role }`
   - Redirect based on role:
     - `role: 'owner'` → `/admin`
     - `role: 'customer'` → `/library`
     - (Future) `role: 'creator'` → `/creator-dashboard` (Phase 3)
6. If invalid:
   - Show error: "Invalid email or password"
   - Do not reveal which field is incorrect (security)

**Acceptance Criteria:**

- ✅ Successful login redirects to appropriate dashboard based on role
- ✅ Session cookie is HTTP-only, Secure, SameSite=Lax
- ✅ "Remember me" extends session to 30 days (default: session)
- ✅ Failed login shows generic error (no user enumeration)
- ✅ Maximum 5 login attempts before 15-minute cooldown (basic rate limit)
- ✅ `event.locals.user.role` correctly reflects database value

---

### US-AUTH-003: Password Reset

**As a** registered user
**I want to** reset my password if I forget it
**So that** I can regain access to my account

**Flow:**

1. User clicks "Forgot password?" on `/login`
2. User navigates to `/forgot-password`
3. User enters email address
4. User submits form
5. System:
   - Looks up user by email
   - If found: generates reset token (UUID, expires in 1 hour)
   - If not found: still shows success message (prevent enumeration)
   - Calls **notification service** to send reset email with link: `/reset-password?token=<TOKEN>`
6. User clicks link in email
7. User navigates to `/reset-password?token=<TOKEN>`
8. System validates token (exists, not expired, not used)
9. User enters new password and confirms
10. User submits form
11. System:
    - Validates password requirements
    - Hashes new password
    - Updates user record
    - Invalidates reset token
    - Invalidates all existing sessions (force re-login)
    - Calls **notification service** to send "Password Changed" confirmation email
12. User redirected to `/login` with success message

**Acceptance Criteria:**

- ✅ Reset email sent within 60 seconds via notification service
- ✅ Reset link expires after 1 hour
- ✅ Reset link single-use only (cannot reuse token)
- ✅ All user sessions invalidated after password change
- ✅ Generic success message shown even if email not found
- ✅ New password meets all strength requirements
- ✅ Confirmation email sent after successful password change

---

### US-AUTH-004: Email Verification

**As a** newly registered user
**I want to** verify my email address
**So that** the platform knows I own this email and can send me important notifications

**Flow:**

1. User registers (see US-AUTH-001)
2. System calls **notification service** to send email with verification link: `/verify-email?token=<TOKEN>`
3. User checks email and clicks link
4. System validates token (exists, not expired, not used)
5. System marks user.email_verified = true
6. System invalidates verification token
7. User redirected to `/library` with success message

**Acceptance Criteria:**

- ✅ Verification email sent immediately after registration
- ✅ Token expires after 24 hours
- ✅ Token is single-use
- ✅ User can request new verification email if expired
- ✅ Unverified users can still log in but see banner: "Please verify your email"
- ✅ Certain actions (making purchases) may require verified email

---

### US-AUTH-005: Protected Routes

**As a** Platform Owner
**I want** admin routes to be inaccessible to regular customers
**So that** only I can manage content and platform settings

**Flow:**

1. User (any role) attempts to access `/admin/*` route
2. SvelteKit `hooks.server.ts` middleware runs:
   - Calls `BetterAuth.getSession()` to check authentication
   - Populates `event.locals.user` and `event.locals.session`
3. If user is not authenticated:
   - Redirect to `/login?redirect=/admin/...`
4. If user is authenticated but role != 'owner':
   - Redirect to `/library` with error message
5. If user is authenticated and role == 'owner':
   - Allow request to proceed

**Acceptance Criteria:**

- ✅ All `/admin/*` routes require authentication
- ✅ All `/admin/*` routes require `role: 'owner'`
- ✅ Unauthenticated users redirected to login with return URL
- ✅ Non-owner users redirected to library with clear error message
- ✅ Middleware runs on every request (server-side protection)
- ✅ Client-side also hides admin links for non-owners
- ✅ **Extensible**: Middleware design allows adding role-specific routes (e.g., `/creator/*` for Phase 3)

---

### US-AUTH-006: Logout

**As a** logged-in user
**I want to** log out of my account
**So that** I can end my session on shared/public devices

**Flow:**

1. User clicks "Log out" button (in header/menu)
2. System:
   - Calls BetterAuth logout method
   - Deletes session from database
   - Clears session cookie
3. User redirected to `/` (homepage)

**Acceptance Criteria:**

- ✅ Session immediately invalidated
- ✅ Session cookie removed from browser
- ✅ User must re-authenticate to access protected routes
- ✅ Logout works even if session already expired

---

## 6. Technical Architecture

### System Overview

Phase 1 authentication provides secure user identity management and organization-based authorization using BetterAuth with:

- **Primary Storage**: Neon Postgres (users, sessions, organization members, invitations)
- **Session Caching**: Cloudflare KV (high-performance session lookups with organization context)
- **Email Delivery**: Notification service abstraction
- **Authorization**: BetterAuth organization plugin + custom guards + RLS policies (prepared)

**Architecture Principles**:
- BetterAuth handles authentication (login, register, password reset)
- Custom organization module manages teams and invitations
- Session includes `activeOrganizationId` for organization context
- RLS policies designed for Phase 2+ multi-tenant enforcement
- Drizzle ORM manages database schema with future-proof design

**Architecture Diagram**:

![Auth System Architecture](./d2-diagrams/auth-architecture.png)

The diagram illustrates the complete authentication flow including BetterAuth integration, session caching in Cloudflare KV, organization context in sessions, and the foundation for Phase 2+ multi-tenancy.

### Component Architecture

#### 1. BetterAuth Core (`packages/web/src/lib/server/auth.ts`)

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

- ✅ **Drizzle Adapter**: Native integration with our ORM
- ✅ **Cookie Cache Fallback**: If KV unavailable, uses signed cookies (5min cache)
- ✅ **User Role Extension**: Add `role` field to BetterAuth's user schema
- ✅ **Email Abstraction**: All emails via notification service (easy to swap providers)

---

#### 2. Server Hooks Middleware (`packages/web/src/hooks.server.ts`)

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

- ✅ Cloudflare KV used as **read-through cache**
- ✅ Automatic cache invalidation via TTL (matches session expiry)
- ✅ Graceful degradation: works without KV (falls back to DB)
- ✅ User role stored in cached session data (no additional DB query needed)

---

#### 3. Route Guards (`packages/web/src/lib/server/guards.ts`)

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
 * Future-proof: Support for Creator role (Phase 3)
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

#### 4. Client-Side Auth Store (`packages/web/src/lib/stores/auth.ts`)

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

---

## 7. Database Schema

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

## 8. API Specification

### Type Definitions (`packages/shared-types/src/auth.ts`)

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

### SvelteKit App.Locals (`packages/web/src/app.d.ts`)

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

### BetterAuth API Endpoints

BetterAuth automatically provides these endpoints at `/api/auth/*`:

- `POST /api/auth/sign-up/email` - Email/password registration
- `POST /api/auth/sign-in/email` - Email/password login
- `POST /api/auth/sign-out` - Logout
- `POST /api/auth/forget-password` - Request password reset
- `POST /api/auth/reset-password` - Reset password with token
- `POST /api/auth/verify-email` - Verify email with token
- `POST /api/auth/send-verification-email` - Resend verification email
- `GET /api/auth/session` - Get current session

---

## 9. Implementation Details

### Route Implementations

#### Registration (`src/routes/register/+page.server.ts`)

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

    // Rate limiting
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

*(Additional route implementations for password reset, email verification, and logout are similar - see TDD above for complete code)*

---

## 10. Testing Strategy

See [Testing Strategy](/design/infrastructure/Testing.md) for full details.

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

### E2E Tests (Playwright)

```typescript
// auth.spec.ts
test('user can register, verify, and login', async ({ page }) => {
  // Navigate to register page
  await page.goto('/register');

  // Fill out registration form
  await page.fill('[name="name"]', 'Test User');
  await page.fill('[name="email"]', 'test@example.com');
  await page.fill('[name="password"]', 'Password123!');
  await page.fill('[name="confirmPassword"]', 'Password123!');
  await page.click('button[type="submit"]');

  // Should redirect to verification prompt
  await expect(page).toHaveURL('/verify-email?new=true');

  // TODO: Simulate email verification (use test helper to get verification token)

  // Login after verification
  await page.goto('/login');
  await page.fill('[name="email"]', 'test@example.com');
  await page.fill('[name="password"]', 'Password123!');
  await page.click('button[type="submit"]');

  // Should redirect to library
  await expect(page).toHaveURL('/library');
});
```

### Testing Requirements

- ✅ Unit tests for all authentication utilities
- ✅ Integration tests for all auth API routes
- ✅ E2E test for registration → verification → login flow
- ✅ E2E test for password reset flow
- ✅ Security tests for protected routes
- ✅ Test coverage > 90% for auth module
- ✅ Mock notification service in tests (use abstraction interface)

---

## 11. Dependencies

### Internal Dependencies (Phase 1)

- **Neon Postgres**: User and session storage
- **Drizzle ORM**: Database schema and queries - See [Database Schema](/design/infrastructure/DatabaseSchema.md)
- **Notification Service**: Email abstraction for verification and password reset
  - See [Notifications IMPLEMENTATION.md](../notifications/IMPLEMENTATION.md)
  - **Critical**: Must use abstraction, not direct Resend calls
- **SvelteKit**: Server-side rendering, form actions, hooks
- **Cloudflare KV**: Session caching - See [KV Namespaces](/design/infrastructure/KV-Namespaces.md)

### External Dependencies

- **BetterAuth**: Authentication library (v1.x)
  - Handles password hashing (bcrypt/argon2)
  - Session management
  - Cookie security
  - Token generation
- **Resend API** (via notification abstraction): Email delivery
  - Verification emails
  - Password reset emails
  - Password change confirmations

### Cross-Feature Dependencies

See [Cross-Feature Dependencies](/design/cross-feature-dependencies.md#2-auth-authentication--authorization)

**Key Phase 1 Dependencies:**
- **Notifications**: ← Auth sends emails via notification service
- **Database**: ← Auth requires Drizzle + Neon setup
- **Platform Settings**: → Uses auth guards and session context
- **Admin Dashboard**: → Uses auth guards and session context
- **Content Access**: → Uses `activeOrganizationId` for scoping
- **E-Commerce**: → Uses auth for purchase tracking

---

## 12. Security Considerations

### Session Security

- ✅ HTTP-only cookies (no JS access)
- ✅ Secure flag in production (HTTPS only)
- ✅ SameSite=Lax (CSRF protection)
- ✅ KV cache invalidation on logout/password change

### Rate Limiting

- ✅ Login: 5 attempts / 15 minutes
- ✅ Registration: 3 attempts / 1 hour
- ✅ Password reset: 5 attempts / 1 hour
- See [Rate Limiting Strategy](/design/security/RateLimiting.md)

### Password Security

- ✅ BetterAuth handles hashing (bcrypt/argon2)
- ✅ Minimum 8 characters, complexity requirements
- ✅ Never logged or displayed
- ✅ All sessions invalidated on password change

### Token Security

- ✅ Verification tokens expire after 24 hours
- ✅ Password reset tokens expire after 1 hour
- ✅ All tokens are single-use only
- ✅ Tokens use cryptographically secure random generation

### Generic Error Messages

- ✅ Login failure: "Invalid email or password" (no user enumeration)
- ✅ Password reset: "If account exists, email sent" (no user enumeration)
- ✅ Rate limiting: Generic "too many attempts" message

---

## 13. Scaling & Performance

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

## 14. Design Decisions & Rationale

### Why BetterAuth?

- Modern, secure authentication library for SvelteKit
- Handles password hashing with secure algorithms
- Built-in session management
- Postgres adapter available
- Active development and community
- Less complex than Auth.js for our needs

### Why Email Verification?

- Confirms user owns the email address
- Reduces spam registrations
- Enables password recovery
- Required for transactional emails (purchases, receipts)
- Can be deferred (user can log in before verifying)

### Why Role Enum (Not Boolean)?

- **Extensibility**: Can add `'creator'` role in Phase 3 without schema migration
- **Clarity**: `role: 'owner'` is more explicit than `is_admin: true`
- **Future-proof**: Easier to add more roles (e.g., `'moderator'`, `'support'`)

### Notification Abstraction (Critical Design Decision)

**Problem**: Direct dependency on Resend creates vendor lock-in
**Solution**: All email sending goes through notification service abstraction:

```typescript
// ❌ BAD: Direct Resend call
await resend.emails.send({ to, subject, html });

// ✅ GOOD: Notification abstraction
await notificationService.sendEmail({
  template: 'verification',
  recipient: user.email,
  data: { verificationLink },
});
```

**Benefits**:

- Easy to switch email providers (Resend → SendGrid, Postmark, etc.)
- Centralized email logic (templates, logging, error handling)
- Testable (mock notification service in tests)
- See [Notifications IMPLEMENTATION.md](../notifications/IMPLEMENTATION.md) for details

---

## 15. Future Extensibility

### Phase 2: Multi-Organization Support

The Phase 1 architecture is designed to support Phase 2+ multi-organization features without migration:

- **Session Context**: `activeOrganizationId` already included in sessions (unused in Phase 1)
- **Database Schema**: Supports unlimited organizations
- **RLS Policies**: Designed and documented (enforcement in Phase 2)
- **Creator Role**: Schema already includes `creator` role (promoted from `member` in Phase 2)

See [EVOLUTION.md](./EVOLUTION.md) for complete Phase 2+ roadmap.

### Phase 3: Advanced Authorization

- **Custom Permissions**: Granular permission system beyond roles
- **Custom Roles**: Organizations can define custom roles
- **Advanced Delegation**: Temporary permission grants

See [EVOLUTION.md](./EVOLUTION.md) Phase 3 section.

---

## Related Documentation

### Feature Documentation
- [EVOLUTION.md](./EVOLUTION.md) - Complete Phase 1→4 roadmap and architectural vision
- [PHASE_1_AUTH_DESIGN.md](/design/deprecated/PHASE_1_AUTH_DESIGN.md) - Original detailed implementation guide (deprecated, superseded by this document)

### Core Architecture
- [Multi-Tenant Design](/design/core/MULTI_TENANT_DESIGN.md) - Multi-tenant architecture principles
- [Authentication Model](/design/core/AUTHENTICATION_MODEL.md) - Authentication architecture across platform
- [Role Definitions](/design/core/ROLE_DEFINITIONS.md) - Unified role definitions and permissions

### Cross-Feature Dependencies
- [Notifications IMPLEMENTATION.md](../notifications/IMPLEMENTATION.md) - Email abstraction layer
- [Cross-Feature Dependencies](/design/cross-feature-dependencies.md) - How features interact

### Infrastructure
- [Database Schema](/design/infrastructure/DatabaseSchema.md) - Complete schema reference
- [Testing Strategy](/design/infrastructure/Testing.md) - Testing approach and guidelines
- [Rate Limiting](/design/security/RateLimiting.md) - Rate limiting implementation
- [KV Namespaces](/design/infrastructure/KV-Namespaces.md) - Cloudflare KV setup

---

**Document Version**: 1.0
**Last Updated**: 2025-11-04
**Status**: Active - Consolidated from PRD+TDD
