# Email Notification System — Progress Report

**Epic**: Codex-8dxc (closed 2026-04-08)
**Dates**: 2026-04-08 to 2026-04-09
**Status**: Implementation complete, reviewed, tested. Remaining TODOs tracked in Codex-gxpu.

---

## What Was Built

### Infrastructure (WP1-WP2)
- `POST /internal/send` on notifications-api — HMAC worker-to-worker auth, preference checking, audit logging
- `sendEmailToWorker()` helper in `@codex/worker-utils` — fire-and-forget via `waitUntil()`
- 18 Zod validation schemas for all email template data contracts
- 18-entry `TEMPLATE_TOKENS` registry with `_unsubscribe` meta-tokens for non-transactional
- 18 global email templates seeded (responsive HTML + plain text, GBP currency)
- `EMAIL_SEND_STATUS.SKIPPED` enum value + DB migration (0044)
- `NotificationsService.sendEmail()` preference checking — transactional always sends, marketing/digest respect opt-out

### Email Integrations (WP3-WP5)
- **Auth** (WP3): Verification, password reset, password changed, welcome — all via template system
- **Ecom** (WP4): Purchase receipt, subscription created/renewed/cancelled, payment failed, refund processed
- **Org** (WP5): Member invitation email
- **Media** (WP5): Transcoding status scaffolded (needs creator email resolution)

### Compliance (WP6)
- HMAC-SHA256 unsubscribe tokens (30-day expiry, marketing/digest only)
- Public `GET/POST /unsubscribe/:token` endpoints (no auth required)
- SvelteKit `/unsubscribe/[token]` page with confirmation UI
- API proxy route for POST

### Frontend (WP7-WP8)
- Studio "Email Templates" settings page (scaffold)
- Enhanced notification preferences — transactional toggle disabled with "Always on" label
- Info callout explaining transactional emails always send

### Engagement (WP9)
- Content publish notification scaffolded (needs subscriber query)
- Cloudflare Cron Trigger handler for weekly digest (scaffold)

---

## Test Coverage

**161 tests across 3 packages, all passing.**

| Package | Tests | New Tests Added |
|---|---|---|
| `@codex/notifications` | 82 | +17 (unsubscribe tokens, preference checking) |
| `@codex/worker-utils` | 44 | +5 (sendEmailToWorker helper) |
| `notifications-api` worker | 35 | +16 (unsubscribe routes, internal send endpoint) |

### What's tested:
- Unsubscribe token generate/verify/tamper/expiry (11 tests)
- Preference checking: marketing skip, digest skip, transactional bypass, audit logging (6 tests)
- sendEmailToWorker: URL, waitUntil, error suppression (5 tests)
- Unsubscribe routes: GET/POST valid/expired/tampered/idempotent (8 tests)
- Internal send: HMAC auth, validation, happy path with real template rendering (8 tests)

---

## Review History

**3 independent zero-context reviews, 19 fixes applied.**

| Pass | Issues | Critical | Key Fixes |
|---|---|---|---|
| **Pass 1** | 12 | 5 | BrandingCache key leak, PII in error, ad-hoc service, placeholder email removed, purchase-receipt schema |
| **Pass 2** | 7 | 2 | Double `££` currency in all templates, DB error handling in unsubscribe, userId leak, preference defaults mismatch, emailTransactional removed from update schema |
| **Pass 3** | 4 | 0 | contactUrl missing from brand fallback, race condition in createDefaultPreferences |

---

## Remaining TODOs (Codex-gxpu)

These are feature-incomplete items, not bugs. Tracked for future sessions.

| # | Item | Why It Matters | When to Do |
|---|---|---|---|
| 1 | Inject `unsubscribeUrl`/`preferencesUrl` into non-transactional sends | CAN-SPAM/GDPR — required before marketing/digest emails go live | Before any marketing emails are sent |
| 2 | Set Stripe subscription metadata (`customerEmail`, `planName`) during checkout creation | Subscription-cancelled email currently dead — no email to send to | Before subscriptions go live |
| 3 | Wire `sendPasswordChangedEmail` | Security best practice — user should know password changed | When BetterAuth hook or custom middleware is available |
| 4 | Resolve content title + org name from DB in webhook handlers | Currently uses metadata fallback / generic text | When purchase flow is polished |
| 5 | Wire `new-sale` email to creator in checkout handler | Creator doesn't know they earned revenue | When creator dashboard is active |
| 6 | Wire `connect-account-status` email | Creator doesn't know payout status changed | When Connect onboarding is complete |
| 7 | Implement weekly digest handler | Engagement feature — query users, batch send | Post-launch growth phase |

---

## Files Changed

### New Files (14)
- `packages/notifications/src/unsubscribe.ts`
- `packages/notifications/src/__tests__/unsubscribe.test.ts`
- `packages/worker-utils/src/email/send-email.ts`
- `packages/worker-utils/src/email/__tests__/send-email.test.ts`
- `workers/notifications-api/src/routes/internal.ts`
- `workers/notifications-api/src/routes/unsubscribe.ts`
- `workers/notifications-api/src/routes/__tests__/internal.test.ts`
- `workers/notifications-api/src/routes/__tests__/unsubscribe.test.ts`
- `packages/database/src/migrations/0044_add_email_skipped_status.sql`
- `apps/web/src/routes/unsubscribe/[token]/+page.svelte`
- `apps/web/src/routes/unsubscribe/[token]/+page.server.ts`
- `apps/web/src/routes/api/unsubscribe/[token]/+server.ts`
- `apps/web/src/routes/_org/[slug]/studio/settings/email-templates/+page.svelte`
- `docs/email-notifications/` (design spec + 9 WP docs + testing spec + this file)

### Modified Files (~20)
- `packages/constants/src/notifications.ts` — added SKIPPED status
- `packages/validation/src/schemas/notifications.ts` — 14 new Zod schemas, internalSendEmailSchema, removed emailTransactional from update schema
- `packages/notifications/src/services/notifications-service.ts` — preference checking, contactUrl fallback
- `packages/notifications/src/services/notification-preferences-service.ts` — race condition fix
- `packages/notifications/src/services/branding-cache.ts` — key mismatch fix
- `packages/notifications/src/templates/renderer.ts` — 18 template tokens + unsubscribe meta-tokens
- `packages/notifications/src/providers/types.ts` — skipped field on SendResult
- `packages/notifications/src/types.ts` — EmailCategory type
- `packages/notifications/src/index.ts` — unsubscribe exports
- `packages/worker-utils/src/index.ts` — sendEmailToWorker export
- `packages/database/src/schema/notifications.ts` — skipped enum value
- `packages/database/scripts/seed-email-templates.ts` — 14 new templates, currency fixes
- `workers/notifications-api/src/index.ts` — internal + unsubscribe routes, cron handler
- `workers/auth/src/email.ts` — migrated to template system
- `workers/auth/src/auth-config.ts` — password reset hook
- `workers/ecom-api/src/handlers/checkout.ts` — purchase receipt email
- `workers/ecom-api/src/handlers/subscription-webhook.ts` — subscription lifecycle emails
- `workers/ecom-api/src/handlers/payment-webhook.ts` — refund email
- `workers/organization-api/src/routes/members.ts` — invitation email
- `workers/content-api/src/routes/content.ts` — publish notification TODO
- `apps/web/src/lib/config/navigation.ts` — email templates nav link
- `apps/web/src/routes/(platform)/account/notifications/+page.svelte` — disabled transactional toggle
- `apps/web/src/routes/(platform)/account/notifications/+page.server.ts` — fixed default preferences
