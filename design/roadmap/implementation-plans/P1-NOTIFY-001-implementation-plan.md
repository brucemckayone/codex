# P1-NOTIFY-001: Email Notification Service Implementation Plan

**Status**: Draft (feedback-driven)
**Work Packet**: P1-NOTIFY-001
**Created**: 2025-12-18
**Last Updated**: 2025-12-19
**Owner**: TBD

---

## Executive Summary

- Build a DB-backed, provider-agnostic email system with global, organization, and creator templates.
- Use `workers/notifications-api` for template management endpoints.
- Put core logic in a new `packages/notifications` library package.
- Apply organization and creator branding defaults from platform settings.
- Keep PII safe and operations calm with clear rules and strong logging hygiene.

---

## Decisions (Locked)

- Templates are DB-backed with three scopes: global, organization, creator.
- Organizations can access creator templates only if the creator is an active member of that org.
- Template resolution order: organization -> creator (org member) -> global.
- Use existing notifications API worker for endpoints and routing.
- Majority of logic lives in `packages/notifications`.
- Branding defaults come from the platform settings (brand table) and align with brand colors.
- Template rendering uses safe token replacement with HTML escaping (no arbitrary code).
- API shape is template-based `sendEmail` with template keys and structured data.
- Retry strategy in Phase 1 is one retry on provider failure, then fail fast.

---

## Scope (Phase 1)

**In scope**
- DB schema for templates with scope and ownership rules.
- Template CRUD endpoints in the notifications worker.
- Template resolution with org and creator access rules.
- Rendering with brand tokens and template data.
- Provider abstraction with Resend in production.
- Tests for access rules, rendering, and worker routes.
- Core templates: verification, password reset, purchase receipt (password changed if time allows).

**Out of scope**
- Marketing or bulk sends.
- In-app notifications, SMS, or push.
- Full UI editor for templates.
- Queue or DLQ (beyond a single retry).

---

## Dependencies and Preconditions

- Platform settings schema and data source for branding.
  - Reference: `design/roadmap/work-packets/P1-SETTINGS-001-platform-settings.md`
- Organization membership for creator access rules.
  - Reference: `packages/database/src/schema/content.ts`
- Observability redaction capabilities.
  - Reference: `packages/observability/src/index.ts`
  - Reference: `packages/observability/src/redact.ts`
- Security and policy middleware for auth/role checks.
  - Reference: `packages/security/CLAUDE.md`
  - Reference: `packages/worker-utils/src/security-policy.ts`
- Worker scaffolding in `workers/notifications-api`.
  - Reference: `workers/notifications-api/src/index.ts`
  - Reference: `workers/notifications-api/src/utils/validate-env.ts`

---

## Research Inputs and Gaps

**Local context reviewed (deep dive)**:
- `packages/database/CLAUDE.md` (dbHttp vs dbWs, query utilities, schema exports).
- `packages/worker-utils/CLAUDE.md` and `packages/worker-utils/src/security-policy.ts` (createWorker, withPolicy, org checks).
- `packages/worker-utils/src/route-helpers.ts` (createAuthenticatedHandler pattern).
- `packages/security/CLAUDE.md` and `packages/security/src/platform-owner-auth.ts` (requirePlatformOwner).
- `packages/validation/CLAUDE.md` and `packages/validation/src/primitives.ts` (Zod patterns, email schema).
- `packages/observability/CLAUDE.md` and `packages/observability/src/redact.ts` (PII redaction behavior).
- `packages/shared-types/CLAUDE.md` and `packages/shared-types/src/worker-types.ts` (Bindings/Variables).
- `packages/service-errors/CLAUDE.md` (error mapping and BaseService patterns).
- `workers/notifications-api/CLAUDE.md` (worker setup and constraints).

**Context-7 map**:
- Context-7 used for external package docs (Resend, Hono, Drizzle ORM, Zod, Nodemailer, Cloudflare Workers, Vitest, Vite).
- Wrangler CLI and Cloudflare package readmes are not in Context-7; see web sources below.

