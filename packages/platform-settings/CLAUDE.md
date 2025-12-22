# @codex/platform-settings

Platform-wide settings management for Codex organizations. Handles branding (logo, colors), contact info, and feature toggles through a unified facade pattern.

**Status**: Active - Used by organization-api and admin-api workers
**Version**: 1.0.0

---

## Overview

Manages three independent settings categories for organizations:

- **Branding**: Logo (R2-stored), primary color hex
- **Contact**: Platform name, support email, contact URL, timezone
- **Features**: Feature toggles (signups, purchases enabled)

Uses **facade pattern** for unified access + specialized services for fine-grained control.

---

## Public API

### Main Export: `PlatformSettingsFacade`

Unified interface to all settings. Compose specialized services internally.

```typescript
import { PlatformSettingsFacade } from '@codex/platform-settings';

const facade = new PlatformSettingsFacade({
  db: dbHttp,
  environment: 'production',
  organizationId: 'org-123',
  r2: r2Service,
  r2PublicUrlBase: 'https://bucket.r2.cloudflarestorage.com',
});

// Specialized access (efficient - queries only category needed)
const branding = await facade.getBranding();
const contact = await facade.getContact();
const features = await facade.getFeatures();

// Unified access (parallel queries - better for dashboards)
const all = await facade.getAllSettings();
```

### Core Services

#### BrandingSettingsService

Manages logo + primary color per organization.

```typescript
// Get branding (returns defaults if not configured)
const branding = await facade.getBranding();
// { logoUrl: string | null, primaryColorHex: string }

// Update color only
await facade.updateBranding({ primaryColorHex: '#FF5733' });

// Upload new logo (validates type/size, stores in R2)
await facade.uploadLogo(fileBuffer, 'image/png', fileSize);

// Delete current logo
await facade.deleteLogo();
```

**Validation**:
- Allowed MIME types: `image/png`, `image/jpeg`, `image/webp`
- Max file size: 5MB
- Returned error on validation: `InvalidFileTypeError`, `FileTooLargeError` (both 400)

**R2 Storage**:
- Path: `logos/{organizationId}/logo.{ext}`
- Cache: 1 year (immutable)
- Old logos automatically deleted on new upload

#### ContactSettingsService

Manages organization contact information.

```typescript
// Get contact (returns defaults if not configured)
const contact = await facade.getContact();
// { platformName: string, supportEmail: string, contactUrl: string, timezone: string }

// Update specific fields (partial)
await facade.updateContact({
  supportEmail: 'support@example.com',
  timezone: 'America/New_York',
});
```

**Defaults**:
- platformName: Organization name
- supportEmail: support@example.com
- contactUrl: https://example.com/contact
- timezone: UTC

#### FeatureSettingsService

Manages feature toggles for the organization.

```typescript
// Get features (returns defaults if not configured)
const features = await facade.getFeatures();
// { enableSignups: boolean, enablePurchases: boolean }

// Update feature toggles
await facade.updateFeatures({
  enableSignups: false,  // Disable new signups
  enablePurchases: true, // Keep purchases enabled
});
```

**Defaults**:
- enableSignups: true
- enablePurchases: true

---

## Core Concepts

### Facade Pattern

Provides two access modes:

```
┌─ BrandingSettingsService
│
├─ PlatformSettingsFacade ─── ContactSettingsService
│
└─ FeatureSettingsService
```

**Specialized Access**:
```typescript
const service = new BrandingSettingsService(config);
const branding = await service.get();
```
Efficient: queries only what's needed. Used when only one category needed.

**Unified Access**:
```typescript
const all = await facade.getAllSettings();
// Queries all three in parallel
```
Better for dashboards that need everything at once.

### Upsert Pattern

All settings use PostgreSQL `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`.

Benefits:
- Atomic: create or update, never fails
- No explicit row management needed
- Returns new state immediately
- Handles race conditions

Example:
```typescript
// First call creates row
await service.update({ primaryColorHex: '#FF0000' });

// Second call updates existing row
await service.update({ primaryColorHex: '#00FF00' });
```

### Graceful Defaults

All `get()` methods return defaults if no row exists.

```typescript
const contact = await facade.getContact();
// If row doesn't exist, returns DEFAULT_CONTACT from @codex/validation
// Client never sees null/undefined
```

---

## Data Models

### Settings Tables

All settings scoped by `organizationId` with `createdAt`, `updatedAt`.

**platform_settings** (hub table)
- organizationId (PK)
- createdAt, updatedAt

