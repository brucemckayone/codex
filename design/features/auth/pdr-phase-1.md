# Authentication & Authorization - Phase 1 PRD

## Feature Summary

Secure user authentication system using BetterAuth with email/password registration, login, password reset, and role-based access control (Platform Owner and Customer roles for MVP, with extensibility for future Media Owner role).

## Problem Statement

The platform requires a secure, reliable authentication system that:

- Allows users to create accounts and log in
- Protects sensitive operations (content management, purchases, admin functions)
- Differentiates between Platform Owners (admins) and Customers (end users)
- Handles password recovery securely
- Maintains session state across requests

Without authentication, the platform cannot:

- Protect admin functionality from unauthorized access
- Track content purchases and access rights
- Provide personalized user experiences
- Ensure payment security and user accountability

## Goals / Success Criteria

### Primary Goals

1. **Secure user registration** - Users can create accounts with email/password
2. **Reliable login** - Users can authenticate and maintain sessions
3. **Password recovery** - Users can reset forgotten passwords
4. **Role-based access** - System distinguishes Platform Owner from Customer
5. **Session management** - Sessions persist across requests and expire appropriately
6. **Extensible design** - Role system accommodates future Media Owner role (Phase 3)

### Success Metrics

-  User can register with email/password in < 30 seconds
-  User can log in and see authenticated content immediately
-  Password reset email arrives within 60 seconds
-  Sessions persist for 30 days (remember me) or until browser close
-  Unauthorized users cannot access protected routes
-  Platform Owner sees admin UI, Customers do not
-  Zero plaintext passwords stored in database
-  HTTPS-only cookie transmission
-  100% pass rate on auth unit tests
-  Role system supports adding Media Owner role without schema migration

## Scope

### In Scope (Phase 1 MVP)

-  Email/password registration
-  Email verification (confirm email address) - See [Notifications PRD](../notifications/pdr-phase-1.md) for email abstraction
-  Login with email/password
-  Password reset flow (forgot password) - Uses notification service
-  Session management (BetterAuth handles cookies)
-  Role-based access control (RBAC):
  - Platform Owner role (`role: 'owner'`)
  - Customer role (`role: 'customer'`)
  - Database schema supports `role` enum with space for `'creator'` (Phase 3)
-  Protected route middleware
-  Logout functionality
-  Basic user profile (name, email)
-  Password strength requirements (min 8 chars, complexity)

### Explicitly Out of Scope (Future Phases)

- L Social login (Google, Facebook, Apple) - Phase 2
- L Two-factor authentication (2FA) - Phase 2
- L Magic link authentication - Phase 2
- L **Media Owner role implementation** - Phase 3 (but schema supports it)
- L Granular permission system (beyond role) - Phase 3
- L Account lockout after failed attempts - Phase 2
- L Session device management (view/revoke sessions) - Phase 2
- L OAuth provider for third-party apps - Phase 4

## Cross-Feature Dependencies