**Web research**:
- Wrangler configuration docs (wrangler.jsonc/toml; env inheritance; bindings not inheritable).
- Wrangler commands docs (secret put prompts or stdin; creates a new version and deploys).
- Cloudflare Workers Vitest integration docs (custom pool, Miniflare, isolated storage, multiple workers).
- NPM registry metadata for `@cloudflare/workers-types` (runtime typings description).

---

## Implementation Map (File References)

**Database**
- New: `packages/database/src/schema/notifications.ts`
- Export: `packages/database/src/schema/index.ts`
- Membership rules: `packages/database/src/schema/content.ts`

**Notifications library**
- New: `packages/notifications/src/index.ts`
- New: `packages/notifications/src/service.ts`
- New: `packages/notifications/src/repositories/`
- New: `packages/notifications/src/templates/`
- New: `packages/notifications/src/providers/`
- New: `packages/notifications/CLAUDE.md`

**Validation**
- New: `packages/validation/src/schemas/notifications.ts`
- Export: `packages/validation/src/index.ts`
- Email primitives: `packages/validation/src/primitives.ts`

**Shared types**
- Extend: `packages/shared-types/src/api-responses.ts`
- Export: `packages/shared-types/src/index.ts`
- Update bindings: `packages/shared-types/src/worker-types.ts`

**Worker**
- Update: `workers/notifications-api/src/index.ts`
- New: `workers/notifications-api/src/routes/templates.ts`
- New: `workers/notifications-api/src/routes/preview.ts` (optional but recommended)
- Update: `workers/notifications-api/src/utils/validate-env.ts`
- Update: `workers/notifications-api/wrangler.jsonc`

**Security and policies**
- Platform owner auth: `packages/security/src/platform-owner-auth.ts`
- Policy logic: `packages/worker-utils/src/security-policy.ts`
- Authenticated handler: `packages/worker-utils/src/route-helpers.ts`

**Patterns to mirror**
- Route structure and policy usage: `workers/content-api/src/routes/content.ts`
- Handler utilities: `@codex/worker-utils` usage in workers
- Service layer style: `packages/content/src/services/content-service.ts`

---

## Package Deep Dive (Internal)

**@codex/database**
- Dual clients: `dbHttp` for stateless queries in workers, `createPerRequestDbClient` for transactional writes (cleanup required).
- Query utilities for scoping and pagination: `withOrgScope`, `orgScopedNotDeleted`, `withPagination`.
- Schema exports via `packages/database/src/schema/index.ts`; org membership in `packages/database/src/schema/content.ts`.

**@codex/worker-utils**
- `createWorker` builds standard middleware stack and health checks.
- `createAuthenticatedHandler` handles JSON parsing, validation, auth checks, and error formatting.
- `withPolicy` enforces rate limits and auth; `requireOrgMembership` uses org subdomain; `requireOrgManagement` uses route params (`:id` or `:organizationId`).
- `POLICY_PRESETS` provide common policies (public, authenticated, creator, orgManagement).

**@codex/security**
- Core middleware: `requireAuth`, `optionalAuth`, `rateLimit`, `securityHeaders`.
- `requirePlatformOwner` enforces `user.role === 'platform_owner'` (use for global template management).

**@codex/validation**
- Central Zod schemas and primitives.
- Use `emailSchema`, `urlSchema`, `uuidSchema`, `createSanitizedStringSchema`, `createOptionalTextSchema` for template payloads.
- New notifications schemas should live in `packages/validation/src/schemas/notifications.ts`.

**@codex/observability**
- `ObservabilityClient` with built-in redaction.
- Redaction defaults are environment-based; for notifications, override to always redact emails.
- Use structured logs and avoid raw email addresses in metadata.

**@codex/shared-types**
- `HonoEnv` Bindings and Variables are the shared contract for workers.
- Add email-related env vars here so all workers share consistent bindings.
- Add notification response types in `packages/shared-types/src/api-responses.ts`.

