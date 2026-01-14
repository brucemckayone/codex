# Codebase Review Report: feat/frontend-phase1

**Date:** January 13, 2026
**Branch:** `feat/frontend-phase1`
**Comparison:** `main`

## Executive Summary

This review focuses on the split between **Server-Side/Auth** logic and **Frontend/Routing** structures. The codebase is currently in a foundational state ("bare bones"), establishing critical architectural patterns for multi-tenant routing and worker-based authentication.

## Part 1: Server-Side Logic & Organization

### 1. API Client (`apps/web/src/lib/server/api.ts`)
*   **Status:** Functional but has potential configuration fragility.
*   **Observations:**
    *   `DEFAULT_URLS` contains hardcoded `localhost` ports.
    *   `content` and `access` workers currently share the same URL (`http://localhost:4001`). Verify if this is intentional (e.g., same worker) or a copy-paste error.
    *   **Recommendation:** Move `DEFAULT_URLS` to a centralized configuration or validate strictly against environment variables. Ensure `content` vs `access` mapping is correct.

### 2. Server Hooks (`apps/web/src/hooks.server.ts`)
*   **Status:** Implements essential session validation.
*   **Observations:**
    *   The `sessionHook` silently catches errors from the Auth Worker ("Auth worker unavailable"). While it logs to observability, the user receives a generic unauthenticated state.
    *   **Recommendation:** Consider if a partial outage (Auth Worker down) should result in a hard error page or a "degraded mode" banner, rather than just silently logging the user out.

### 3. Auth Logic (`apps/web/src/routes/(auth)/login/+page.server.ts`)
*   **Status:** Functional, manual cookie handling.
*   **Critical Findings:**
    *   **Cookie Domain:** `domain: '.revelations.studio'` is hardcoded. This will likely break local development (e.g., `localhost`) unless `dev` environment logic overrides it or the browser ignores it for localhost.
    *   **Secure Flag:** `secure: true` is set unconditionally. Ensure your local dev environment uses HTTPS or that this doesn't block local login.
    *   **Logic:** Manually parsing `Set-Cookie` from the worker response is fragile.
    *   **Recommendation:** Create a helper for setting the session cookie that is environment-aware (sets domain/secure flags based on `dev` vs `prod`).

## Part 2: Frontend & Routing

### 1. Routing Complexity (`apps/web/src/hooks.ts`)
*   **Status:** Robust, handles multi-tenancy well.
*   **Observations:**
    *   The `reroute` logic correctly partitions the application into:
        *   **Platform:** `revelations.studio` -> `(platform)`
        *   **Creators:** `creators.revelations.studio` -> `_creators`
        *   **Organizations:** `*.revelations.studio` -> `_org`
    *   **Scalability:** The logic is sound and scalable. `AUTH_PATHS` being global is a good decision for UX.
    *   **Risk:** As `RESERVED_SUBDOMAINS` grows, ensure this list is kept in sync with the actual worker infrastructure to prevent collisions.

### 2. UI Components ("Bare Bones")
*   **Status:** Verified.
*   **Observations:**
    *   Components like `Button.svelte` are structural only, with no styling classes yet. This aligns with the "bare bones" goal.
    *   **Recommendation:** Maintain this simplicity until the routing and data layers are fully proven.

## Summary of Action Items

1.  **Fix:** Make cookie `domain` and `secure` flags environment-aware in `login/+page.server.ts`.
2.  **Verify:** Confirm `content` and `access` API URLs in `api.ts`.
3.  **Refactor:** Extract cookie setting logic into a reusable server-side utility to avoid duplication between `login`, `register`, and `verify-email`.