# P1-NOTIFY-001: Email Notification Service Implementation Plan

**Status**: Draft (reviewed)
**Work Packet**: P1-NOTIFY-001
**Created**: 2025-12-18
**Last Updated**: 2026-01-05
**Reviewed**: 2026-01-05 (dependency and implementation state review)
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

- ✅ **Platform settings schema and data source for branding** - COMPLETE
  - Package: `packages/platform-settings` (BrandingSettingsService, ContactSettingsService, FeatureSettingsService)
  - Schema: `packages/database/src/schema/settings.ts` (platformSettings, brandingSettings, contactSettings, featureSettings)
  - Validation: `packages/validation/src/schemas/settings.ts`
  - E2E tests: `e2e/tests/07-platform-settings.test.ts`
- Organization membership for creator access rules.
  - Reference: `packages/database/src/schema/content.ts` (organizationMemberships table)
- Observability redaction capabilities.
  - Reference: `packages/observability/src/index.ts`
  - Reference: `packages/observability/src/redact.ts`
- Security and procedure middleware for auth/role checks.
  - Reference: `packages/security/CLAUDE.md`
  - Reference: `packages/worker-utils/src/procedure/` (new procedure-based routing)
  - Reference: `packages/worker-utils/src/auth-middleware.ts`
- Worker scaffolding in `workers/notifications-api`.
  - Reference: `workers/notifications-api/src/index.ts`

---

## Research Inputs and Gaps

**Local context reviewed (deep dive)**:
- `packages/database/CLAUDE.md` (createDbClient, query utilities, schema exports).
- `packages/worker-utils/CLAUDE.md` and `packages/worker-utils/src/procedure/` (createWorker, procedure(), service registry).
- `packages/worker-utils/src/auth-middleware.ts` (authentication middleware).
- `packages/security/CLAUDE.md` (auth middleware patterns).
- `packages/validation/CLAUDE.md` and `packages/validation/src/primitives.ts` (Zod patterns, email schema).
- `packages/observability/CLAUDE.md` and `packages/observability/src/redact.ts` (PII redaction behavior).
- `packages/shared-types/CLAUDE.md` and `packages/shared-types/src/worker-types.ts` (Bindings/Variables).
- `packages/service-errors/CLAUDE.md` (error mapping and BaseService patterns).
- `packages/platform-settings/CLAUDE.md` (branding integration for email templates).
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
- ⚠️ Exists but broken: `packages/notifications/src/index.ts` (exports non-existent code)
- ⚠️ Exists but broken: `packages/notifications/src/types.ts` (imports non-existent schema)
- ✅ Implemented: `packages/notifications/src/errors.ts` (domain errors)
- New: `packages/notifications/src/services/notifications-service.ts`
- New: `packages/notifications/src/templates/renderer.ts`
- New: `packages/notifications/src/providers/` (ResendProvider, ConsoleProvider)
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
- New: `workers/notifications-api/src/routes/preview.ts` (mandatory for Phase 1)
- Update: `workers/notifications-api/wrangler.jsonc`

**Security and routing (updated patterns)**
- Auth middleware: `packages/worker-utils/src/auth-middleware.ts`
- Procedure handlers: `packages/worker-utils/src/procedure/procedure.ts`
- Service registry: `packages/worker-utils/src/procedure/service-registry.ts`

**Patterns to mirror**
- Route structure with procedure(): `workers/organization-api/src/routes/settings.ts`
- Handler utilities: `@codex/worker-utils` procedure() usage
- Service layer style: `packages/platform-settings/src/services/`

---

## Package Deep Dive (Internal)

**@codex/database**
- Dual clients: `dbHttp` for stateless queries in workers, `createPerRequestDbClient` for transactional writes (cleanup required).
- Query utilities for scoping and pagination: `withOrgScope`, `orgScopedNotDeleted`, `withPagination`.
- Schema exports via `packages/database/src/schema/index.ts`; org membership in `packages/database/src/schema/content.ts`.

**@codex/worker-utils**
- `createWorker` builds standard middleware stack and health checks.
- `procedure()` is the new tRPC-style handler pattern - handles auth, validation, services, and error formatting.
- `createServiceRegistry()` provides lazy-loaded services with proper cleanup.
- Policies defined inline: `{ auth: 'required' | 'optional' | 'none', roles?: string[] }`.

**@codex/security**
- Core middleware: `requireAuth`, `optionalAuth`, `rateLimit`, `securityHeaders`.
- Platform owner check is now done via procedure policy: `{ auth: 'required', roles: ['platform_owner'] }`.
- Session auth with KV secondary storage for fast lookups.

