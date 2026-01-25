# E2E Test Gap Analysis

## Overview
This document analyzes the current state of E2E testing in `@codex/e2e` and identifies coverage gaps based on the implemented features in the worker codebase.

## Current Coverage
| Test Suite | File | Covered Scenarios |
|------------|------|-------------------|
| **Auth** | `01-auth-flow.test.ts` | Register, Login, Session, Logout, Duplicates |
| **Content** | `02-content-creation.test.ts` | Draft creation, *simulated* media upload, Metadata update, Publish flow, Ownership checks |
| **Free Access** | `03-free-content-access.test.ts` | Public access control, Streaming URL generation, Playback progress |
| **Purchase** | `04-paid-content-purchase.test.ts` | Checkout session, Webhook (idempotency, auth), Access verification |
| **History** | `05-purchase-history.test.ts` | Purchase listing, Pagination, Filters |
| **Admin** | `06-admin-dashboard.test.ts` | Analytics (Revenue, Customer), Top Content, Content Management (Publish/Delete override) |
| **Settings** | `07-platform-settings.test.ts` | Org Branding, Contact, Feature Flags, Cross-org isolation |

## Identified Gaps

### 1. Notifications API (High Priority)
**Worker**: `notifications-api`
**Status**: Completely untested in E2E.
**Missing Scenarios**:
- **Template CRUD**: Create, read, update, list templates (Global/Org/Creator scopes).
- **Template Preview**: Rendering templates with sample data.
- **Test Sending**: Triggering `POST /api/templates/:id/test-send` to verify provider integration (mocked).
- **Variables**: Verifying variable substitution (`{{name}}`).

### 2. Media API Interaction (High Priority)
**Worker**: `media-api`
**Status**: Skipped. Current tests simulate media readiness by directly patching the database status to `ready`.
**Missing Scenarios**:
- **Status Endpoint**: `GET /api/transcoding/status/:id`.
- **Retry Logic**: `POST /api/transcoding/retry/:id` for failed items.
- **Webhook Processing**: Sending a mock RunPod webhook to `media-api` (instead of direct DB patch) to verify the actual webhook handler logic updates the database correctly.

### 3. Organization Lifecycle (Medium Priority)
**Worker**: `organization-api`
**Status**: Partially covered as setup steps.
**Missing Scenarios**:
- **Explicit CRUD**: A dedicated test for User creating an organization, listing their organizations, and deleting an organization.
- **Slug Validation**: Testing `GET /api/organizations/check-slug/:slug` directly.
- **Updates**: Updating organization details (name, slug) independent of settings.

### 4. Content Deletion by User (Medium Priority)
**Worker**: `content-api`
**Status**: Admin deletion covered, User deletion missing.
**Missing Scenarios**:
- Creator calling `DELETE /api/content/:id`.
- Verifying content is soft-deleted (hidden from list, but exists in DB).
- Verifying media items are preserved or deleted (cascading behavior logic).

### 5. Media Upload Handshake (Low Priority)
**Worker**: `content-api`
**Status**: Simulating using `POST /api/media`.
**Missing Scenarios**:
- The `POST /api/media/:id/upload-complete` endpoint which triggers the transcoding. Tests currently rely on direct creation or patching. Testing the "handshake" that notifies the system an upload finished is valuable.

## Recommended Next Steps

1. **Create `08-notifications.test.ts`**:
   - Test creating a creator template.
   - Test previewing that template.
   - Test "sending" (mocked) to verify success response.

2. **Create `09-media-workflow.test.ts`**:
   - Create media item.
   - Call `upload-complete` (triggering internal worker call).
   - Poll `transcoding/status/:id`.
   - Simulate RunPod webhook failure.
   - Test `retry` endpoint.
   - Simulate RunPod webhook success.

3. **Create `10-organization-lifecycle.test.ts`**:
   - Create org.
   - Check slug availability.
   - Update org details.
   - Delete org and verify it disappears from lists.
