# E2E Test Plan: Organization Lifecycle

**Test File:** `e2e/tests/10-organization-lifecycle.test.ts`
**Worker:** `organization-api` (Port 42071)
**Status:** Planned

## Overview
This test suite validates the full lifecycle of organizations, focusing on creation, slug management, retrieval, updates, and soft-deletion. It complements `07-platform-settings.test.ts` by focusing on the organization entity itself rather than its settings. It ensures strict enforcement of slug uniqueness, data validation, and authorization rules for modification and deletion.

## Prerequisites
- **Worker Running:** `organization-api` must be running on port 42071.
- **Database:** Test database must be initialized.

## Test Data Requirements
*   **Creator:** Authenticated user who creates the organization.
*   **Outsider:** Authenticated user with no relationship to the organization.

## Test Scenarios

### 1. Organization Creation
**Goal:** Verify creation logic and default field population.
*   **Action:** Call `POST /api/organizations` with valid data (`name`, `slug`, `websiteUrl`).
*   **Assert:**
    *   Response 201 Created.
    *   Response contains `id`, `createdAt`, `updatedAt`.
    *   `creatorId` matches the authenticated user.
    *   `deletedAt` is null.

### 2. Slug Validation & Uniqueness
**Goal:** Verify slug integrity constraints.
*   **Check Availability:** Call `GET /api/organizations/check-slug/:slug` with a new slug.
    *   *Assert:* `{ available: true }`.
*   **Create Duplicate:** Try to create another organization with the same slug.
    *   *Assert:* 409 Conflict.
*   **Check Availability (Taken):** Call `check-slug` with the taken slug.
    *   *Assert:* `{ available: false }`.
*   **Invalid Format:** Try to create with slug "Invalid Slug!" (spaces/caps).
    *   *Assert:* 400 Bad Request.

### 3. Retrieval & Listing
**Goal:** Verify read access patterns.
*   **Get by ID:** Call `GET /api/organizations/:id`.
    *   *Assert:* 200 OK, matches created org.
*   **Get by Slug:** Call `GET /api/organizations/slug/:slug`.
    *   *Assert:* 200 OK, matches created org.
*   **List:** Call `GET /api/organizations` with `search` param matching the org name.
    *   *Assert:* 200 OK, list includes the org.

### 4. Update Lifecycle & Authorization
**Goal:** Verify modification rights.
*   **Update (Success):** Creator calls `PATCH /api/organizations/:id` updating `name` and `description`.
    *   *Assert:* 200 OK, fields updated.
*   **Update (Forbidden):** Outsider calls `PATCH /api/organizations/:id`.
    *   *Assert:* 403 Forbidden.
*   **Update Slug (Conflict):** Creator tries to update slug to an existing one.
    *   *Assert:* 409 Conflict.

### 5. Soft Delete Lifecycle
**Goal:** Verify deletion behavior.
*   **Delete (Forbidden):** Outsider calls `DELETE /api/organizations/:id`.
    *   *Assert:* 403 Forbidden.
*   **Delete (Success):** Creator calls `DELETE /api/organizations/:id`.
    *   *Assert:* 200 OK (or success message).
*   **Verify Soft Delete:**
    *   Call `GET /api/organizations/:id`.
    *   *Assert:* 404 Not Found (filtered out).
    *   Call `GET /api/organizations/check-slug/:slug` with the deleted slug.
    *   *Assert:* `{ available: true }` (slug becomes reusable after deletion, or remains taken depending on business logic - usually reusable if soft-deleted, but often kept to prevent impersonation. *Refinement: Check if unique constraint ignores deleted_at.* Documentation implies `whereNotDeleted` filters, but unique index might persist. If unique index is partial `WHERE deleted_at IS NULL`, it's reusable. Strategy: Expect available or handle 409 if robust architecture prevents reuse).*

## Implementation Details

### Setup Helper
*   Use `authFixture` to create Creator and Outsider users.
*   Use `httpClient` for API requests.

### Clean up
*   Standard database cleanup between tests to ensure slug availability.