**@codex/validation**
- Central Zod schemas and primitives.
- Use `emailSchema`, `urlSchema`, `uuidSchema`, `createSanitizedStringSchema`, `createOptionalTextSchema` for template payloads.
- New notifications schemas should live in `packages/validation/src/schemas/notifications.ts`.

**@codex/observability**
- `ObservabilityClient` with built-in redaction.
- Default: `redactEmails: true` in production (see `packages/observability/src/index.ts:53-57`).
- Default `EMAIL_PATTERN` catches standard email formats.
- For additional fields (e.g., `recipientEmail`, `templateData`), use `customKeys` option.
- Use structured logs; avoid passing raw email addresses in metadata keys.

**@codex/shared-types**
- `HonoEnv` Bindings and Variables are the shared contract for workers.
- Add email-related env vars here so all workers share consistent bindings.
- Add notification response types in `packages/shared-types/src/api-responses.ts`.

**@codex/service-errors**
- Standard error classes and `mapErrorToResponse`.
- Even if NotificationService is stateless, workers should map errors consistently.

**@codex/organization** (renamed from @codex/identity)
- Organization metadata (name, logoUrl, websiteUrl) can be used as branding fallbacks.

**@codex/platform-settings** ✅ AVAILABLE
- `BrandingSettingsService` - logo, colors, platform name.
- `ContactSettingsService` - support email, contact URL.
- Use for email template branding tokens.
- Import: `import { BrandingSettingsService } from '@codex/platform-settings';`

---

## External Dependencies (Context-7 + Web Sources)

- `resend`: Production email provider SDK (HTML/text or template send); source Context-7.
- `hono`: Worker routing framework used by `workers/notifications-api`; source Context-7.

**Note**: Nodemailer is NOT compatible with Cloudflare Workers (requires Node.js TCP/TLS). See Local Development Strategy section for alternatives.
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

**Local Development Strategy (Workers-compatible)**
- Nodemailer is NOT compatible with Cloudflare Workers (no TCP sockets).
- Options for local email testing:
  1. **Console mock provider**: Logs email to console instead of sending. Simplest approach.
  2. **MailHog HTTP API**: POST to `http://localhost:8025/api/v2/messages` (HTTP-based, not SMTP).
  3. **Resend test mode**: Use Resend SDK with test API key (sends real emails to test addresses).
- Recommended: Console mock provider for unit tests; MailHog HTTP for integration tests.
- Provider selection via `USE_MOCK_EMAIL` env var.

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

- **Global templates (read/write)**: Platform owner only.
  - Apply `requirePlatformOwner()` middleware (from `@codex/security`) **before** `withPolicy()`.
  - Example: `app.post('/global', requirePlatformOwner(), withPolicy(POLICY_PRESETS.authenticated()), handler)`.
- **Organization templates (write)**: Org owner/admin via `POLICY_PRESETS.orgManagement()`.
  - Requires `:organizationId` in route params (e.g., `/organizations/:organizationId/templates`).
- **Organization templates (read/list)**: Authenticated + explicit membership check in service layer.
  - `requireOrgMembership` relies on subdomain which doesn't apply here.
  - Use `checkOrganizationMembership()` from `packages/worker-utils/src/security-policy.ts` in handler.
- **Creator templates (write)**: Authenticated + creatorId === userId + active org membership.
- **Creator templates (read)**: Authenticated + active org membership for the creator's org.

**Important**: `POLICY_PRESETS` roles are: `user`, `creator`, `admin`, `system`. There is no `platform_owner` preset.

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

**Indexes** (following `content.ts` partial unique index pattern):
- `idx_email_templates_org_id` on (organization_id) for org lookup.
- `idx_email_templates_creator_id` on (creator_id) for creator lookup.
- `idx_email_templates_scope` on (scope) for scope filtering.

**Partial Unique Indexes** (ensure name uniqueness per scope):
```typescript
// Global: unique name when scope = 'global'
uniqueIndex('idx_unique_template_global')
  .on(table.name)
  .where(sql`${table.scope} = 'global'`)

// Organization: unique (name, organization_id) when scope = 'organization'
uniqueIndex('idx_unique_template_org')
  .on(table.name, table.organizationId)
  .where(sql`${table.scope} = 'organization'`)

// Creator: unique (name, creator_id) when scope = 'creator'
uniqueIndex('idx_unique_template_creator')
  .on(table.name, table.creatorId)
  .where(sql`${table.scope} = 'creator'`)
```

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

