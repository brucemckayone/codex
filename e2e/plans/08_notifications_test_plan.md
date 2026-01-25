# E2E Test Plan: Notifications API

**Test File:** `e2e/tests/08-notifications.test.ts`
**Worker:** `notifications-api` (Port 42075)
**Status:** Planned

## Overview
This test suite verifies the functionality of the Notifications API, focusing on Email Template management across three scopes (Global, Organization, Creator) and the ability to preview and send test emails. It ensures proper access control, input validation, and successful integration with the email provider layer (mock/console).

## Prerequisites
- **Worker Running:** `notifications-api` must be running on port 42075.
- **Database:** Test database must be initialized.
- **Environment:** `USE_MOCK_EMAIL` should ideally be set to `true` (or no Resend API key provided) to default to `ConsoleProvider` to avoid external API calls during testing.

## Test Data Requirements
To fully exercise the permissions model, we need the following actors:
1.  **Platform Owner:** User with `role: 'platform_owner'`.
2.  **Org Admin:** User who created an organization (owner/admin role).
3.  **Org Member:** User who is a member of the above organization.
4.  **Creator:** Standard user with `role: 'creator'`.
5.  **Outsider:** Authenticated user with no relation to the above.

## Test Scenarios

### 1. Global Template Management (Platform Owner)
**Goal:** Verify platform-wide template lifecycle.
*   **Create (Success):** Platform Owner creates a template at `POST /api/templates/global` with name `global-welcome`.
    *   *Assert:* 201 Created, response contains `scope: 'global'`.
*   **Create (Forbidden):** Org Admin tries to create global template.
    *   *Assert:* 403 Forbidden.
*   **List:** Platform Owner lists `GET /api/templates/global`.
    *   *Assert:* 200 OK, list contains `global-welcome`.
*   **Update:** Platform Owner updates subject of `global-welcome`.
    *   *Assert:* 200 OK, subject updated.
*   **Delete:** Platform Owner deletes `global-welcome`.
    *   *Assert:* 204 No Content.

### 2. Organization Template Management
**Goal:** Verify organization-scoped isolation.
*   **Create (Success):** Org Admin creates template at `POST /api/templates/organizations/:orgId` with name `org-invite`.
    *   *Assert:* 201 Created, `scope: 'organization'`, `organizationId` matches.
*   **List (Member Access):** Org Member lists templates for `:orgId`.
    *   *Assert:* 200 OK, can see `org-invite`.
*   **List (Outsider Access):** Outsider user tries to list templates for `:orgId`.
    *   *Assert:* 403 Forbidden (or 404 if org lookup fails first).
*   **Update:** Org Admin updates `org-invite`.
    *   *Assert:* 200 OK.
*   **Conflict:** Org Admin tries to create `org-invite` again.
    *   *Assert:* 409 Conflict.

### 3. Creator Template Management
**Goal:** Verify personal template management.
*   **Create (Success):** Creator user creates template at `POST /api/templates/creator` with name `my-newsletter`.
    *   *Assert:* 201 Created, `scope: 'creator'`, `creatorId` matches user.
*   **Access Control:** Another user tries to update/delete `my-newsletter` by ID.
    *   *Assert:* 403 Forbidden.

### 4. Template Preview & Rendering
**Goal:** Verify token substitution logic.
*   **Setup:** Create a creator template with subject `Hello {{name}}` and body `Welcome to {{platformName}}`.
*   **Action:** Call `POST /api/templates/:id/preview` with body `{ data: { "name": "World" } }`.
*   **Assert:**
    *   200 OK.
    *   Response `data.subject` equals "Hello World".
    *   Response `data.html` contains "Welcome to Codex" (default platform name).
    *   Verify brand tokens (`platformName`) are auto-injected.

### 5. Test Send (Integration)
**Goal:** Verify the "Send Test Email" flow.
*   **Action:** Call `POST /api/templates/:id/test-send` with `{ recipientEmail: "test@example.com", data: { ... } }`.
*   **Assert:**
    *   200 OK.
    *   Response structure: `{ data: { status: 'success', provider: 'console', ... } }`.
    *   (Note: We assume Console provider is active in test environment).

### 6. Edge Cases & Validation
*   **Invalid Slug:** Create template with name `Invalid Name!` (spaces/symbols).
    *   *Assert:* 400 Bad Request (Validation Error).
*   **XSS Prevention:** Create template with `<script>alert(1)</script>` in subject.
    *   *Assert:* 201 Created (allowed to save), but **Preview** should show sanitized output or stripped tags (depending on implementation). *Refinement: Check if API strips tags on save or render.* (Documentation says subject HTML tags are stripped).

## Implementation Details

### Helper Needs
*   need `authFixture` to create Platform Owner (may need direct DB manipulation to set role 'platform_owner' if register endpoint doesn't support it). -> *Action: Check `seedTestUsers` or use `db` directly to update role.*
*   need `orgFixture` to create organization and memberships.

### Database Direct Access
*   We will likely need to use `worker-manager`'s DB access (or `authFixture`'s underlying DB access) to elevate a user to `platform_owner` since the public registration API likely defaults to `customer` or `creator`.
