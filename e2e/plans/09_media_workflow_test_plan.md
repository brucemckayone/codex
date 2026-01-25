# E2E Test Plan: Media Workflow

**Test File:** `e2e/tests/09-media-workflow.test.ts`
**Worker:** `media-api` (Port 4002)
**Status:** Planned

## Overview
This test suite verifies the media transcoding lifecycle orchestrated by the `media-api` worker. It covers internal worker-to-worker triggers, user-facing status/retry operations, and the critical RunPod webhook callback handling. Due to the external dependency on RunPod, "trigger" operations will be tested for their failure/error handling paths (or mocked logic), while the "callback" (webhook) logic will be fully tested by simulating incoming RunPod requests.

## Prerequisites
- **Worker Running:** `media-api` must be running on port 4002.
- **Database:** Test database must be initialized.
- **Environment:** Test environment should have `WORKER_SHARED_SECRET` and `RUNPOD_WEBHOOK_SECRET` configured matching the test suite's generators. `RUNPOD_API_KEY` can be fake to ensure deterministic 502 errors during triggers.

## Test Data Requirements
*   **Creator:** Standard authenticated user.
*   **Media Item:** A media item record in various states (`uploaded`, `transcoding`, `failed`) to test different workflow stages.

## Test Scenarios

### 1. Internal Trigger (Content-API Handoff)
**Goal:** Verify the worker-to-worker authentication and initial job trigger logic.
*   **Setup:** Create a media item with status `uploaded`.
*   **Action:** Call `POST /internal/media/:id/transcode` with valid `X-Worker-Signature` and `X-Worker-Timestamp` headers.
*   **Expected Result:**
    *   If using fake credentials: **502 Bad Gateway** (RunPod API Error). This confirms the auth passed and the service attempted to call RunPod.
    *   *Assert:* Response code 502 (or 200 if we can mock the fetch). Verify body contains error details identifying "RunPod API error".
*   **Security Test (Invalid Sig):** Call without headers or with invalid signature.
    *   *Assert:* **401 Unauthorized**.

### 2. Transcoding Status Check
**Goal:** Verify users can check status.
*   **Setup:** Manually update media item status to `transcoding`.
*   **Action:** Call `GET /api/transcoding/status/:id` as the creator.
*   **Assert:** 200 OK, body contains `status: 'transcoding'`.
*   **Security Test:** Call as a different user.
    *   *Assert:* **403 Forbidden** (or 404).

### 3. Webhook: Success Workflow
**Goal:** Verify database updates upon successful transcoding.
*   **Setup:** Media item in `transcoding` status.
*   **Action:** Simulate a RunPod webhook `POST /api/transcoding/webhook`.
    *   **Headers:** Valid `X-Runpod-Signature` (HMAC-SHA256 of body) and current `X-Runpod-Timestamp`.
    *   **Body:** `{ status: "completed", output: { ...valid metadata... } }`.
*   **Assert:**
    *   Response 200 OK.
    *   Database check: Media item status is `ready`.
    *   Database check: `durationSeconds`, `width`, `height`, etc., are updated.

### 4. Webhook: Failure Workflow
**Goal:** Verify error reporting from RunPod.
*   **Setup:** Reset media item to `transcoding`.
*   **Action:** Simulate RunPod webhook with `status: 'failed'` and `error: "Corrupt input file"`.
*   **Assert:**
    *   Response 200 OK (webhooks must always succeed to stop retries).
    *   Database check: Media item status is `failed`.
    *   Database check: `transcodingError` column contains "Corrupt input file".

### 5. Retry Workflow
**Goal:** Verify users can retry failed jobs.
*   **Setup:** Media item in `failed` status.
*   **Action:** Call `POST /api/transcoding/retry/:id` as creator.
*   **Expected Result:**
    *   Similar to Scenario 1: **502 Bad Gateway** (due to fake RunPod credentials).
    *   *Assert:* The endpoints are reachable, auth works, and logic attempts to call RunPod.
*   **Logic Check:** (Optional) Verify `transcodingAttempts` incremented in DB (note: transaction might rollback on 502, so DB state might not change. If 502 simulates "API unreachable", the DB update happens *before*? No, transaction usually wraps it. We'll rely on the HTTP status response to verify logic reach).

### 6. Edge Cases & Validation
*   **Replay Attack:** Send webhook with old timestamp (>5 min).
    *   *Assert:* 401 Unauthorized.
*   **Invalid Signature:** Send webhook with wrong signature.
    *   *Assert:* 401 Unauthorized.
*   **Concurrent Update:** Send webhook for media that is already `ready` (not `transcoding`).
    *   *Assert:* 200 OK (idempotent/ignored), DB remains `ready`.

## Implementation Details

### Crypto Helper
*   Need a helper function to generate `X-Worker-Signature` and `X-Runpod-Signature` using `crypto.subtle` or node `crypto`.
*   Example in `workers/media-api/CLAUDE.md` provides the Node implementation.

### RunPod Mocking options
*   Since we can't easily mock `fetch` inside the worker process from the test runner, we accept the 502 as a "successful failure" indication that the logic reached the external call.