**Primary source** ✅ IMPLEMENTED
- Platform settings via `@codex/platform-settings` package.
- Schema: `packages/database/src/schema/settings.ts` (brandingSettings, contactSettings tables).
- Service: `BrandingSettingsService.getSettings(organizationId)`.

**Fallback order**
- Platform settings (brandingSettings table) -> organization profile -> global defaults.

**Brand tokens to inject** (from brandingSettings)
- Platform name (`platformName`)
- Logo URL (`logoUrl`)
- Primary color (`primaryColor`)
- Secondary color (`secondaryColor`)
- Support email (from contactSettings: `supportEmail`)
- Contact URL (from contactSettings: `websiteUrl`)

**Integration pattern:**
```typescript
import { BrandingSettingsService, ContactSettingsService } from '@codex/platform-settings';

// In NotificationService
const brandingService = new BrandingSettingsService({ db, r2Service });
const contactService = new ContactSettingsService({ db });

const branding = await brandingService.getSettings(organizationId);
const contact = await contactService.getSettings(organizationId);

const brandTokens = {
  platformName: branding.platformName ?? 'Codex',
  logoUrl: branding.logoUrl ?? DEFAULT_LOGO,
  primaryColor: branding.primaryColor ?? '#000000',
  secondaryColor: branding.secondaryColor ?? '#ffffff',
  supportEmail: contact.supportEmail ?? 'support@codex.io',
  contactUrl: contact.websiteUrl ?? 'https://codex.io',
};
```

Creator templates cannot override brand tokens - they only supply content data.

---

## Data Access Strategy (Workers)

**When to use each client** (following current worker patterns):

- **`createDbClient(c.env)`**: Use for all simple CRUD operations (single-table reads/writes).
  - GET endpoints (list, get by ID, preview)
  - Simple POST/PATCH/DELETE that don't need transactions
  - Most template operations fall here
  - **Recommended approach** - ensures proper environment scoping per request

- **`createPerRequestDbClient`**: Use ONLY when you need **transactions**.
  - Multi-table atomic writes (e.g., create template + audit log)
  - Operations requiring rollback capability
  - **Must call `cleanup()` before request ends** (use `c.executionCtx.waitUntil(cleanup())`)

**Query utilities from `@codex/database`**:
- `withPagination({ page, limit })` → `{ limit, offset }`
- `whereNotDeleted(table)` for soft-delete filtering
- Note: `withOrgScope` / `orgScopedNotDeleted` require `organizationId` column - not applicable to global templates

---

## Error Handling and Response Strategy

- Library code should throw `@codex/service-errors` types where possible.
- Worker handlers should map errors via `mapErrorToResponse` for consistent envelopes.
- `createAuthenticatedHandler` already handles invalid JSON and Zod validation errors.

---

## Environment Variables and Bindings

**Add to `packages/shared-types/src/worker-types.ts` Bindings type:**

```typescript
// Email provider configuration
RESEND_API_KEY?: string;        // Resend API key (secret)
FROM_EMAIL?: string;            // Sender email address (e.g., "noreply@codex.io")
FROM_NAME?: string;             // Sender display name (e.g., "Codex Platform")
REPLY_TO_EMAIL?: string;        // Reply-to address (optional)

// Local development
USE_MOCK_EMAIL?: string;        // "true" to use mock provider instead of Resend
MAILHOG_API_URL?: string;       // MailHog HTTP API URL (e.g., "http://localhost:8025")
```

**Update `workers/notifications-api/src/utils/validate-env.ts`:**

```typescript
// Required in production
const required = ['DATABASE_URL', 'RESEND_API_KEY', 'FROM_EMAIL'];

// Required KV bindings
if (!env.RATE_LIMIT_KV) { ... }

// Optional with defaults
const optional = ['ENVIRONMENT', 'FROM_NAME', 'REPLY_TO_EMAIL', 'USE_MOCK_EMAIL'];
```

**Wrangler notes:**
- `vars` are non-secret bindings; not inherited across `env.*` blocks - must define per environment.
- Secrets (`RESEND_API_KEY`) via `wrangler secret put` per environment.
- `wrangler secret put` creates a new Worker version and deploys immediately.

---

## Worker Endpoints (Phase 1)

**Route Shapes** (concrete paths):