See the centralized [Cross-Feature Dependencies](../../cross-feature-dependencies.md#2-auth-authentication--authorization) document for details.

---

## User Stories & Use Cases

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

- User record created in `users` table with correct role
- Password hashed with bcrypt/argon2
- Email verification token generated and stored
- Verification email sent via **notification abstraction** (not direct Resend)
- User can log in before verification but sees prompt
- Duplicate email registration blocked with clear error message

**Dependencies:**

- [Notifications - Email Abstraction](../notifications/pdr-phase-1.md#email-service-abstraction)

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
     - `role: 'owner'` � `/admin`
     - `role: 'customer'` � `/library`
     - (Future) `role: 'creator'` � `/creator-dashboard` (Phase 3)
6. If invalid:
   - Show error: "Invalid email or password"
   - Do not reveal which field is incorrect (security)

**Acceptance Criteria:**

- Successful login redirects to appropriate dashboard based on role
- Session cookie is HTTP-only, Secure, SameSite=Lax
- "Remember me" extends session to 30 days (default: session)
- Failed login shows generic error (no user enumeration)
- Maximum 5 login attempts before 15-minute cooldown (basic rate limit)
- `event.locals.user.role` correctly reflects database value

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

- Reset email sent within 60 seconds via notification service
- Reset link expires after 1 hour
- Reset link single-use only (cannot reuse token)
- All user sessions invalidated after password change
- Generic success message shown even if email not found
- New password meets all strength requirements
- Confirmation email sent after successful password change

**Dependencies:**

- [Notifications - Email Abstraction](../notifications/pdr-phase-1.md#email-service-abstraction)

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

- Verification email sent immediately after registration
- Token expires after 24 hours
- Token is single-use
- User can request new verification email if expired
- Unverified users can still log in but see banner: "Please verify your email"
- Certain actions (making purchases) may require verified email

**Dependencies:**

- [Notifications - Email Abstraction](../notifications/pdr-phase-1.md#email-service-abstraction)

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

- All `/admin/*` routes require authentication
- All `/admin/*` routes require `role: 'owner'`
- Unauthenticated users redirected to login with return URL
- Non-owner users redirected to library with clear error message
- Middleware runs on every request (server-side protection)
- Client-side also hides admin links for non-owners
- **Extensible**: Middleware design allows adding role-specific routes (e.g., `/creator/*` for Phase 3)

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

- Session immediately invalidated
- Session cookie removed from browser
- User must re-authenticate to access protected routes
- Logout works even if session already expired

---

## User Flows (Visual)

See diagrams:

- [Auth Registration Flow](../_assets/auth-registration-flow.png)
- [Auth Login Flow](../_assets/auth-login-flow.png)
- [Auth Password Reset Flow](../_assets/auth-password-reset-flow.png)

---

## Dependencies

### Internal Dependencies (Phase 1)

- **Neon Postgres**: User and session storage
- **Notification Service**: Email abstraction for verification and password reset
  - See [Notifications PRD](../notifications/pdr-phase-1.md)
  - **Critical**: Must use abstraction, not direct Resend calls
- **SvelteKit**: Server-side rendering, form actions, hooks

### External Dependencies

- **BetterAuth**: Authentication library
  - Handles password hashing
  - Session management
  - Cookie security
  - Token generation
- **Resend API** (via notification abstraction): Email delivery
  - Verification emails
  - Password reset emails
  - Password change confirmations

### Database Schema Dependencies

- `users` table:
  - `role` ENUM('customer', 'owner', 'creator') - Phase 1 uses 'customer' and 'owner', 'creator' reserved for Phase 3
- `sessions` table (BetterAuth managed)
- `verification_tokens` table (BetterAuth managed)
- See [Database Schema](../../infrastructure/DatabaseSchema.md) for full definitions

### Future Extensibility (Phase 3)

- **Media Owner Role**: Database schema already supports `role: 'creator'`
- **Multi-Creator Feature**: Auth system designed to add third role without migration
- See [Multi-Creator PRD](../multi-creator/pdr-phase-1.md)

---

## Acceptance Criteria (Feature-Level)

### Functional Requirements

-  User can register with email/password
-  User can log in with email/password
-  User can reset password via email
-  User can verify email address
-  User can log out
-  Platform Owner can access admin routes
-  Customer cannot access admin routes
-  Unauthenticated users cannot access protected routes
-  Role system supports future `'creator'` role without schema migration

### Security Requirements

-  Passwords hashed with modern algorithm (bcrypt/argon2)
-  Session cookies are HTTP-only, Secure, SameSite
-  Password reset tokens expire after 1 hour
-  Verification tokens expire after 24 hours
-  Tokens are single-use only
-  No plaintext passwords logged or displayed
-  Generic error messages (no user enumeration)
-  Rate limiting on login attempts (5 attempts / 15 min)

### Performance Requirements

-  Login response time < 500ms (p95)
-  Registration response time < 1s (p95)
-  Verification email sent < 60s
-  Password reset email sent < 60s
-  Session validation < 100ms (cached in locals)

### Testing Requirements

-  Unit tests for all authentication utilities
-  Integration tests for all auth API routes
-  E2E test for registration � verification � login flow
-  E2E test for password reset flow
-  Security tests for protected routes
-  Test coverage > 90% for auth module
-  Mock notification service in tests (use abstraction interface)

### Extensibility Requirements

-  Role system supports adding `'creator'` role in Phase 3
-  Middleware logic is extensible for role-based route protection
-  No direct Resend calls (all via notification abstraction)

---

## Related Documents

- **TDD**: [Technical Design Document - Auth Phase 1](./ttd-dphase-1.md)
- **Full Feature**: [Authentication Full Feature Overview](./full-feature-overview.md)
- **Cross-Feature Dependencies**:
  - [Notifications PRD](../notifications/pdr-phase-1.md) - Email abstraction
  - [Admin Dashboard PRD](../admin-dashboard/pdr-phase-1.md) - Protected routes
  - [Multi-Creator PRD](../multi-creator/pdr-phase-1.md) - Future role extensibility
- **Infrastructure**:
  - [Infrastructure Plan](../../infrastructure/infraplan.md)
  - [Database Schema](../../infrastructure/DatabaseSchema.md)
  - [Testing Strategy](../../infrastructure/TestingStrategy.md)

---

## Notes

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
// L BAD: Direct Resend call
await resend.emails.send({ to, subject, html });

//  GOOD: Notification abstraction
await notificationService.sendEmail({
  template: 'verification',
  recipient: user.email,
  data: { verificationLink },
});
```

**Benefits**:

- Easy to switch email providers (Resend � SendGrid, Postmark, etc.)
- Centralized email logic (templates, logging, error handling)
- Testable (mock notification service in tests)
- See [Notifications TDD](../notifications/ttd-dphase-1.md) for implementation

### Security Considerations

- HTTPS required in production (Cloudflare Pages enforces)
- Environment variable for `AUTH_SECRET` (32+ random chars)
- Session expiration: 24 hours (session cookie) or 30 days (remember me)
- Future: Add 2FA for Platform Owner in Phase 2
- Future: Account lockout after 10 failed login attempts (Phase 2)

---

**Document Version**: 1.0
**Last Updated**: 2025-10-20
**Status**: Draft - Awaiting Review
