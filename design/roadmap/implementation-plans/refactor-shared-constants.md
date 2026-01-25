# Implementation Plan: Shared Constants Refactor

**Epic:** `Codex-qwg`
**Status:** Planned
**Date:** January 13, 2026

## Objective
Extract hardcoded values, URLs, magic numbers, and repeated configuration strings from `apps/web`, `workers/*`, and other packages into a centralized `packages/constants` shared library. This ensures consistency across the monorepo and prevents configuration drift.

## Scope

### 1. New Package: `@codex/constants`
Create a lightweight, zero-dependency (or minimal dependency) package.

**Structure:**
```text
packages/constants/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts          (Exports all)
│   ├── env.ts            (Environment-aware getters & defaults)
│   ├── urls.ts           (Service ports, public domains)
│   ├── mime.ts           (Content-Type constants, file extensions)
│   ├── limits.ts         (Pagination, file sizes, timeouts, rate limits)
│   ├── cookies.ts        (Cookie names, config, domain logic)
│   ├── commerce.ts       (Stripe events, fee percentages)
│   └── errors.ts         (Standard error codes/messages)
```

### 2. Migration Targets

#### A. Environment-Aware URLs (`src/env.ts`, `src/urls.ts`)
*   **Goal:** Replace raw `process.env.API_URL || 'http://localhost:8787'` with `getServiceUrl('content', env)`.
*   **Constants:**
    *   `SERVICE_PORTS`:
        *   Auth: 42069
        *   Content: 4001
        *   Organization: 42071
        *   E-commerce: 42072
        *   Admin: 42073
        *   Identity: 42074
        *   Notifications: 42075
        *   Media: 8788 (Verify vs 4002 usage)
    *   `DOMAINS`:
        *   Prod: `revelations.studio`
        *   Staging: `staging.revelations.studio` (implied from wrangler.toml)
*   **Helpers:**
    *   `getServiceUrl(service: ServiceName, env?: Env): string`
    *   `isDev(env?: Env): boolean`

#### B. Mime Types & Headers (`src/mime.ts`)
*   **Source:** `packages/validation`, `workers/media-api`, `e2e/helpers`.
*   **Constants:**
    *   `MIME_TYPES.VIDEO.MP4` ('video/mp4')
    *   `MIME_TYPES.IMAGE.PNG` ('image/png')
    *   `MIME_TYPES.APPLICATION.JSON` ('application/json')
    *   `HEADERS.CONTENT_TYPE` ('Content-Type')

#### C. Limits & Timeouts (`src/limits.ts`)
*   **Source:** `packages/validation`, `workers/admin-api/CLAUDE.md`.
*   **Constants:**
    *   `PAGINATION`: `{ DEFAULT: 20, MAX: 100 }`
    *   `FILE_SIZES`: `{ LOGO_MAX_BYTES: 5 * 1024 * 1024 }`
    *   `RATE_LIMITS`: `{ AUTH: 10, GENERAL: 100 }` (requests per window)
    *   `TIMEOUTS`: `{ DEFAULT_TEST: 10000, LONG_TEST: 60000 }`

#### D. Cookies & Auth (`src/cookies.ts`)
*   **Source:** `apps/web/src/routes/(auth)/*`, `packages/security`.
*   **Constants:**
    *   `SESSION_COOKIE_NAME`: 'codex-session'
    *   `SESSION_MAX_AGE`: 60 * 60 * 24 * 7 (7 days)
    *   `TOKEN_MAX_AGE`: 300 (5 minutes)
*   **Helpers:**
    *   `getCookieConfig(env)`: Returns `{ domain, secure, sameSite }` logic.

#### E. E-Commerce (`src/commerce.ts`)
*   **Source:** `workers/ecom-api`, `packages/purchase`.
*   **Constants:**
    *   `STRIPE_EVENTS`: `{ CHECKOUT_COMPLETED: 'checkout.session.completed' }`
    *   `FEES`: `{ PLATFORM_PERCENT: 1000 }` (10%)

## Implementation Steps

1.  **Scaffold Package**
    *   Initialize `packages/constants`.
    *   Configure `tsup` or `tsc` for building.

2.  **Phase 1: Foundation (High Priority)**
    *   Implement `env.ts`, `urls.ts`, `cookies.ts`.
    *   **Goal:** Fix the Auth/Cookie login issue in `apps/web`.
    *   Update `apps/web/src/routes/(auth)/login/+page.server.ts` to use `getCookieConfig`.

3.  **Phase 2: Validation & Logic**
    *   Implement `limits.ts`, `mime.ts`.
    *   Update `packages/validation` to use these constants (breaking change for consumers of validation, proceed carefully).

4.  **Phase 3: Worker Standardization**
    *   Update `workers/*` `wrangler.toml` files (if possible to share config) or at least the code within them to use `getServiceUrl`.

5.  **Phase 4: Cleanup**
    *   Search and replace leftover magic strings in tests (`e2e/`).

## Verification
*   **Build:** Ensure `@codex/constants` builds cleanly.
*   **Auth Test:** Verify login works on `localhost` (cookie set correctly) and `prod` (secure cookie).
*   **E2E:** Run `pnpm test:e2e` to ensure no regression in flows.