**branding_settings**
- organizationId (PK, FK → organizations)
- logoUrl: string | null
- logoR2Path: string | null (internal R2 path)
- primaryColorHex: string (default: #000000)

**contact_settings**
- organizationId (PK, FK → organizations)
- platformName: string
- supportEmail: string
- contactUrl: string
- timezone: string

**feature_settings**
- organizationId (PK, FK → organizations)
- enableSignups: boolean
- enablePurchases: boolean

### Response Types (from @codex/validation)

```typescript
type BrandingSettingsResponse = {
  logoUrl: string | null;
  primaryColorHex: string;
};

type ContactSettingsResponse = {
  platformName: string;
  supportEmail: string;
  contactUrl: string;
  timezone: string;
};

type FeatureSettingsResponse = {
  enableSignups: boolean;
  enablePurchases: boolean;
};

type AllSettingsResponse = {
  branding: BrandingSettingsResponse;
  contact: ContactSettingsResponse;
  features: FeatureSettingsResponse;
};
```

---

## Error Handling

All errors map to standard HTTP status codes via `mapErrorToResponse()`:

### Service-Specific Errors

| Error | Status | When |
|-------|--------|------|
| `InvalidFileTypeError` | 400 | Logo MIME type not in allowed list |
| `FileTooLargeError` | 400 | Logo file > 5MB |
| `SettingsUpsertError` | 500 | Upsert returned no rows (db issue) |

### Base Errors (inherited)

| Error | Status | When |
|-------|--------|------|
| `ValidationError` | 400 | Input validation fails |
| `InternalServiceError` | 500 | Unexpected service error |

### Throwing Errors

```typescript
throw new InvalidFileTypeError(mimeType, ALLOWED_LOGO_MIME_TYPES);
throw new FileTooLargeError(fileSize, MAX_LOGO_FILE_SIZE_BYTES);
```

---

## Integration

### With Workers

**workers/organization-api** - Organization settings management routes
```typescript
const facade = new PlatformSettingsFacade({
  db: c.env.DB,
  environment: c.env.ENVIRONMENT,
  organizationId: ctx.params.orgId,
  r2: r2Service,
  r2PublicUrlBase: c.env.R2_PUBLIC_URL_BASE,
});

const all = await facade.getAllSettings();
```

**workers/admin-api** - Platform admin dashboard (read-only)
```typescript
// Admin dashboard fetches all organization settings in parallel
```

### With Database (@codex/database)

- Uses `dbHttp` for production (stateless)
- Uses `dbWs` for transactions (tests, local dev)
- Inherits scoping from `@codex/database` (createdAt, updatedAt)

### With Validation (@codex/validation)

- **Input schemas**: `updateBrandingSchema`, `updateContactSchema`, `updateFeaturesSchema`
- **Defaults**: `DEFAULT_BRANDING`, `DEFAULT_CONTACT`, `DEFAULT_FEATURES`
- **Constants**: `ALLOWED_LOGO_MIME_TYPES`, `MAX_LOGO_FILE_SIZE_BYTES`

### With R2 (@codex/cloudflare-clients)

Logo uploads use R2Service:
```typescript
await r2.put(
  `logos/${organizationId}/logo.png`,
  file,
  undefined,
  { contentType: 'image/png', cacheControl: 'public, max-age=31536000' }
);
```

Old logos auto-deleted on new upload (non-blocking, logs warn on failure).

---

## Usage Examples

### Complete Settings Page Update

```typescript
const facade = new PlatformSettingsFacade(config);

// Update all three settings
const [branding, contact, features] = await Promise.all([
  facade.updateBranding({ primaryColorHex: '#FF5733' }),
  facade.updateContact({
    platformName: 'My Platform',
    supportEmail: 'help@example.com',
  }),
  facade.updateFeatures({ enablePurchases: false }),
]);
```

### Organization Setup Wizard

```typescript
// New org created - initialize with defaults
const contact = await facade.updateContact({
  platformName: organizationName,
  supportEmail: `support@${organizationSlug}.com`,
});

const features = await facade.updateFeatures({
  enableSignups: true,
  enablePurchases: true,
});
```

### Logo Management

```typescript
// Upload new logo
const updated = await facade.uploadLogo(buffer, 'image/png', buffer.byteLength);
console.log(`New logo: ${updated.logoUrl}`);

// Delete logo
const cleared = await facade.deleteLogo();
console.log(`Logo removed`);
```

### Conditional Feature Access

```typescript
const features = await facade.getFeatures();

if (features.enablePurchases) {
  // Show purchase buttons
} else {
  // Hide purchase UI
}
```

---

## Testing

### Unit Tests

Located in `packages/platform-settings/src/__tests__/`

Test structure:
- Service isolation (mock dependencies)
- Happy path + error cases
- Database upsert correctness
- R2 integration (mocked)

Example:
```typescript
describe('BrandingSettingsService', () => {
  it('should upload valid logo', async () => {
    const service = new BrandingSettingsService(testConfig);
    const result = await service.uploadLogo(buffer, 'image/png', 1024);
    expect(result.logoUrl).toBeDefined();
  });

  it('should reject invalid MIME type', async () => {
    const service = new BrandingSettingsService(testConfig);
    await expect(
      service.uploadLogo(buffer, 'application/json', 1024)
    ).rejects.toThrow(InvalidFileTypeError);
  });
});
```

### Integration Tests

E2E tests in `e2e/tests/07-platform-settings.test.ts`

Tests complete flows:
- Update settings via API
- Upload logo to R2
- Verify settings persist
- Test feature toggle behavior

---

## Performance Notes

### Query Patterns

**Specialized access** (get one category):
```typescript
await facade.getBranding();
// Single row query: SELECT FROM branding_settings WHERE organizationId = ?
```

**Unified access** (get all categories):
```typescript
await facade.getAllSettings();
// Three parallel queries (faster than sequential)
```

### Caching Opportunities

Logo URLs are immutable (R2 path includes org ID + timestamp logic).
Frontend can cache indefinitely (1 year cache control set on R2).

### R2 Operations

- Logo uploads: Non-blocking (fire-and-forget style, but awaited)
- Old logo deletion: Non-blocking, failures logged but don't block response
- Public URL generation: Happens at service level (no additional calls needed)

---

## Security

### File Upload Validation

Logo uploads validate:
- **MIME type**: Whitelist only PNG, JPEG, WebP (no SVG due to XSS risk)
- **File size**: Max 5MB (prevents storage abuse)
- **Storage path**: Always `logos/{organizationId}/...` (org-scoped, no traversal possible)

### Multi-Tenancy

All queries filtered by `organizationId` - prevents cross-org data leakage.

### R2 Configuration

- Logos stored in private R2 bucket (no public read)
- Public URLs generated server-side (signed URLs not needed - immutable path)
- Cache control set to 1 year (safe since path includes org ID)

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│ PlatformSettingsFacade                              │
│ (Unified interface for all settings)                │
└────────┬────────────────────────────────────────────┘
         │
    ┌────┴────┬──────────────┬──────────────┐
    │          │              │              │
    v          v              v              v
 getBrand   getContact   getFeatures   getAllSettings
 updateBrand updateContact updateFeatures  (parallel)
    │          │              │
    v          v              v
 ┌────────────────────────────────────────┐
 │ BrandingSettingsService                │
 │ - get/update color                     │
 │ - upload/delete logo to R2             │
 └────────────────────────────────────────┘

 ┌────────────────────────────────────────┐
 │ ContactSettingsService                 │
 │ - get/update org contact info          │
 └────────────────────────────────────────┘

 ┌────────────────────────────────────────┐
 │ FeatureSettingsService                 │
 │ - get/update feature toggles           │
 └────────────────────────────────────────┘
    │          │              │
    └────┬─────┴──────┬───────┘
         v            v
    ┌─────────────────────┐
    │ @codex/database     │
    │ (Drizzle ORM)       │
    └─────────────────────┘
         │
         v
    ┌─────────────────────┐
    │ PostgreSQL/Neon     │
    └─────────────────────┘
```

---

## Key Files

| File | Purpose |
|------|---------|
| `src/services/platform-settings-service.ts` | Main facade |
| `src/services/branding-settings-service.ts` | Logo + color management |
| `src/services/contact-settings-service.ts` | Contact info management |
| `src/services/feature-settings-service.ts` | Feature toggle management |
| `src/errors.ts` | Domain-specific error classes |
| `src/index.ts` | Package exports |

---

## Dependencies

| Package | Used For |
|---------|----------|
| `@codex/database` | Query/insert/update operations |
| `@codex/service-errors` | BaseService, error handling |
| `@codex/validation` | Schemas, defaults, constants |
| `@codex/cloudflare-clients` | R2 logo storage |
| `@codex/observability` | Logging |
| `drizzle-orm` | ORM query builder |

---

## Related Packages

- **@codex/database** - Settings table schema definitions
- **@codex/validation** - Settings schemas, defaults, constants
- **workers/organization-api** - Settings endpoints
- **workers/admin-api** - Admin dashboard

---

**Last Updated**: 2025-01-22
**Version**: 1.0.0