**@codex/service-errors**
- Standard error classes and `mapErrorToResponse`.
- Even if NotificationService is stateless, workers should map errors consistently.

**@codex/identity**
- Organization metadata (name, logoUrl, websiteUrl) can be used as branding fallbacks if platform settings are missing.

---

## External Dependencies (Context-7 + Web Sources)

- `resend`: Production email provider SDK (HTML/text or template send); source Context-7.
- `nodemailer`: Local SMTP provider for dev (MailHog); source Context-7.
- `hono`: Worker routing framework used by `workers/notifications-api`; source Context-7.
- `drizzle-orm`: Database query layer used by `@codex/database`; source Context-7.
- `zod`: Schema validation engine used by `@codex/validation`; source Context-7.
- `wrangler`: Worker config and secrets management; source Cloudflare docs (web).
- `@cloudflare/vitest-pool-workers`: Workers runtime test pool; source Cloudflare docs/README (web).
- `@cloudflare/workers-types`: Worker runtime TypeScript types; source NPM registry (web).
- `vitest`: Test runner; source Context-7.
- `vite`: Build tooling for library packages and workers; source Context-7.

---

## External Dependencies Deep Dive (Context-7 + Web)

**Resend (email provider)**
- Send API supports `from`, `to`, `subject`, `html`, `text`, and `reply_to` (from must be a verified domain).
- Template support exists via `template_id` + `template_variables`, but our Phase 1 plan renders HTML/text in-platform.
- Alternative template payload uses `template: { id, variables }` for transactional sends.
- Response returns a unique email `id`; capture it for logging.
- Node SDK uses `resend.emails.send({ from, to, subject, html, text })`.

**Nodemailer (local SMTP)**
- `createTransport({ host, port, secure, auth })` is the core setup.
- `sendMail({ from, to, subject, text, html })` returns `messageId` and delivery info.
- `verify()` can confirm SMTP connectivity in dev.
- Common error codes: `EAUTH`, `ECONNREFUSED`, `ETIMEDOUT`, `ETLS`.
- Connection pooling exists for high-volume sending, but is not required for Phase 1.

**Hono (worker routing)**
- Middleware runs before/after handlers; returning a `Response` short-circuits the chain.
- `app.use()` applies middleware globally or by path; use `createMiddleware()` for type safety.
- Combine middleware with `every`/`some` patterns when needed.

**Cloudflare Workers (runtime + bindings)**
- Bindings are capabilities exposed on `env` (KV, R2, secrets).
- Bindings are defined in `wrangler.jsonc`; secrets are not exposed directly.
- Remote bindings are supported in local dev (`remote: true`) and via `@cloudflare/vitest-pool-workers`.

**Wrangler (worker config + secrets)**
- Required keys to deploy: `name`, `main`, `compatibility_date`.
- Environments use `[env.<name>]` blocks and `--env`; bindings like `vars` and `kv_namespaces` are not inheritable and must be defined per environment.
- `wrangler secret put` prompts for input or accepts stdin, and creates a new Worker version and deploys immediately.

**@cloudflare/vitest-pool-workers (Workers test pool)**
- Runs Vitest inside the Workers runtime using Miniflare.
- Supports unit + integration tests, isolated per-test storage, and multiple workers.
- Provides declarative mocking of outbound requests and fast reruns with Vitest HMR.

**@cloudflare/workers-types (runtime typings)**
- TypeScript typings package for the Workers runtime (use in `tsconfig` types).

**Drizzle ORM (schema + migrations)**
- Use `pgTable`, `pgEnum`, and schema definitions to keep TypeScript and SQL aligned.
- Schema paths are configured in `drizzle.config.ts` for migration generation.
- Indexes, unique constraints, and CHECK constraints should mirror validation rules.

**Zod (validation)**
- Use `.refine()` for cross-field checks; `path` can target a specific field in errors.
- `safeParse` supports non-throwing validation flows for workers.
- Async validation requires `.parseAsync()` and is optional for Phase 1.