```
# Global templates (platform owner only)
GET    /api/templates/global                    # List global templates
POST   /api/templates/global                    # Create global template
GET    /api/templates/global/:id                # Get global template
PATCH  /api/templates/global/:id                # Update global template
DELETE /api/templates/global/:id                # Delete global template

# Organization templates
GET    /api/organizations/:organizationId/templates      # List org templates
POST   /api/organizations/:organizationId/templates      # Create org template
GET    /api/templates/:id                                # Get any template by ID
PATCH  /api/organizations/:organizationId/templates/:id  # Update org template
DELETE /api/organizations/:organizationId/templates/:id  # Delete org template

# Creator templates
GET    /api/templates/creator                   # List current user's creator templates
POST   /api/templates/creator                   # Create creator template
PATCH  /api/templates/creator/:id               # Update own creator template
DELETE /api/templates/creator/:id               # Delete own creator template

# Preview/Test (recommended - make mandatory for Phase 1)
POST   /api/templates/:id/preview               # Render with test data, return HTML/text
POST   /api/templates/:id/test-send             # Send test email to specified address
```

**Middleware composition per route type (using procedure()):**

```typescript
import { procedure } from '@codex/worker-utils';

// Global template routes - platform owner only
app.post('/api/templates/global',
  procedure({
    policy: { auth: 'required', roles: ['platform_owner'] },
    input: { body: createGlobalTemplateSchema },
    handler: async (ctx) => {
      return await ctx.services.notifications.createGlobalTemplate(ctx.input.body);
    },
  })
);

// Org template routes - org admin required
app.post('/api/organizations/:organizationId/templates',
  procedure({
    policy: { auth: 'required', roles: ['admin', 'owner'] },
    input: { body: createOrgTemplateSchema, params: orgIdParamSchema },
    handler: async (ctx) => {
      // Verify org membership in handler or service
      return await ctx.services.notifications.createOrgTemplate(
        ctx.input.params.organizationId,
        ctx.input.body
      );
    },
  })
);

// Creator template routes - creator role required
app.post('/api/templates/creator',
  procedure({
    policy: { auth: 'required', roles: ['creator'] },
    input: { body: createCreatorTemplateSchema },
    handler: async (ctx) => {
      return await ctx.services.notifications.createCreatorTemplate(
        ctx.user.id,
        ctx.input.body
      );
    },
  })
);
```

**Key implementation notes:**
- Use `procedure()` pattern with inline policy definitions.
- Roles checked via `policy.roles` array.
- Membership checks for read/list done in service layer.
- Service registry provides lazy-loaded services via `ctx.services`.

---

## Phased Implementation Plan with Checklists

### Phase 0: Decision Alignment

- [x] DB-backed templates with global, org, creator scope.
- [x] Creator templates visible to orgs where creator is an active member.
- [x] Use `workers/notifications-api` for endpoints.
- [x] Library package for core logic.
- [x] Brand defaults from platform settings.

### Phase 0.5: Fix Broken Package Skeleton ⚠️ BLOCKING

The existing `packages/notifications` skeleton exports non-existent code. Must fix before proceeding:

