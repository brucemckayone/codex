# P1-FE-AUTH-001: Auth Pages

**Priority**: P1
**Status**: 🚧 Not Started
**Estimated Effort**: 3-4 days
**Beads Task**: Codex-vw8.3

---

## Table of Contents

- [Overview](#overview)
- [System Context](#system-context)
- [Page Specifications](#page-specifications)
- [Remote Functions Implementation](#remote-functions-implementation)
- [Form Validation](#form-validation)
- [Error Handling](#error-handling)
- [Dependencies](#dependencies)
- [Implementation Checklist](#implementation-checklist)
- [Testing Strategy](#testing-strategy)

---

## Overview

This work packet implements all authentication UI pages: login, registration, password reset flow, and email verification. All authentication logic is delegated to the Auth Worker (BetterAuth) - the frontend only handles form capture, validation feedback, and redirects.

The auth pages use SvelteKit's experimental Remote Functions `form()` for progressive enhancement - forms work without JavaScript but provide enhanced UX with client-side validation and loading states when JS is available.

Key features:
- **Cross-subdomain login**: Auth happens on platform domain with redirect back to origin
- **Progressive enhancement**: Forms work without JavaScript
- **Type-safe validation**: Shared schemas from `@codex/validation`
- **Inline error feedback**: Field-level and form-level error messages

---

## System Context

### Upstream Dependencies

| System | What We Consume |
|--------|-----------------|
| **Auth Worker** (port 42069) | All auth endpoints via BetterAuth |
| **P1-FE-FOUNDATION-001** | Hooks, layouts, API client |
| **P1-FE-FOUNDATION-002** | Form components (Input, Button) |

### Downstream Consumers

| System | What We Provide |
|--------|-----------------|
| **All authenticated pages** | Session establishment |
| **User profile pages** | Registration flow completion |

### Auth Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Auth Flow                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   User on yoga-studio.revelations.studio                        │
│            │                                                    │
│            ▼                                                    │
│   Click "Sign In" → Redirect to revelations.studio/login       │
│            │         (with ?redirect=yoga-studio.*/explore)     │
│            ▼                                                    │
│   Submit Login Form                                             │
│            │                                                    │
│            ▼                                                    │
│   POST to Auth Worker (/api/auth/sign-in/email)                 │
│            │                                                    │
│            ├─── Success → Set-Cookie: codex-session            │
│            │              (domain: .revelations.studio)         │
│            │              Redirect to ?redirect URL             │
│            │                                                    │
│            └─── Failure → Return error, show inline             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Page Specifications

### 1. Login Page (`/login`)

**Route**: `src/routes/(auth)/login/`

| Element | Specification |
|---------|---------------|
| URL | `/login?redirect={encoded_url}` |
| Access | Public (redirect away if already logged in) |
| Fields | Email, Password |
| Actions | Submit, "Forgot Password" link, "Create account" link |
| Success | Redirect to `?redirect` or `/library` |
| Errors | Field-level (email/password), Form-level (rate limit) |

**Wireframe**:
```
┌─────────────────────────────────────┐
│           Sign In                   │
├─────────────────────────────────────┤
│                                     │
│  Email                              │
│  ┌─────────────────────────────┐    │
│  │ email@example.com           │    │
│  └─────────────────────────────┘    │
│  ⚠️ Invalid email or password       │
│                                     │
│  Password                           │
│  ┌─────────────────────────────┐    │
│  │ ••••••••                    │    │
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │        Sign In              │    │
│  └─────────────────────────────┘    │
│                                     │
│  Forgot password?                   │
│                                     │
│  ─────────────────────────────────  │
│                                     │
│  Don't have an account? Sign up     │
│                                     │
└─────────────────────────────────────┘
```

---

### 2. Register Page (`/register`)

**Route**: `src/routes/(auth)/register/`

| Element | Specification |
|---------|---------------|
| URL | `/register?redirect={encoded_url}` |
| Access | Public (redirect away if already logged in) |
| Fields | Name (optional), Email, Password, Confirm Password |
| Validation | Email format, password strength (8+ chars), passwords match |
| Success | Auto sign-in, redirect to verification notice |
| Errors | Field-level validation, duplicate email |

**Password Requirements**:
- Minimum 8 characters
- At least one letter
- At least one number

---

### 3. Forgot Password Page (`/forgot-password`)

**Route**: `src/routes/(auth)/forgot-password/`

| Element | Specification |
|---------|---------------|
| URL | `/forgot-password` |
| Access | Public |
| Fields | Email |
| Success | Show confirmation message (always, even if email doesn't exist) |
| Note | Security: Don't reveal if email exists in system |

**Confirmation Message**:
> If an account exists with that email, we've sent password reset instructions.

---

### 4. Reset Password Page (`/reset-password`)

**Route**: `src/routes/(auth)/reset-password/`

| Element | Specification |
|---------|---------------|
| URL | `/reset-password?token={token}` |
| Access | Token required |
| Fields | New Password, Confirm Password |
| Success | Auto sign-in, redirect to `/library` |
| Errors | Invalid/expired token, password validation |

---

### 5. Verify Email Page (`/verify-email`)

**Route**: `src/routes/(auth)/verify-email/`

| Element | Specification |
|---------|---------------|
| URL | `/verify-email?token={token}` |
| Access | Token required |
| Behavior | Auto-processes token on load |
| Success | Auto sign-in, redirect to `/library` |
| Errors | Invalid/expired token with resend option |

---

## Remote Functions Implementation

### src/routes/(auth)/login/auth.remote.ts

```typescript
import { form, invalid } from '$app/server';
import { redirect } from '@sveltejs/kit';
import * as v from 'valibot';
import { createServerApi, ApiError } from '$lib/server/api';

// Validation schema
const loginSchema = v.object({
  email: v.pipe(
    v.string(),
    v.email('Please enter a valid email address')
  ),
  password: v.pipe(
    v.string(),
    v.minLength(1, 'Password is required')
  ),
  _redirect: v.optional(v.string())
});

export const login = form(
  loginSchema,
  async ({ email, password, _redirect }, { platform, cookies }) => {
    const authUrl = platform?.env?.AUTH_WORKER_URL ?? 'http://localhost:42069';

    try {
      const response = await fetch(`${authUrl}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));

        if (response.status === 401) {
          return invalid(401, {
            email: ['Invalid email or password']
          });
        }

        if (response.status === 429) {
          return invalid(429, {
            _form: ['Too many login attempts. Please try again later.']
          });
        }

        return invalid(response.status, {
          _form: [error.message ?? 'Login failed. Please try again.']
        });
      }

      // Forward session cookie from Auth Worker
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        // Parse and forward the cookie
        const cookieMatch = setCookie.match(/codex-session=([^;]+)/);
        if (cookieMatch) {
          cookies.set('codex-session', cookieMatch[1], {
            path: '/',
            domain: '.revelations.studio',
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 7 // 7 days
          });
        }
      }

      // Redirect to requested page or library
      const redirectTo = validateRedirect(_redirect) ?? '/library';
      redirect(303, redirectTo);
    } catch (error) {
      if (error instanceof Response) throw error; // Re-throw redirects

      console.error('[Auth] Login error:', error);
      return invalid(500, {
        _form: ['Something went wrong. Please try again.']
      });
    }
  }
);

function validateRedirect(url: string | undefined): string | null {
  if (!url) return null;
  // Only allow same-origin redirects
  if (url.startsWith('/') && !url.startsWith('//')) {
    return url;
  }
  // Allow revelations.studio subdomains
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith('.revelations.studio') ||
        parsed.hostname === 'revelations.studio') {
      return url;
    }
  } catch {
    return null;
  }
  return null;
}
```

### src/routes/(auth)/login/+page.svelte

```svelte
<script lang="ts">
  import { login } from './auth.remote';
  import * as m from '$paraglide/messages';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import Input from '$lib/components/ui/Input/Input.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>Sign In | Revelations</title>
</svelte:head>

<div class="auth-container">
  <div class="auth-card">
    <h1 class="auth-title">{m.auth_signin_title()}</h1>

    <form {...login}>
      {#if login.issues._form}
        <div class="form-error" role="alert">
          {#each login.issues._form as issue}
            <p>{issue}</p>
          {/each}
        </div>
      {/if}

      <!-- Hidden redirect field -->
      <input type="hidden" name="_redirect" value={data.redirect ?? ''} />

      <div class="field">
        <label for="email">{m.auth_email_label()}</label>
        <Input
          {...login.fields.email.as('email')}
          id="email"
          placeholder="you@example.com"
          autocomplete="email"
          error={login.fields.email.issues()[0]}
        />
      </div>

      <div class="field">
        <label for="password">{m.auth_password_label()}</label>
        <Input
          {...login.fields.password.as('password')}
          id="password"
          type="password"
          autocomplete="current-password"
          error={login.fields.password.issues()[0]}
        />
      </div>

      <Button type="submit" loading={login.submitting} class="submit-button">
        {login.submitting ? m.common_loading() : m.auth_signin_button()}
      </Button>

      <a href="/forgot-password" class="forgot-link">
        {m.auth_forgot_password()}
      </a>
    </form>

    <div class="divider">
      <span>{m.common_or()}</span>
    </div>

    <p class="signup-prompt">
      {m.auth_no_account()}
      <a href="/register?redirect={encodeURIComponent(data.redirect ?? '')}">
        {m.auth_signup_link()}
      </a>
    </p>
  </div>
</div>

<style>
  .auth-container {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    background: var(--color-background);
  }

  .auth-card {
    width: 100%;
    max-width: 400px;
    background: var(--color-surface);
    border-radius: var(--radius-lg);
    padding: var(--space-8);
    box-shadow: var(--shadow-lg);
  }

  .auth-title {
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    text-align: center;
    margin-bottom: var(--space-6);
    color: var(--color-text);
  }

  .field {
    margin-bottom: var(--space-4);
  }

  .field label {
    display: block;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    margin-bottom: var(--space-1);
    color: var(--color-text);
  }

  .form-error {
    background: var(--color-error);
    color: var(--color-text-inverse);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-4);
    font-size: var(--text-sm);
  }

  .submit-button {
    width: 100%;
    margin-top: var(--space-4);
  }

  .forgot-link {
    display: block;
    text-align: center;
    margin-top: var(--space-3);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  .forgot-link:hover {
    color: var(--color-primary-500);
  }

  .divider {
    display: flex;
    align-items: center;
    margin: var(--space-6) 0;
  }

  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--color-border);
  }

  .divider span {
    padding: 0 var(--space-3);
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  .signup-prompt {
    text-align: center;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .signup-prompt a {
    color: var(--color-primary-500);
    font-weight: var(--font-medium);
  }
</style>
```

---

## Form Validation

### Shared Validation Schemas

Add to `@codex/validation`:

```typescript
// packages/validation/src/auth.ts
import * as v from 'valibot';

export const emailSchema = v.pipe(
  v.string(),
  v.email('Please enter a valid email address')
);

export const passwordSchema = v.pipe(
  v.string(),
  v.minLength(8, 'Password must be at least 8 characters'),
  v.regex(/[a-zA-Z]/, 'Password must contain at least one letter'),
  v.regex(/[0-9]/, 'Password must contain at least one number')
);

export const loginSchema = v.object({
  email: emailSchema,
  password: v.pipe(v.string(), v.minLength(1, 'Password is required'))
});

export const registerSchema = v.pipe(
  v.object({
    name: v.optional(v.pipe(v.string(), v.maxLength(100))),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: v.string()
  }),
  v.forward(
    v.check(
      (input) => input.password === input.confirmPassword,
      'Passwords do not match'
    ),
    ['confirmPassword']
  )
);

export const forgotPasswordSchema = v.object({
  email: emailSchema
});

export const resetPasswordSchema = v.pipe(
  v.object({
    token: v.string(),
    password: passwordSchema,
    confirmPassword: v.string()
  }),
  v.forward(
    v.check(
      (input) => input.password === input.confirmPassword,
      'Passwords do not match'
    ),
    ['confirmPassword']
  )
);
```

---

## Error Handling

### Auth Worker Error Codes

| Status | Error Code | User Message |
|--------|------------|--------------|
| 400 | VALIDATION_ERROR | Field-level validation errors |
| 401 | INVALID_CREDENTIALS | Invalid email or password |
| 403 | ACCOUNT_LOCKED | Account locked. Contact support. |
| 404 | USER_NOT_FOUND | (Don't reveal - show generic) |
| 409 | EMAIL_EXISTS | An account with this email already exists |
| 429 | RATE_LIMITED | Too many attempts. Try again later. |
| 500 | INTERNAL_ERROR | Something went wrong. Please try again. |

### Client-Side Error Display

```svelte
<!-- Field-level errors -->
{#each login.fields.email.issues() as issue}
  <span class="field-error">{issue}</span>
{/each}

<!-- Form-level errors -->
{#if login.issues._form}
  <div class="form-error" role="alert">
    {#each login.issues._form as issue}
      <p>{issue}</p>
    {/each}
  </div>
{/if}
```

---

## i18n Messages

Add to `messages/en.json`:

```json
{
  "auth_signin_title": "Sign In",
  "auth_signin_button": "Sign In",
  "auth_signup_title": "Create Account",
  "auth_signup_button": "Create Account",
  "auth_email_label": "Email",
  "auth_password_label": "Password",
  "auth_confirm_password_label": "Confirm Password",
  "auth_name_label": "Name (optional)",
  "auth_forgot_password": "Forgot your password?",
  "auth_reset_password_title": "Reset Password",
  "auth_reset_password_button": "Reset Password",
  "auth_no_account": "Don't have an account?",
  "auth_signup_link": "Sign up",
  "auth_have_account": "Already have an account?",
  "auth_signin_link": "Sign in",
  "auth_check_email": "Check your email",
  "auth_reset_email_sent": "If an account exists with that email, we've sent password reset instructions.",
  "auth_verify_email_success": "Email verified successfully!",
  "auth_verify_email_error": "Invalid or expired verification link."
}
```

---

## Dependencies

### Required

| Dependency | Status | Description |
|------------|--------|-------------|
| P1-FE-FOUNDATION-001 | ✅ | Project setup, hooks, API client |
| P1-FE-FOUNDATION-002 | ✅ | Input, Button components |
| Auth Worker | ✅ | BetterAuth endpoints |
| @codex/validation | ✅ | Shared Valibot schemas |

---

## Implementation Checklist

- [ ] **Route Structure**
  - [ ] Create src/routes/(auth)/+layout.svelte (auth-specific styling)
  - [ ] Create login/, register/, forgot-password/, reset-password/, verify-email/ routes

- [ ] **Remote Functions**
  - [ ] Implement login.remote.ts
  - [ ] Implement register.remote.ts
  - [ ] Implement forgot-password.remote.ts
  - [ ] Implement reset-password.remote.ts

- [ ] **Pages**
  - [ ] Login page with form and error handling
  - [ ] Register page with password confirmation
  - [ ] Forgot password page
  - [ ] Reset password page (token handling)
  - [ ] Verify email page (auto-processing)

- [ ] **Validation**
  - [ ] Add schemas to @codex/validation
  - [ ] Implement client-side preflight validation
  - [ ] Add field-level error display

- [ ] **i18n**
  - [ ] Add all auth message keys
  - [ ] Use in all page components

- [ ] **Testing**
  - [ ] Unit tests for validation schemas
  - [ ] Integration tests for auth flows
  - [ ] Visual tests for auth pages

---

## Testing Strategy

### Unit Tests

```typescript
describe('Auth Validation', () => {
  it('rejects short passwords');
  it('requires matching password confirmation');
  it('validates email format');
});
```

### Integration Tests

```typescript
describe('Login Flow', () => {
  it('shows error for invalid credentials');
  it('redirects to library on success');
  it('redirects to original URL when redirect param present');
  it('handles rate limiting gracefully');
});
```

### E2E Tests

```typescript
test('complete registration flow', async ({ page }) => {
  await page.goto('/register');
  await page.fill('[name="email"]', 'new@example.com');
  await page.fill('[name="password"]', 'Password123');
  await page.fill('[name="confirmPassword"]', 'Password123');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/verify-email/);
});
```

---

## Notes

### Security Considerations

1. **No "email exists" leakage**: Forgot password always shows success message
2. **Redirect validation**: Only allow same-origin or revelations.studio subdomains
3. **Rate limit messaging**: Generic "too many attempts" without specifics
4. **Password requirements**: Enforced client and server side

### Future Enhancements

- OAuth providers (Google, GitHub)
- Two-factor authentication
- "Remember me" option
- Login history

---

**Last Updated**: 2026-01-12
**Template Version**: 1.0
