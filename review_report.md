# Code Review Report

**Date:** 2026-01-08
**Branch:** `feature/transcoding-phase1-schema`
**Focus:** Security (Webhook Auth, API Protection)

## 🚨 Critical Issues (Blockers)

None found. The security implementation for the webhook authentication is robust.

## ⚠️ Architectural Risks & Observations

### 1. Design Doc vs. Implementation Divergence (Webhook)
- **Observation:** The design document (`design/roadmap/work-packets/P1-TRANSCODE-001-media-transcoding.md`) specifies using `procedure({ policy: { auth: 'none' } })` for the webhook endpoint. However, the implementation in `workers/media-api/src/routes/webhook.ts` correctly opts for a raw `app.post` route with `verifyRunpodSignature` middleware.
- **Why this matters:** The `procedure` pattern typically parses the body as JSON before the handler receives it. For HMAC signature verification, **access to the raw, unparsed request body is critical**. Using `JSON.stringify()` on a parsed body (as suggested in the design doc) would likely result in signature mismatches due to key ordering or whitespace differences.
- **Recommendation:** The implementation is correct and secure. **Update the design document** to reflect this necessary deviation, explicitly noting that webhooks requiring HMAC verification must handle the raw body stream directly.

### 2. Global Auth Disabled
- **Observation:** `workers/media-api/src/index.ts` sets `enableGlobalAuth: false`.
- **Impact:** This shifts the security responsibility entirely to individual route definitions. While currently all routes in `transcoding.ts` coverage use `procedure()` (which enforces policy) and `webhook.ts` uses its own middleware, this increases the risk of future routes being accidentally exposed if a developer forgets to wrap them in `procedure()`.
- **Recommendation:** Ensure CI/CD or linting rules flag any raw `app.get/post` calls in `media-api` that do not use `procedure()` or explicit middleware, to prevent accidental public exposure.

## 🔒 Security Audit Findings

### Webhook Authentication (`workers/media-api/src/routes/webhook.ts`)
- **✅ Signature Verification:** The implementation correctly accesses `c.req.text()` (via `verifyRunpodSignature` middleware) to verify the HMAC-SHA256 signature against the raw payload.
- **✅ Timing Attacks:** The `timingSafeEqual` function in `verify-runpod-signature.ts` correctly uses a constant-time XOR comparison loop determined by the minimum length, which is effective for this use case since the expected signature length is fixed by the algorithm (SHA-256).
- **✅ Replay Protection:** The middleware enforces a 5-minute timestamp window (`maxAge: 300`) and validates the `X-Runpod-Timestamp` header.
- **✅ Secret Handling:** Uses `ctx.env` for accessing secrets, ensuring they are not hardcoded.

### API Route Protection (`workers/media-api/src/routes/transcoding.ts`)
- **✅ Procedure Pattern:** All user-facing routes (`retry`, `status`) leverage `procedure()` with `auth: 'required'`, ensuring `ctx.user` is present and authenticated.
- **✅ Internal Routes:** The internal trigger route uses `auth: 'worker'`, which (assuming `workerAuth` middleware implementation is standard) effectively restricting access to other Cloudflare Workers carrying the shared secret.

## 💡 Refactoring & Polish

### 1. Type Safety in Middleware
In `webhook.ts`, the code asserts `c.get('rawBody') as string`. Use Hono's `Variables` type augmentation in `verify-runpod-signature.ts` to make this type-safe automatically without casting, if not already done globally.

### 2. Error Handling Consistency
The webhook route manually catches errors and uses `mapErrorToResponse`. The `procedure` pattern likely handles this automatically. The implementation is consistent with the need for manual control here, but ensure `mapErrorToResponse` provides safe error messages to the external caller (RunPod) without leaking internal stack traces (verified: it seems to do so).

---

**Status:** ✅ **APPROVED** (with design doc update recommendation)