- [ ] Remove or comment out non-existent exports in `packages/notifications/src/index.ts`:
  - `NotificationsService` export (file doesn't exist)
  - Provider exports (directory doesn't exist)
  - `renderTemplate` export (file doesn't exist)
  - Re-exported validation schemas (don't exist yet in @codex/validation)
- [ ] Fix `packages/notifications/src/types.ts` - remove import of `EmailTemplate` from non-existent schema.
- [ ] Fix `packages/notifications/src/services/index.ts` - remove export of non-existent file.
- [ ] Keep `packages/notifications/src/errors.ts` - this is correctly implemented.
- [ ] Verify package compiles with `pnpm build` in packages/notifications.

### Phase 1: Database Schema and Migrations

- [ ] Create `packages/database/src/schema/notifications.ts`.
- [ ] Add template scope fields and constraints (global/org/creator).
- [ ] Add ownership fields for organization and creator with CHECK constraints.
- [ ] Add unique constraints for (scope, name, organization_id, creator_id).
- [ ] Add indexes for lookup by org, creator, and template key.
- [ ] Export schema from `packages/database/src/schema/index.ts`.
- [ ] Add migration via existing DB workflow.
- [ ] Decide on soft-delete vs hard-delete (deletedAt column) and document.

### Phase 1.5: Seed Data Strategy

Global templates need to be seeded for the system to work. Strategy:

- [ ] Create seed script: `packages/database/scripts/seed-email-templates.ts`
- [ ] Add npm script: `pnpm db:seed:templates`
- [ ] Include default templates for:
  - `email-verification` - Email verification link
  - `password-reset` - Password reset link
  - `password-changed` - Password change confirmation
  - `purchase-receipt` - Purchase confirmation receipt
- [ ] Make seed script idempotent (check if template exists before inserting).
- [ ] Document seed command in database CLAUDE.md.

**Seed script pattern:**
```typescript
import { dbWs, schema } from '@codex/database';

const globalTemplates = [
  {
    name: 'email-verification',
    scope: 'global',
    subject: 'Verify your email address',
    htmlBody: '...', // HTML with {{userName}}, {{verificationUrl}}, {{expiryHours}}
    textBody: '...', // Plain text version
    status: 'active',
  },
  // ... more templates
];

async function seedTemplates() {
  for (const template of globalTemplates) {
    const existing = await dbWs.query.emailTemplates.findFirst({
      where: (t) => and(eq(t.name, template.name), eq(t.scope, 'global')),
    });
    if (!existing) {
      await dbWs.insert(schema.emailTemplates).values(template);
      console.log(`Seeded: ${template.name}`);
    }
  }
}
```

### Phase 2: Notifications Library Package

- [ ] Create `packages/notifications` with standard package setup.
- [ ] Add `packages/notifications/src/errors.ts` with domain-specific errors (TemplateNotFoundError, etc.).
- [ ] Add repository layer for template lookup and access rules (org + creator + global).
- [ ] Add renderer with regex-based token replacement and HTML escaping (see Template Rendering Strategy).
- [ ] Add provider interface with implementations:
  - [ ] `ResendProvider` - production email via Resend SDK.
  - [ ] `ConsoleProvider` - logs email to console (dev/test).
  - [ ] `MailHogHttpProvider` - posts to MailHog HTTP API (integration tests).
- [ ] Add `NotificationService` extending `BaseService` from `@codex/service-errors`.
- [ ] Implement single retry on provider failure with immediate retry (no backoff in Phase 1).
- [ ] Use `@codex/observability` - default redaction handles emails in production.
- [ ] Add custom keys to redaction if needed: `recipientEmail`, `templateData`.
- [ ] Add re-exports in `packages/notifications/src/index.ts`.
- [ ] Add package dependencies (resend, @codex/validation, @codex/observability, @codex/service-errors, @codex/database).

### Phase 3: Validation and Shared Types

- [ ] Add `packages/validation/src/schemas/notifications.ts` for template CRUD and preview payloads.
- [ ] Export schemas in `packages/validation/src/index.ts`.
- [ ] Add response types to `packages/shared-types/src/api-responses.ts`.
- [ ] Export from `packages/shared-types/src/index.ts`.
- [ ] Extend `packages/shared-types/src/worker-types.ts` with email-related bindings.

### Phase 4: Notifications API Worker

- [ ] Add template routes in `workers/notifications-api/src/routes/templates.ts`.
- [ ] Add preview/test routes in `workers/notifications-api/src/routes/preview.ts` (mandatory for Phase 1).
- [ ] Wire routes in `workers/notifications-api/src/index.ts`.
- [ ] Update `workers/notifications-api/src/utils/validate-env.ts` for new vars.
- [ ] Update `workers/notifications-api/wrangler.jsonc` for bindings and vars.
- [ ] Add `[env.test]` block to wrangler.jsonc for test environment.
- [ ] Add `@codex/notifications` and `@codex/validation` to `workers/notifications-api/package.json`.
- [ ] Import and apply `requirePlatformOwner()` from `@codex/security` for global template routes (standalone middleware, not policy preset).
- [ ] Use `POLICY_PRESETS.orgManagement()` for org template writes (requires `:organizationId` in route path).
- [ ] Add explicit membership checks via `checkOrganizationMembership()` for read/list (subdomain not available).

### Phase 5: Branding Integration ✅ Settings Available

- [ ] Add `@codex/platform-settings` dependency to `packages/notifications`.
- [ ] Inject `BrandingSettingsService` and `ContactSettingsService` into `NotificationService`.
- [ ] Implement brand token sourcing in renderer:
  ```typescript
  const branding = await brandingService.getSettings(organizationId);
  const contact = await contactService.getSettings(organizationId);
  const brandTokens = { platformName, logoUrl, primaryColor, secondaryColor, supportEmail, contactUrl };
  ```
- [ ] Ensure renderer merges brand tokens with template data safely (brand tokens cannot be overridden).
- [ ] Document expected brand fields and fallbacks in CLAUDE.md.

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

## Template Rendering Strategy

**Token Replacement Implementation:**
- Use simple regex-based replacement: `{{tokenName}}` pattern.
- No third-party template libraries (Handlebars, etc.) - security risk and bundle size.
- Whitelist allowed tokens per template type (defined in validation schemas).

**Escaping:**
- All injected values HTML-escaped via built-in `escapeHtml()` function.
- Escape: `<`, `>`, `&`, `"`, `'` → HTML entities.
- URLs validated via Zod before injection (prevent javascript: URIs).

**Missing Token Handling:**
- Log warning with template key and missing token name.
- Render as empty string (not placeholder text).
- Do NOT fail the send - partial content better than no email.

**Implementation:**
```typescript
function renderTemplate(
  template: string,
  data: Record<string, string>,
  allowedTokens: string[]
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, token) => {
    if (!allowedTokens.includes(token)) {
      console.warn(`Unknown token: ${token}`);
      return '';
    }
    const value = data[token];
    if (value === undefined) {
      console.warn(`Missing token value: ${token}`);
      return '';
    }
    return escapeHtml(value);
  });
}
```

---

## Testing Strategy (English)

**Unit tests** (`packages/notifications/src/__tests__/`):
- Template rendering with valid/invalid tokens.
- HTML escaping (XSS prevention).
- Brand token injection and fallbacks.
- Access rules for each scope (global/org/creator).
- Template resolution order.
- Provider mocks (Resend, console mock).

**Worker route tests** (`workers/notifications-api/src/__tests__/`):
- CRUD operations for each scope.
- Preview endpoint rendering.
- Access control enforcement (403 for unauthorized).
- Validation errors (400 for bad input).

**Existing test infrastructure:**
- Vitest config exists: `workers/notifications-api/vitest.config.ts`
- Uses `@cloudflare/vitest-pool-workers` with Miniflare.
- Config references `wrangler.jsonc` with `environment: 'test'`.
- Add `[env.test]` block to wrangler.jsonc with test bindings.

**Redaction tests:**
- Verify `recipientEmail`, `senderEmail` not in log output.
- Use `customKeys` option in observability if needed beyond default `EMAIL_PATTERN`.

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

- **Access control mistakes**: Add explicit tests for every scope and role combination.
- **Brand data missing**: Enforce fallbacks (org profile → hardcoded defaults) and log warnings only in dev.
- **Template resolution confusion**: Log which scope was selected for debugging.
- **Deliverability issues**: Verify sender domain early and test in staging before production.
- **Scope creep**: Keep Phase 1 limited to transactional templates only.
- **Org membership checks**: Use explicit membership queries in service layer.
- **Local dev email testing**: Nodemailer incompatible with Workers; use console mock or MailHog HTTP API.
- ~~**Platform settings dependency**: If P1-SETTINGS-001 not complete, use org profile data as fallback for branding.~~ ✅ RESOLVED - `@codex/platform-settings` is available.
- **Broken package skeleton**: Existing `packages/notifications` exports non-existent code - must fix before implementing (see Phase 0.5).

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
- 2025-12-19: **Codebase alignment review** - Fixed critical issues:
  - Clarified `requirePlatformOwner` is standalone middleware, not a policy preset.
  - Replaced Nodemailer (incompatible with Workers) with console mock / MailHog HTTP API.
  - Clarified `dbHttp` vs `createPerRequestDbClient` usage (transactions only for latter).
  - Added explicit TypeScript additions for Bindings type.
  - Added concrete route shapes with middleware composition examples.
  - Added partial unique index pattern matching `content.ts`.
  - Added Template Rendering Strategy section with escaping and token handling.
  - Updated Testing Strategy to reference existing vitest.config.ts.
  - Made preview endpoint mandatory for Phase 1.
- 2026-01-05: **Dependency and implementation state review**:
  - ✅ Marked P1-SETTINGS-001 as COMPLETE - `@codex/platform-settings` fully implemented.
  - Updated branding integration to reference actual `BrandingSettingsService` and `ContactSettingsService`.
  - Added Phase 0.5: Fix broken package skeleton (critical blocking issue).
  - Added Phase 1.5: Seed data strategy with `pnpm db:seed:templates` command.
  - Updated middleware patterns from `withPolicy()`/`createAuthenticatedHandler()` to `procedure()`.
  - Updated file references to reflect renamed packages (`@codex/identity` → `@codex/organization`).
  - Updated data access pattern to recommend `createDbClient(c.env)` over global `dbHttp`.
  - Added integration code example for platform-settings branding tokens.