**Vitest (tests)**
- Use `vi.mock`, `vi.fn`, and `vi.spyOn` for provider and repository mocks.
- Note: internal module calls can’t be overridden by mocking exports in the same file.

**Vite (build)**
- Library mode supports externalizing dependencies via `build.lib` and Rollup externals.
- Keep `packages/notifications` aligned with existing package build configs.

---

## Integration Points (Phase 1)

- **Auth flows**: verification, password reset, password changed.
- **E-commerce**: purchase receipt after webhook completion.
- **Admin**: platform owner template management via notifications API.

This plan focuses on notification infrastructure and template management; feature integrations are wired in their own work packets.

---

## Template Ownership and Access Rules (English)

**Scopes**
- Global: platform-owned templates.
- Organization: templates owned by an organization.
- Creator: templates authored by a creator.

**Access rules**
- An organization can read:
  - Global templates.
  - Organization templates for its own org.
  - Creator templates where the creator has an active membership in that org.
- A creator can edit only their creator templates.
- Organization admins can edit only organization templates.
- Platform owner can edit global templates.

**Membership signal**
- Use `organization_memberships` in `packages/database/src/schema/content.ts`.

---

## Access Control Matrix (English)

- **Global templates**: platform owner only (use `requirePlatformOwner`).
- **Organization templates (write)**: org owner/admin via `POLICY_PRESETS.orgManagement()` with `:organizationId` in route params.
- **Organization templates (read/list)**: authenticated + explicit membership check (subdomain-based policy does not apply here).
- **Creator templates (write)**: authenticated creator + creatorId must match userId + active org membership.
- **Creator templates (read)**: authenticated + active org membership for the org the creator belongs to.

This section should be updated when we finalize the route shapes and auth flows.

---

## Data Model and Storage (English)

**Table name**: align with Phase 1 TDD (`email_templates`) unless we explicitly rename.

**Core fields**:
- Template identity: `id`, `name` (template key), `scope` (global/org/creator).
- Ownership: `organization_id` (nullable), `creator_id` (nullable), `created_by`.
- Content: `subject`, `html_body`, `text_body`, `description`.
- State: `status` (draft/active/archived) and optional `deleted_at` for soft delete.
- Audit: `created_at`, `updated_at`.

**Constraints**:
- Global templates must not have owner IDs.
- Org templates require `organization_id` and no `creator_id`.
- Creator templates require `creator_id` and (optionally) an org association for visibility rules.
- Unique template key per scope and owner.

**Indexes**:
- (organization_id, name) for org lookup.
- (creator_id, name) for creator lookup.
- (scope, name) for global lookups.

**Seed data**:
- Global defaults for verification, password reset, purchase receipt (and password changed if included).

---

## Template Resolution (English)

Given a template key, organizationId, and optional creatorId:
1. Use organization template if present.
2. Else use creator template if creator is an active org member.
3. Else use global template.
4. If none found, return a clear error and log the miss with PII redaction.

Log which scope was used to reduce debugging time.

---

## Template Keys and Required Data (Draft)

Align with `design/features/notifications/ttd-dphase-1.md` and keep keys stable:

- `email-verification`: userName, verificationUrl, expiryHours
- `password-reset`: userName, resetUrl, expiryHours
- `password-changed`: userName, supportUrl (optional)
- `purchase-receipt`: userName, contentTitle, priceCents, purchaseDate, contentUrl, receiptUrl (optional)

Keep template data contracts in `packages/validation/src/schemas/notifications.ts` and re-export types from `packages/notifications`.
Template bodies should use simple `{{token}}` placeholders with a whitelisted token map.

---

## Branding and Defaults (English)

**Primary source**
- Platform settings (brand table) as defined in `design/roadmap/work-packets/P1-SETTINGS-001-platform-settings.md`.
- Ensure platform settings schema aligns with `organizations.id` type when implemented.

**Fallback order**
- Platform settings -> organization profile -> global defaults.

**Brand tokens to inject**
- Platform name
- Logo URL
- Primary color
- Secondary color
- Support email
- Contact URL

