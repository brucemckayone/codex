# P1-SETTINGS-001: Platform Settings Implementation Plan

**Work Packet**: [P1-SETTINGS-001-platform-settings.md](../work-packets/P1-SETTINGS-001-platform-settings.md)
**Status**: 🚧 Phase 6 (E2E Tests) Ready to Run
**Estimated Effort**: 6-8 hours
**Priority**: P2

---

## Table of Contents

- [Executive Summary](#executive-summary)
- [Architecture Overview](#architecture-overview)
- [Implementation Phases](#implementation-phases)
- [Critical Files](#critical-files)
- [Verification Checklist](#verification-checklist)
- [Extensibility Guide](#extensibility-guide)

---

## Executive Summary

Implement an **extensible Platform Settings system** enabling platform owners to customize branding, configure feature toggles, and manage contact information.

**Architecture Philosophy**: Settings are normalized into domain-specific tables with a composition-based service layer, enabling:
- Clean separation of concerns (branding ≠ contact ≠ features)
- Easy extension (add `email_settings`, `seo_settings` without touching existing code)
- Efficient queries (fetch only what you need, parallel execution)
- Natural mapping to admin UI navigation (tabs → tables)

**Key Decisions**:
- **Normalized schema** - Separate tables: `branding_settings`, `contact_settings`, `feature_settings`
- **Composition pattern** - Specialized services composed into a facade
- **Hierarchical API** - Endpoints mirror table structure (`/settings/branding`, `/settings/contact`)
- **Parallel queries** - `Promise.all()` instead of JOINs for "get all"
- **Public R2 URLs** for logos (no expiry, suitable for branding)

---

## Architecture Overview

### Database Schema - Normalized Hierarchy

```
platform_settings (organization_id PK) ← Hub table for CASCADE DELETE
    │
    ├── branding_settings (organization_id PK FK)
    │       logo_url, logo_r2_path, primary_color_hex
    │
    ├── contact_settings (organization_id PK FK)
    │       platform_name, support_email, contact_url, timezone
    │
    └── feature_settings (organization_id PK FK)
            enable_signups, enable_purchases
```

**Why this structure**:
- **3NF Normalized**: Each table has single responsibility
- **Extensible**: Add `email_settings`, `seo_settings` as new tables without touching existing
- **Efficient**: Query only the table you need; smaller rows = faster scans
- **UI Mapping**: Tables → Admin tabs (Branding, Contact, Features)
- **Cascade cleanup**: Delete org → auto-deletes all settings

### Service Layer - Composition with Facade

```typescript
// Specialized services (internal, domain-focused)
BrandingSettingsService   // Knows about R2, logo upload/delete
ContactSettingsService    // Knows about email validation
FeatureSettingsService    // Knows about feature toggles

// Unified facade (public API)
PlatformSettingsService {
  private branding: BrandingSettingsService;
  private contact: ContactSettingsService;
  private features: FeatureSettingsService;

  // Specialized access (efficient - no unnecessary queries)
  getBranding() → queries branding_settings only
  getContact()  → queries contact_settings only
  getFeatures() → queries feature_settings only

  // Unified access (parallel queries, not JOINs)
  getAllSettings() → Promise.all([branding, contact, features])
}
```

**Why composition over inheritance**:
- **Separation of concerns**: R2 logic isolated to BrandingService
- **Testability**: Mock individual services independently
- **Extensibility**: Add EmailSettingsService without modifying existing code

### API Endpoints - Hierarchical REST

All routes protected by `requirePlatformOwner()` middleware

| Method | Path | Purpose | Response |
|--------|------|---------|----------|
| GET | `/api/settings` | Get all settings (parallel) | `{ branding, contact, features }` |
| GET | `/api/settings/branding` | Get branding only | `{ data: BrandingSettings }` |
| PUT | `/api/settings/branding` | Update branding | `{ data: BrandingSettings }` |
| POST | `/api/settings/branding/logo` | Upload logo (multipart) | `{ data: { logoUrl } }` |
| DELETE | `/api/settings/branding/logo` | Delete logo | 204 No Content |
| GET | `/api/settings/contact` | Get contact only | `{ data: ContactSettings }` |
| PUT | `/api/settings/contact` | Update contact | `{ data: ContactSettings }` |
| GET | `/api/settings/features` | Get features only | `{ data: FeatureSettings }` |
| PUT | `/api/settings/features` | Update features | `{ data: FeatureSettings }` |

**Why hierarchical**:
- **RESTful**: Each resource has dedicated CRUD endpoints
- **Performance**: Frontend fetches only what it needs
- **Discoverability**: Clear API structure matches admin UI tabs

---

## Implementation Phases

### Phase 1: Database Schema (1 hour)

Create normalized tables with proper relationships.

#### 1.1 Create Settings Schema File
**Create**: `packages/database/src/schema/settings.ts`

```typescript
import { pgTable, text, boolean, timestamp, varchar } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { organizations } from './content';

/**
 * Hub table - exists primarily for CASCADE DELETE coordination
 * One row per organization (lazy-created on first settings access)
 */
export const platformSettings = pgTable('platform_settings', {
  organizationId: text('organization_id')
    .primaryKey()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
    .$onUpdate(() => new Date()),
});

/**
 * Branding settings - visual identity
 */
export const brandingSettings = pgTable('branding_settings', {
  organizationId: text('organization_id')
    .primaryKey()
    .references(() => platformSettings.organizationId, { onDelete: 'cascade' }),

  // Logo (store both URL and R2 path for efficient deletion)
  logoUrl: text('logo_url'),
  logoR2Path: text('logo_r2_path'),

  // Colors
  primaryColorHex: varchar('primary_color_hex', { length: 7 }).notNull().default('#3B82F6'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
    .$onUpdate(() => new Date()),
});

/**
 * Contact settings - business information
 */
export const contactSettings = pgTable('contact_settings', {
  organizationId: text('organization_id')
    .primaryKey()
    .references(() => platformSettings.organizationId, { onDelete: 'cascade' }),

  platformName: varchar('platform_name', { length: 100 }).notNull().default('Codex Platform'),
  supportEmail: varchar('support_email', { length: 255 }).notNull(),
  contactUrl: text('contact_url'),
  timezone: varchar('timezone', { length: 100 }).notNull().default('UTC'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
    .$onUpdate(() => new Date()),
});

/**
 * Feature settings - toggles and capabilities
 */
export const featureSettings = pgTable('feature_settings', {
  organizationId: text('organization_id')
    .primaryKey()
    .references(() => platformSettings.organizationId, { onDelete: 'cascade' }),

  enableSignups: boolean('enable_signups').notNull().default(true),
  enablePurchases: boolean('enable_purchases').notNull().default(true),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
    .$onUpdate(() => new Date()),
});

// Relations
export const platformSettingsRelations = relations(platformSettings, ({ one }) => ({
  organization: one(organizations, {
    fields: [platformSettings.organizationId],
    references: [organizations.id],
  }),
  branding: one(brandingSettings),
  contact: one(contactSettings),
  features: one(featureSettings),
}));

// Type exports
export type PlatformSettings = typeof platformSettings.$inferSelect;
export type BrandingSettings = typeof brandingSettings.$inferSelect;
export type ContactSettings = typeof contactSettings.$inferSelect;
export type FeatureSettings = typeof featureSettings.$inferSelect;
```

#### 1.2 Update Schema Exports
**Modify**: `packages/database/src/schema/index.ts`
```typescript
export * from './settings';
```

#### 1.3 Generate & Run Migration
```bash
cd packages/database
pnpm db:gen:drizzle && pnpm db:migrate && pnpm db:studio
```

**Verification**:
- [ ] All 4 tables visible in Drizzle Studio
- [ ] Foreign key constraints verified (try deleting org → cascades)
- [ ] `pnpm typecheck` passes

---

### Phase 2: Validation Schemas (45 min)

Create domain-specific schemas that mirror the table structure.

#### 2.1 Create Settings Validation Schemas
**Create**: `packages/validation/src/schemas/settings.ts`

```typescript
import { z } from 'zod';

// ============================================================================
// Primitives
// ============================================================================

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be hex format (#RRGGBB)');

export const timezoneSchema = z
  .string()
  .min(1)
  .max(100)
  .default('UTC');

// Logo validation constants
export const ALLOWED_LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const MAX_LOGO_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

// ============================================================================
// Domain Schemas
// ============================================================================

export const updateBrandingSchema = z.object({
  primaryColorHex: hexColorSchema.optional(),
});

export const updateContactSchema = z.object({
  platformName: z.string().trim().min(1).max(100).optional(),
  supportEmail: z.string().email().optional(),
  contactUrl: z.string().url().nullable().optional(),
  timezone: timezoneSchema.optional(),
});

export const updateFeaturesSchema = z.object({
  enableSignups: z.boolean().optional(),
  enablePurchases: z.boolean().optional(),
});

// ============================================================================
// Defaults (returned when no settings exist)
// ============================================================================

export const DEFAULT_BRANDING = {
  logoUrl: null,
  primaryColorHex: '#3B82F6',
} as const;

export const DEFAULT_CONTACT = {
  platformName: 'Codex Platform',
  supportEmail: 'support@example.com',
  contactUrl: null,
  timezone: 'UTC',
} as const;

export const DEFAULT_FEATURES = {
  enableSignups: true,
  enablePurchases: true,
} as const;

// Type exports
export type UpdateBrandingInput = z.infer<typeof updateBrandingSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type UpdateFeaturesInput = z.infer<typeof updateFeaturesSchema>;
```

#### 2.2 Update Exports
**Modify**: `packages/validation/src/index.ts`
```typescript
export * from './schemas/settings';
```

**Verification**:
- [ ] `pnpm typecheck` passes
- [ ] Type inference works for all schemas

---

### Phase 3: Service Layer (2 hours)

Create specialized services with composition facade.

#### 3.1 Create New Package Structure
**Create directory**: `packages/platform-settings/`

```
packages/platform-settings/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── services/
│   │   ├── branding-settings-service.ts
│   │   ├── contact-settings-service.ts
│   │   ├── feature-settings-service.ts
│   │   └── platform-settings-service.ts  (facade)
│   ├── errors.ts
│   └── __tests__/
└── vitest.config.ts
```

#### 3.2 Create BrandingSettingsService
**Create**: `packages/platform-settings/src/services/branding-settings-service.ts`

- Extends `BaseService`
- Has R2Service dependency (for logo)
- Methods: `get()`, `update()`, `uploadLogo()`, `deleteLogo()`
- Uses upsert pattern with `.onConflictDoUpdate()`
- Ensures `platform_settings` hub row exists before child insert

#### 3.3 Create ContactSettingsService
**Create**: `packages/platform-settings/src/services/contact-settings-service.ts`

- Extends `BaseService`
- No R2 dependency
- Methods: `get()`, `update()`

#### 3.4 Create FeatureSettingsService
**Create**: `packages/platform-settings/src/services/feature-settings-service.ts`

- Extends `BaseService`
- No R2 dependency
- Methods: `get()`, `update()`

#### 3.5 Create PlatformSettingsService (Facade)
**Create**: `packages/platform-settings/src/services/platform-settings-service.ts`

```typescript
export class PlatformSettingsService {
  private branding: BrandingSettingsService;
  private contact: ContactSettingsService;
  private features: FeatureSettingsService;

  constructor(config: PlatformSettingsConfig) {
    this.branding = new BrandingSettingsService(config);
    this.contact = new ContactSettingsService(config);
    this.features = new FeatureSettingsService(config);
  }

  // Delegated methods for specialized access
  getBranding() { return this.branding.get(); }
  updateBranding(input) { return this.branding.update(input); }
  uploadLogo(file) { return this.branding.uploadLogo(file); }
  deleteLogo() { return this.branding.deleteLogo(); }

  getContact() { return this.contact.get(); }
  updateContact(input) { return this.contact.update(input); }

  getFeatures() { return this.features.get(); }
  updateFeatures(input) { return this.features.update(input); }

  // Unified access (parallel queries)
  async getAllSettings() {
    const [branding, contact, features] = await Promise.all([
      this.branding.get(),
      this.contact.get(),
      this.features.get(),
    ]);
    return { branding, contact, features };
  }
}
```

#### 3.6 Create Error Classes
**Create**: `packages/platform-settings/src/errors.ts`

```typescript
export class InvalidFileTypeError extends Error {
  code = 'INVALID_FILE_TYPE' as const;
}

export class FileTooLargeError extends Error {
  code = 'FILE_TOO_LARGE' as const;
}

export class R2UploadError extends Error {
  code = 'R2_UPLOAD_FAILED' as const;
}
```

**Verification**:
- [ ] `pnpm typecheck` passes in platform-settings package
- [ ] All services correctly extend BaseService
- [ ] Composition pattern works correctly

---

### Phase 4: API Endpoints (1 hour) ✅ COMPLETE

**Note**: Settings endpoints implemented in `organization-api` (not `admin-api`) because settings are organization-scoped.

#### 4.1 Add R2 Binding to Organization-API
**Modified**: `workers/organization-api/wrangler.jsonc`

Added R2 bucket binding to all environments (default, test, production):
```jsonc
"r2_buckets": [
  {
    "binding": "MEDIA_BUCKET",
    "bucket_name": "codex-media-production",
    "preview_bucket_name": "codex-media-test"
  }
]
```

#### 4.2 Create Settings Route Module
**Created**: `workers/organization-api/src/routes/settings.ts`

Endpoints under `/api/organizations/:id/settings`:
- GET    `/` - Get all settings (parallel queries)
- GET    `/branding` - Get branding settings
- PUT    `/branding` - Update branding settings
- POST   `/branding/logo` - Upload logo (multipart)
- DELETE `/branding/logo` - Delete logo
- GET    `/contact` - Get contact settings
- PUT    `/contact` - Update contact settings
- GET    `/features` - Get feature settings
- PUT    `/features` - Update feature settings

All routes use `POLICY_PRESETS.orgManagement()` for authorization.

#### 4.3 Mount Routes in Organization-API
**Modified**: `workers/organization-api/src/index.ts`

```typescript
import settingsRoutes from './routes/settings';

app.route('/api/organizations/:id/settings', settingsRoutes);
```

**Verification**:
- [x] `pnpm typecheck` passes
- [x] `pnpm build` succeeds
- [x] All 9 endpoints implemented
- [x] Auth middleware applied via `withPolicy(POLICY_PRESETS.orgManagement())`

---

### Phase 5: Tests (1.5 hours)

#### 5.1 Validation Tests
**Create**: `packages/validation/src/__tests__/settings.test.ts`

- Hex color validation
- Email format validation
- URL format validation

#### 5.2 Service Unit Tests
**Create**: `packages/platform-settings/src/__tests__/*.test.ts`

One test file per service:
- `branding-settings-service.test.ts`
- `contact-settings-service.test.ts`
- `feature-settings-service.test.ts`
- `platform-settings-service.test.ts` (facade)

Test cases per service:
- `get()` returns defaults when no row exists
- `get()` returns stored values
- `update()` creates via upsert
- `update()` partial updates work
- Logo upload/delete (branding only)

#### 5.3 API Integration Tests
**Create**: `workers/admin-api/src/__tests__/settings.test.ts`

- All 9 endpoints work
- Auth required on all routes
- Validation errors return 400
- File type/size errors return 400

**Verification**:
- [ ] `pnpm test` passes all suites
- [ ] Coverage >80% for services

---

## Critical Files

### New Package to Create
```
packages/platform-settings/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts
│   ├── errors.ts
│   ├── services/
│   │   ├── branding-settings-service.ts
│   │   ├── contact-settings-service.ts
│   │   ├── feature-settings-service.ts
│   │   └── platform-settings-service.ts
│   └── __tests__/
│       ├── branding-settings-service.test.ts
│       ├── contact-settings-service.test.ts
│       ├── feature-settings-service.test.ts
│       └── platform-settings-service.test.ts
```

### Other Files to Create
- `packages/database/src/schema/settings.ts` (4 tables)
- `packages/validation/src/schemas/settings.ts` (3 domain schemas)
- `workers/admin-api/src/routes/settings.ts` (9 endpoints)

### Files to Modify
- `packages/database/src/schema/index.ts` (add export)
- `packages/validation/src/index.ts` (add export)
- `workers/admin-api/wrangler.jsonc` (add R2 binding)
- `workers/admin-api/src/index.ts` (mount settings routes)

### Reference Files (patterns to follow)
- `packages/access/src/services/ContentAccessService.ts:344-393` (upsert pattern)
- `packages/service-errors/src/base-service.ts` (BaseService)
- `packages/cloudflare-clients/src/r2/services/r2-service.ts` (R2 operations)
- `workers/admin-api/src/index.ts:164-237` (existing admin routes)

---

## Verification Checklist

### Phase 1: Database ✅ COMPLETE
- [x] All 4 tables created: `platform_settings`, `branding_settings`, `contact_settings`, `feature_settings`
- [x] FK constraints verified (migration 0013_zippy_sabretooth.sql applied)
- [x] CASCADE DELETE configured in schema
- [x] `pnpm typecheck` passes in database package

### Phase 2: Validation ✅ COMPLETE
- [x] Domain schemas created: `updateBrandingSchema`, `updateContactSchema`, `updateFeaturesSchema`
- [x] Hex color regex validates correctly (added `hexColorSchema` to primitives.ts)
- [x] Timezone schema added to primitives.ts
- [x] Default constants defined (`DEFAULT_BRANDING`, `DEFAULT_CONTACT`, `DEFAULT_FEATURES`)
- [x] Response schemas added for type inference
- [x] Logo validation constants: `ALLOWED_LOGO_MIME_TYPES`, `MAX_LOGO_FILE_SIZE_BYTES`
- [x] Exports updated in `packages/validation/src/index.ts`
- [x] `pnpm typecheck` passes

### Phase 3: Service Layer ✅ COMPLETE
- [x] New package `@codex/platform-settings` created (package.json, tsconfig.json, vite/vitest configs)
- [x] Error classes created: `InvalidFileTypeError`, `FileTooLargeError`, `SettingsUpsertError`
- [x] 3 specialized services created: `BrandingSettingsService`, `ContactSettingsService`, `FeatureSettingsService`
- [x] `PlatformSettingsFacade` created (composition pattern, not inheritance)
- [x] All specialized services extend BaseService correctly
- [x] Upsert pattern ensures hub row exists
- [x] Composition pattern works in facade
- [x] Safe array access pattern applied (defensive checks instead of non-null assertions)
- [x] Domain-specific `SettingsUpsertError` for database operation failures
- [x] `pnpm typecheck` passes in platform-settings package
- [x] `pnpm lint` passes with no errors

### Phase 4: API ✅ COMPLETE
- [x] R2 binding added to organization-api wrangler.jsonc (all environments)
- [x] All 9 endpoints implemented in `workers/organization-api/src/routes/settings.ts`
- [x] Settings routes mounted at `/api/organizations/:orgId/settings`
- [x] All routes protected by `POLICY_PRESETS.orgManagement()` middleware
- [x] Error mapping correct for validation/file errors
- [x] Dependencies added: `@codex/cloudflare-clients`, `@codex/platform-settings`

### Phase 5: Tests ✅ COMPLETE
- [x] Validation schema tests created: `packages/validation/src/__tests__/settings.test.ts`
- [x] Service unit tests created (4 files):
  - `packages/platform-settings/src/__tests__/branding-settings-service.test.ts`
  - `packages/platform-settings/src/__tests__/contact-settings-service.test.ts`
  - `packages/platform-settings/src/__tests__/feature-settings-service.test.ts`
  - `packages/platform-settings/src/__tests__/platform-settings-service.test.ts`
- [x] API integration tests created: `workers/organization-api/src/__tests__/settings.test.ts`
- [x] All tests passing:
  - Validation: 287 tests (44 settings-specific)
  - Platform-settings: 50 tests
  - Organization-api: 30 tests (24 settings-specific)
- [x] Coverage verified: **94.69%** (exceeds 80% target)

### Phase 6: E2E Tests 🚧 READY TO RUN
- [x] Settings fixture created: `e2e/fixtures/settings.fixture.ts`
- [x] E2E test file created: `e2e/tests/07-platform-settings.spec.ts`
- [x] Fixture exported in `e2e/fixtures/index.ts`
- [ ] Run E2E tests with all workers running

**E2E Test Coverage**:
- Authentication & Authorization (unauthenticated, non-member, org owner)
- Default settings (branding, contact, features)
- Update branding (color validation)
- Update contact (name, email, timezone, URL)
- Update features (signups, purchases toggles)
- Organization scoping (isolation, cross-org prevention)

**To run E2E tests**:
```bash
# Start all workers
pnpm dev

# Run E2E tests
cd e2e && pnpm test -- tests/07-platform-settings.spec.ts
```

---

## Extensibility Guide

### Adding a New Settings Category (e.g., `email_settings`)

This architecture is designed for easy extension. Here's how to add a new settings domain:

#### Step 1: Database Table (5 min)
```typescript
// packages/database/src/schema/settings.ts
export const emailSettings = pgTable('email_settings', {
  organizationId: text('organization_id')
    .primaryKey()
    .references(() => platformSettings.organizationId, { onDelete: 'cascade' }),

  fromEmail: varchar('from_email', { length: 255 }).notNull(),
  fromName: varchar('from_name', { length: 100 }).notNull(),
  replyToEmail: varchar('reply_to_email', { length: 255 }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
    .$onUpdate(() => new Date()),
});
```

#### Step 2: Validation Schema (5 min)
```typescript
// packages/validation/src/schemas/settings.ts
export const updateEmailSchema = z.object({
  fromEmail: z.string().email().optional(),
  fromName: z.string().min(1).max(100).optional(),
  replyToEmail: z.string().email().nullable().optional(),
});

export const DEFAULT_EMAIL = {
  fromEmail: 'noreply@example.com',
  fromName: 'Codex Platform',
  replyToEmail: null,
} as const;
```

#### Step 3: Service (10 min)
```typescript
// packages/platform-settings/src/services/email-settings-service.ts
export class EmailSettingsService extends BaseService {
  async get(): Promise<EmailSettings> { /* same pattern as contact */ }
  async update(input: UpdateEmailInput): Promise<EmailSettings> { /* upsert */ }
}
```

#### Step 4: Update Facade (5 min)
```typescript
// packages/platform-settings/src/services/platform-settings-service.ts
export class PlatformSettingsService {
  private email: EmailSettingsService;

  // Add to constructor
  this.email = new EmailSettingsService(config);

  // Add delegation methods
  getEmail() { return this.email.get(); }
  updateEmail(input) { return this.email.update(input); }

  // Update getAllSettings
  async getAllSettings() {
    const [branding, contact, features, email] = await Promise.all([
      this.branding.get(),
      this.contact.get(),
      this.features.get(),
      this.email.get(),  // Add this
    ]);
    return { branding, contact, features, email };
  }
}
```

#### Step 5: API Endpoints (10 min)
```typescript
// workers/admin-api/src/routes/settings.ts
settings.get('/email', async (c) => { /* ... */ });
settings.put('/email', async (c) => { /* ... */ });
```

**Total time to add a new category: ~35 minutes**

No changes required to:
- Existing services (they don't know about email)
- Existing API endpoints
- Existing tests
- Authentication/authorization logic

---

## Design Rationale

### Why Not a Single Wide Table?
- 20+ columns today → 50+ columns in Phase 3 = unmaintainable
- Mixed concerns (branding vs features) violate Single Responsibility
- Schema changes to one domain affect all queries

### Why Not EAV (Entity-Attribute-Value)?
- Loses type safety (everything becomes string)
- Doesn't fit Drizzle's strongly-typed ORM patterns
- Complex queries for simple operations

### Why Parallel Queries Over JOINs?
- Neon PostgreSQL HTTP is stateless - parallel is faster
- Simple queries > complex JOIN query plans
- Easy to apply defaults per-table
- Better type safety with Drizzle

### Why Composition Over Inheritance?
- Each specialized service encapsulates its domain
- R2 logic isolated to BrandingService
- Mock individual services independently in tests
- Add new services without modifying existing code

---

**Last Updated**: 2025-12-19
**Implementation Status**: Phase 1-5 Complete, Phase 6 (E2E Tests) Ready to Run

---

## Continuation Prompt

Use this prompt to resume implementation with zero context:

```
Continue implementing the Platform Settings feature from the implementation plan.

## Current Status

### Phase 1: Database Schema ✅ COMPLETE
### Phase 2: Validation Schemas ✅ COMPLETE
### Phase 3: Service Layer ✅ COMPLETE
### Phase 4: API Endpoints ✅ COMPLETE

### Phase 5: Tests 🚧 RUN & VERIFY

**Test files created (all 6 files done):**
1. ✅ packages/validation/src/__tests__/settings.test.ts
2. ✅ packages/platform-settings/src/__tests__/branding-settings-service.test.ts
3. ✅ packages/platform-settings/src/__tests__/contact-settings-service.test.ts
4. ✅ packages/platform-settings/src/__tests__/feature-settings-service.test.ts
5. ✅ packages/platform-settings/src/__tests__/platform-settings-service.test.ts
6. ✅ workers/organization-api/src/__tests__/settings.test.ts

**What to do next:**

1. Run validation tests:
   ```bash
   pnpm --filter @codex/validation test -- --run src/__tests__/settings.test.ts
   ```

2. Run platform-settings service tests:
   ```bash
   pnpm --filter @codex/platform-settings test
   ```

3. Run organization-api tests:
   ```bash
   pnpm --filter organization-api test
   ```

4. Check coverage (target >80%):
   ```bash
   pnpm --filter @codex/platform-settings test:coverage
   ```

5. Fix any failing tests

6. Manual verification (optional):
   - Start worker: `cd workers/organization-api && pnpm dev`
   - Test GET /api/organizations/:orgId/settings returns defaults
   - Test PUT /api/organizations/:orgId/settings/branding updates color

## Quick Commands
- Run all: `pnpm test`
- Validation only: `pnpm --filter @codex/validation test`
- Services only: `pnpm --filter @codex/platform-settings test`
- API only: `pnpm --filter organization-api test`
- Typecheck: pnpm typecheck

## Implementation Plan Location
design/roadmap/implementation-plans/P1-SETTINGS-001-implementation-plan.md
```

**Sources**:
- [Database Schema Design Best Practices](https://www.bytebase.com/blog/top-database-schema-design-best-practices/)
- [Normalization vs Denormalization](https://blog.bytebytego.com/p/database-schema-design-simplified)
- [Universal Database Design Patterns](https://www.red-gate.com/blog/database-design-patterns)