Decide whether creator templates can override brand tokens or only supply content data. Default assumption is that brand tokens come from org settings and cannot be overridden by template data.

---

## Data Access Strategy (Workers)

- Read-only endpoints (list/get/preview) should use `dbHttp`.
- Write endpoints (create/update/delete) should use `createPerRequestDbClient` with explicit cleanup (follow `workers/content-api/src/routes/content.ts` pattern).
- Use query utilities from `@codex/database` for pagination and scoping (`withPagination`, `withOrgScope`, `orgScopedNotDeleted`).

---

## Error Handling and Response Strategy

- Library code should throw `@codex/service-errors` types where possible.
- Worker handlers should map errors via `mapErrorToResponse` for consistent envelopes.
- `createAuthenticatedHandler` already handles invalid JSON and Zod validation errors.

---

## Environment Variables and Bindings (Draft)

Add to `packages/shared-types/src/worker-types.ts` and validate in `workers/notifications-api/src/utils/validate-env.ts`:

- `RESEND_API_KEY` (prod provider auth)
- `FROM_EMAIL` (sender address)
- `FROM_NAME` (sender display name) - pick this naming and align docs
- `REPLY_TO_EMAIL` (optional)
- `USE_MOCK_EMAIL` (dev switch)
- `SMTP_HOST`, `SMTP_PORT` (MailHog/local SMTP)

Align names with existing env conventions and update `workers/notifications-api/wrangler.jsonc` accordingly.
Wrangler notes:
- `vars` are non-secret environment bindings and are not inherited across `env.*` blocks.
- Secrets should be set via `wrangler secret put` per environment; this creates a new Worker version and deploys.

---

## Worker Endpoints (Phase 1)

**Core**
- List templates for org (global + org + creator members).
- Create template (org or creator).
- Read template by id.
- Update template.
- Delete or archive template.

**Recommended**
- Preview template with test data.
- Test-send template to a specified email.

All endpoints should follow route patterns in `workers/content-api/src/routes/content.ts` and use `@codex/worker-utils` policies for auth and role checks.
Key policy notes:
- `requirePlatformOwner` is needed for global template management (platform_owner role is not part of `POLICY_PRESETS`).
- `POLICY_PRESETS.orgManagement()` requires `:id` or `:organizationId` route params.
- `requireOrgMembership` uses org subdomain; notifications-api is not org-scoped by subdomain, so membership checks likely live in handler/repository.

---

## Phased Implementation Plan with Checklists

### Phase 0: Decision Alignment

- [x] DB-backed templates with global, org, creator scope.
- [x] Creator templates visible to orgs where creator is an active member.
- [x] Use `workers/notifications-api` for endpoints.
- [x] Library package for core logic.
- [x] Brand defaults from platform settings.

### Phase 1: Database Schema and Migrations

- [ ] Create `packages/database/src/schema/notifications.ts`.
- [ ] Add template scope fields and constraints (global/org/creator).
- [ ] Add ownership fields for organization and creator with CHECK constraints.
- [ ] Add unique constraints for (scope, name, organization_id, creator_id).
- [ ] Add indexes for lookup by org, creator, and template key.
- [ ] Export schema from `packages/database/src/schema/index.ts`.
- [ ] Add migration via existing DB workflow.
- [ ] Decide on soft-delete vs hard-delete (deletedAt column) and document.

### Phase 2: Notifications Library Package

- [ ] Create `packages/notifications` with standard package setup.
- [ ] Add repository layer for template lookup and access rules (org + creator + global).
- [ ] Add renderer with token replacement and HTML escaping (no arbitrary code).
- [ ] Add provider interface and Resend provider implementation.
- [ ] Add NotificationService with PII-safe logging and single retry.
- [ ] Use `@codex/observability` with `redactEmails: true` override.
- [ ] Use `@codex/service-errors` for consistent error mapping.
- [ ] Add re-exports in `packages/notifications/src/index.ts`.
- [ ] Add package dependencies (Resend, validation, observability, service-errors).

### Phase 3: Validation and Shared Types

- [ ] Add `packages/validation/src/schemas/notifications.ts` for template CRUD and preview payloads.
- [ ] Export schemas in `packages/validation/src/index.ts`.
- [ ] Add response types to `packages/shared-types/src/api-responses.ts`.
- [ ] Export from `packages/shared-types/src/index.ts`.
- [ ] Extend `packages/shared-types/src/worker-types.ts` with email-related bindings.

### Phase 4: Notifications API Worker

- [ ] Add template routes in `workers/notifications-api/src/routes/templates.ts`.
- [ ] Add preview/test routes in `workers/notifications-api/src/routes/preview.ts` (if in scope).
- [ ] Wire routes in `workers/notifications-api/src/index.ts`.
- [ ] Update `workers/notifications-api/src/utils/validate-env.ts` for new vars.
- [ ] Update `workers/notifications-api/wrangler.jsonc` for bindings and vars.
- [ ] Add `@codex/notifications` and `@codex/validation` to `workers/notifications-api/package.json`.
- [ ] Apply `requirePlatformOwner` for global template routes.
- [ ] Use `POLICY_PRESETS.orgManagement()` for org template writes (organizationId in route params).
- [ ] Add explicit membership checks for read/list when subdomain is not available.

### Phase 5: Branding Integration

- [ ] Define brand token sourcing rules in `packages/notifications`.
- [ ] Read platform settings data once available.
- [ ] Ensure renderer merges brand tokens with template data safely.
- [ ] Document expected brand fields and fallbacks.

### Phase 6: Tests

- [ ] Renderer unit tests in `packages/notifications`.
- [ ] Access rule tests for org and creator scope.
- [ ] NotificationService tests with provider mocks.
- [ ] Worker route tests for CRUD and preview/test send.
- [ ] Redaction tests using `packages/observability`.

### Phase 7: Documentation and Ops

- [ ] Add `packages/notifications/CLAUDE.md`.
- [ ] Update `workers/notifications-api/CLAUDE.md` with env vars and routes.
- [ ] Add template lifecycle notes and usage examples.
- [ ] Keep this plan updated as decisions evolve.

---

## Testing Strategy (English)

- Unit tests for template rendering and brand token injection.
- Unit tests for access rules and template resolution order.
- Worker route tests for CRUD and preview/test.
- Redaction tests to ensure no raw emails in logs.
- Provider tests using mock adapters only.
- Use worker test pool (`@cloudflare/vitest-pool-workers`) for notifications worker routes.

---

## Definition of Done (Phase 1)

- Templates stored in DB with global, org, and creator scopes.
- Access rules enforce org membership and creator ownership.
- Template resolution works with clear fallback order.
- Notifications API worker exposes CRUD endpoints with proper role checks.
- Brand defaults applied from platform settings with safe fallbacks.
- PII-safe logging with redaction tests.
- Tests passing for renderer, access rules, and worker routes.
- Documentation complete for the new package and worker.
- Shared bindings and env validation updated for email configuration.

---

## Risks and Mitigations

- Access control mistakes: add explicit tests for every scope and role.
- Brand data missing: enforce fallbacks and log warnings only in dev.
- Template resolution confusion: log which scope was selected.
- Deliverability issues: verify sender domain early and test in staging.
- Scope creep: keep Phase 1 limited to transactional templates only.
- Org membership checks: `requireOrgMembership` relies on subdomain; add explicit checks for notifications API routes.

---

## Maintenance and Self-Care Plan

- Keep sessions small with clear stop points and a written next step.
- Make one change category at a time (schema, library, worker, tests).
- Avoid late-night deliverability debugging; schedule it for daytime.
- Treat this plan as the single source of truth and update it after decisions.

---

## Feedback Log

- 2025-12-18: Draft created.
- 2025-12-18: Locked DB-backed templates with global, org, creator scope.
- 2025-12-18: Use notifications API worker with shared library package.
- 2025-12-18: Brand defaults aligned with platform settings.
- 2025-12-18: Added deep-dive package context, access control matrix, and env binding notes.
