# P1-SETTINGS-001: Platform Settings

**Priority**: P2
**Status**: 🚧 E2E Tests Pending
**Estimated Effort**: 2-3 days

---

## Table of Contents

- [Overview](#overview)
- [System Context](#system-context)
- [Database Schema](#database-schema)
- [Service Architecture](#service-architecture)
- [Implementation Patterns](#implementation-patterns)
- [API Integration](#api-integration)
- [Available Patterns & Utilities](#available-patterns--utilities)
- [Dependencies](#dependencies)
- [Implementation Checklist](#implementation-checklist)
- [Testing Strategy](#testing-strategy)
- [Notes](#notes)

---

## Overview

Platform Settings enables platform owners to customize branding, configure feature toggles, and manage contact information without code deployments. This is a critical self-service capability that separates platform appearance from the codebase.

Platform owners can update the platform name, upload custom logos stored in R2, configure brand colors (hex codes), set support contact information, and toggle features like signups and purchases. All settings are scoped by `organizationId` for multi-tenancy (even though Phase 1 has a single organization).

The service uses an upsert pattern—there's exactly one settings row per organization, automatically created with defaults if missing. Logo uploads go directly to R2 storage with file type and size validation. Settings are exposed via a public GET endpoint (for frontend branding) and platform-owner-protected PUT/POST/DELETE endpoints.

This fills a critical gap: enabling non-technical business owners to rebrand their platform, update support emails, and toggle features without developer intervention or deployments.

---

## System Context

### Upstream Dependencies

- **@codex/database**: Drizzle ORM client and schema for `platform_settings` table.

- **@codex/cloudflare-clients**: R2Service for logo file uploads (already available).

- **@codex/validation**: Zod schemas for input validation (hex colors, emails, URLs).

- **P1-ADMIN-001** (Optional): Platform owner middleware (`requirePlatformOwner()`) for securing write endpoints.

### Downstream Consumers

- **Frontend Web App** (Future): Fetches settings via `GET /api/settings` to apply branding (platform name, logo, colors) in UI.

- **Auth Worker**: Exposes settings API endpoints for reading and updating.

- **Admin Dashboard** (Future): UI for platform owners to manage settings with forms and file uploads.

### External Services

- **Neon PostgreSQL**: Stores platform settings in `platform_settings` table (one row per organization).

- **Cloudflare R2**: Stores uploaded logo files under `logos/{organizationId}.{extension}`.

### Integration Flow

```
Platform Owner Admin UI
    ↓ POST /api/settings/logo (multipart/form-data)
Auth Worker → PlatformSettingsService
    ↓ Validate file type/size (PNG/JPEG/WebP, <5MB)
    ↓ Upload to R2: logos/org-123.png
R2 Storage
    ↓ Generate public URL: https://r2.example.com/logos/org-123.png
    ↓ Update platform_settings.logo_url
Neon PostgreSQL
    ↓ Return { logoUrl: "..." }
Platform Owner Admin UI → Displays new logo
```

---

## Database Schema

### Tables

#### `platform_settings`

**Purpose**: Store platform-wide branding and configuration (one row per organization)

```typescript
export const platformSettings = pgTable('platform_settings', {
  organizationId: text('organization_id').primaryKey(),

  // Branding
  platformName: text('platform_name').notNull(),
  logoUrl: text('logo_url'), // NULL if no logo uploaded
  primaryColor: text('primary_color').notNull().default('#3498db'),
  secondaryColor: text('secondary_color').notNull().default('#2c3e50'),

  // Contact information
  supportEmail: text('support_email').notNull(),
  contactUrl: text('contact_url'), // NULL if not set

  // Feature toggles
  enableSignups: boolean('enable_signups').notNull().default(true),
  enablePurchases: boolean('enable_purchases').notNull().default(true),

  // Metadata
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
    .$onUpdate(() => new Date()),
});
```

**Columns**:
- `organizationId`: Primary key (one settings row per organization)
- `platformName`: Display name for platform (e.g., "Codex")
- `logoUrl`: R2 public URL (NULL if no logo)
- `primaryColor`: Hex color code for brand primary (e.g., `#3498db`)
- `secondaryColor`: Hex color code for brand secondary
- `supportEmail`: Contact email for customer support
- `contactUrl`: Optional URL to contact page
- `enableSignups`: Toggle to enable/disable user registration
- `enablePurchases`: Toggle to enable/disable content purchases
- `updatedAt`: Auto-updated timestamp on every change

**Constraints**:
- Primary Key: `organization_id` (ensures one row per organization)
- NOT NULL: `platform_name`, `support_email`, `primary_color`, `secondary_color`, `enable_signups`, `enable_purchases`

**Indexes**:
- Primary key index on `organization_id` (automatic)

**Upsert Pattern**:
```sql
INSERT INTO platform_settings (organization_id, platform_name, ...)
VALUES ('org-123', 'My Platform', ...)
ON CONFLICT (organization_id) DO UPDATE
SET platform_name = EXCLUDED.platform_name, ...;
```

---

### Relationships

```
organizations 1---1 platform_settings
  └─ Foreign key: platform_settings.organization_id → organizations.id
  └─ Business rule: Each organization has exactly one settings row (upsert pattern)
```

---

### Migration Considerations

**Manual Steps**:
- No additional indexes required (primary key index sufficient)
- Consider adding default settings for existing organizations after migration

**Migration SQL**:
```sql
CREATE TABLE platform_settings (
  organization_id TEXT PRIMARY KEY,
  platform_name TEXT NOT NULL,
  logo_url TEXT,
  primary_color TEXT NOT NULL DEFAULT '#3498db',
  secondary_color TEXT NOT NULL DEFAULT '#2c3e50',
  support_email TEXT NOT NULL,
  contact_url TEXT,
  enable_signups BOOLEAN NOT NULL DEFAULT true,
  enable_purchases BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

---

## Service Architecture

### Service Responsibilities

**PlatformSettingsService** (Composition, not BaseService):
- **Primary Responsibility**: CRUD operations for platform settings with logo upload/delete to R2
- **Key Operations**:
  - `getSettings()`: Fetch settings (returns defaults if not found)
  - `updateSettings(input)`: Upsert settings (partial updates allowed)
  - `uploadLogo(file)`: Validate file, upload to R2, update `logoUrl`
  - `deleteLogo()`: Delete file from R2, set `logoUrl` to NULL

---

### Key Business Rules

**Upsert Pattern** (One Row Per Organization):
- `platform_settings` has exactly ONE row per organization
- Initial settings creation uses sensible defaults
- Updates use `ON CONFLICT DO UPDATE` (upsert)
- Missing settings return defaults (no database error)

**Logo Validation Rules**:
- Allowed types: PNG, JPEG, WebP (MIME types: `image/png`, `image/jpeg`, `image/webp`)
- Maximum size: 5MB
- Stored in R2: `logos/{organizationId}.{extension}`
- Public URL returned (or signed URL if bucket private)

**Feature Toggle Behavior**:
- `enableSignups = false`: Registration endpoints return 403 Forbidden
- `enablePurchases = false`: Checkout endpoints return 403 Forbidden
- Toggles checked in middleware before route handlers

**Default Settings** (when not found):
```typescript
{
  platformName: 'My Platform',
  logoUrl: null,
  primaryColor: '#3498db',
  secondaryColor: '#2c3e50',
  supportEmail: 'support@example.com',
  contactUrl: null,
  enableSignups: true,
  enablePurchases: true,
}
```

---

### Error Handling Approach

**Error Codes** (throw standard JavaScript `Error` with codes):
- `INVALID_FILE_TYPE`: File type not in allowed list
- `FILE_TOO_LARGE`: File size exceeds 5MB
- `R2_UPLOAD_FAILED`: R2 upload operation failed
- `SETTINGS_NOT_FOUND`: (Handled gracefully by returning defaults)

**Error Mapping** (in API layer):
```typescript
try {
  await service.uploadLogo(file);
} catch (err) {
  const message = (err as Error).message;
  if (message === 'INVALID_FILE_TYPE') {
    return c.json({ error: { code: 'INVALID_FILE_TYPE', message: 'Invalid file type (use PNG, JPEG, or WebP)' } }, 400);
  }
  // ... other errors
}
```

---

### Transaction Boundaries

**No Transactions Required**:
- All operations are single-query operations (upsert or update)
- `uploadLogo()`: R2 upload + database update (no transaction needed - R2 upload fails first)
- `deleteLogo()`: R2 delete + database update (idempotent - R2 delete is safe if file missing)

---

## Implementation Patterns

### Pattern 1: Upsert Pattern (One Row Per Organization)

Ensure exactly one settings row per organization using database upsert.

**Database Upsert**:
```typescript
await db.insert(platformSettings).values({
  organizationId,
  platformName: input.platformName ?? 'My Platform',
  supportEmail: input.supportEmail ?? 'support@example.com',
  primaryColor: input.primaryColor ?? '#3498db',
  secondaryColor: input.secondaryColor ?? '#2c3e50',
  contactUrl: input.contactUrl,
  enableSignups: input.enableSignups ?? true,
  enablePurchases: input.enablePurchases ?? true,
  updatedAt: new Date(),
}).onConflictDoUpdate({
  target: platformSettings.organizationId,
  set: {
    ...input,
    updatedAt: new Date(),
  },
});
```

**Graceful Defaults** (when settings not found):
```typescript
async getSettings(): Promise<PlatformSettings> {
  const settings = await this.db.query.platformSettings.findFirst({
    where: eq(platformSettings.organizationId, this.organizationId),
  });

  // Return defaults if not found (no error thrown)
  if (!settings) {
    this.obs.warn('Platform settings not found, returning defaults', {
      organizationId: this.organizationId,
    });
    return {
      platformName: 'My Platform',
      logoUrl: null,
      primaryColor: '#3498db',
      secondaryColor: '#2c3e50',
      supportEmail: 'support@example.com',
      contactUrl: null,
      enableSignups: true,
      enablePurchases: true,
    };
  }

  return settings;
}
```

**Key Benefits**:
- **Atomic**: Upsert prevents race conditions (no check-then-insert pattern)
- **Idempotent**: Multiple updates with same data are safe
- **Graceful**: Missing settings return defaults (frontend doesn't break)

---

### Pattern 2: File Validation Before Upload

Validate file type and size BEFORE uploading to R2.

**File Validation** (fail fast):
```typescript
async uploadLogo(file: File): Promise<{ logoUrl: string }> {
  // Step 1: Validate file type (fail fast before R2 upload)
  const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    this.obs.warn('Invalid file type', {
      fileType: file.type,
      allowedTypes,
    });
    throw new Error('INVALID_FILE_TYPE');
  }

  // Step 2: Validate file size (fail fast before R2 upload)
  const maxSizeBytes = 5 * 1024 * 1024; // 5MB
  if (file.size > maxSizeBytes) {
    this.obs.warn('File too large', {
      fileSize: file.size,
      maxSizeBytes,
    });
    throw new Error('FILE_TOO_LARGE');
  }

  // Step 3: Generate R2 path
  const extension = file.type.split('/')[1]; // 'png', 'jpeg', 'webp'
  const r2Path = `logos/${this.organizationId}.${extension}`;

  // Step 4: Upload to R2
  const buffer = await file.arrayBuffer();
  await this.r2.uploadFile(r2Path, new Uint8Array(buffer), {
    contentType: file.type,
  });

  // Step 5: Generate public URL
  const logoUrl = await this.r2.getPublicUrl(r2Path);

  // Step 6: Update settings with logo URL (upsert)
  await this.db.insert(platformSettings).values({
    organizationId: this.organizationId,
    logoUrl,
    platformName: 'My Platform', // Default
    supportEmail: 'support@example.com', // Default
  }).onConflictDoUpdate({
    target: platformSettings.organizationId,
    set: {
      logoUrl,
      updatedAt: new Date(),
    },
  });

  return { logoUrl };
}
```

**Key Benefits**:
- **Fail Fast**: Reject invalid files BEFORE expensive R2 upload
- **User-Friendly Errors**: Specific error messages for file type vs size
- **No Wasted Resources**: Don't upload files that will be rejected

---

### Pattern 3: Composition (Not Inheritance)

PlatformSettingsService uses composition, not BaseService inheritance.

**❌ BAD: Inherit from BaseService** (unnecessary dependency):
```typescript
import { BaseService } from '@codex/service-errors';

export class PlatformSettingsService extends BaseService {
  constructor(config: ServiceConfig & { r2: R2Service }) {
    super(config); // Requires userId - not needed for platform settings!
  }

  async uploadLogo(file: File) {
    // BaseService provides this.db, this.userId (userId unused)
    // Coupling to userId even though settings aren't user-scoped
  }
}
```

**✅ GOOD: Composition Pattern** (minimal dependencies):
```typescript
export interface PlatformSettingsServiceConfig {
  db: DrizzleClient;
  r2: R2Service;
  obs: ObservabilityClient;
  organizationId: string;
}

export class PlatformSettingsService {
  constructor(private config: PlatformSettingsServiceConfig) {}

  async uploadLogo(file: File): Promise<{ logoUrl: string }> {
    const { r2, db, obs, organizationId } = this.config;
    // Only depend on what you need (no userId, no unnecessary coupling)
    // ...
  }
}
```

**Factory Function** (Dependency Injection):
```typescript
export function getPlatformSettingsService(env: {
  DATABASE_URL: string;
  R2_BUCKET: R2Bucket;
  ENVIRONMENT: string;
  ORGANIZATION_ID: string;
}): PlatformSettingsService {
  const db = getDbClient(env.DATABASE_URL);
  const r2 = new R2Service(env.R2_BUCKET);
  const obs = new ObservabilityClient('platform-settings-service', env.ENVIRONMENT);

  return new PlatformSettingsService({
    db,
    r2,
    obs,
    organizationId: env.ORGANIZATION_ID,
  });
}
```

**Key Benefits**:
- **Minimal Dependencies**: Only depends on what it needs (no userId)
- **Clearer Intent**: Settings are organization-scoped, not user-scoped
- **Easier Testing**: Mock only what service actually uses

---

### Pattern 4: R2 Path Extraction (Logo Deletion)

Extract R2 path from public URL for deletion.

**Problem**: Logo URL is stored as public URL (`https://r2.example.com/logos/org-123.png`), but R2 delete needs path (`logos/org-123.png`)

**Solution**: Parse URL to extract R2 path

```typescript
async deleteLogo(): Promise<void> {
  const { r2, db, obs, organizationId } = this.config;

  // Step 1: Get current settings to find logo URL
  const settings = await db.query.platformSettings.findFirst({
    where: eq(platformSettings.organizationId, organizationId),
  });

  if (settings?.logoUrl) {
    // Step 2: Extract R2 path from URL
    // URL format: "https://r2.example.com/logos/org-123.png"
    // Extract: "logos/org-123.png"
    const urlParts = settings.logoUrl.split('/');
    const r2Path = urlParts.slice(-2).join('/'); // Last 2 parts: "logos/org-123.png"

    obs.info('Deleting logo from R2', { r2Path });

    // Step 3: Delete from R2 (idempotent - safe if file missing)
    await r2.deleteFile(r2Path);
  }

  // Step 4: Update settings to remove logo URL
  await db.update(platformSettings)
    .set({
      logoUrl: null,
      updatedAt: new Date(),
    })
    .where(eq(platformSettings.organizationId, organizationId));

  obs.info('Logo deleted', { organizationId });
}
```

**Alternative** (store R2 path separately):
```typescript
// In database schema (alternative approach):
logoUrl: text('logo_url'),        // Public URL for frontend
logoR2Path: text('logo_r2_path'), // Internal R2 path for deletion
```

**Key Benefits**:
- **Path Extraction**: Works with existing URL-only storage
- **Idempotent**: R2 delete is safe if file doesn't exist
- **No Schema Change**: Uses existing URL field

---

## Pseudocode for Key Operations

### Pseudocode: getSettings()

```
FUNCTION getSettings(organizationId):
  // Step 1: Query database for settings
  settings = DATABASE_QUERY:
    SELECT * FROM platform_settings
    WHERE organization_id = organizationId

  // Step 2: Return defaults if not found (no error)
  IF settings is NULL:
    LOG_WARN('Platform settings not found, returning defaults', {
      organizationId
    })

    RETURN {
      platformName: 'My Platform',
      logoUrl: NULL,
      primaryColor: '#3498db',
      secondaryColor: '#2c3e50',
      supportEmail: 'support@example.com',
      contactUrl: NULL,
      enableSignups: TRUE,
      enablePurchases: TRUE
    }

  // Step 3: Return actual settings
  RETURN {
    platformName: settings.platform_name,
    logoUrl: settings.logo_url,
    primaryColor: settings.primary_color,
    secondaryColor: settings.secondary_color,
    supportEmail: settings.support_email,
    contactUrl: settings.contact_url,
    enableSignups: settings.enable_signups,
    enablePurchases: settings.enable_purchases
  }
END FUNCTION
```

---

### Pseudocode: uploadLogo()

```
FUNCTION uploadLogo(file, organizationId):
  // Step 1: Validate file type
  allowedTypes = ['image/png', 'image/jpeg', 'image/webp']

  IF file.type NOT IN allowedTypes:
    LOG_WARN('Invalid file type', {
      fileType: file.type,
      allowedTypes: allowedTypes
    })
    THROW Error('INVALID_FILE_TYPE')

  // Step 2: Validate file size
  maxSizeBytes = 5 * 1024 * 1024  // 5MB

  IF file.size > maxSizeBytes:
    LOG_WARN('File too large', {
      fileSize: file.size,
      maxSizeBytes: maxSizeBytes
    })
    THROW Error('FILE_TOO_LARGE')

  // Step 3: Generate R2 path
  extension = file.type.split('/')[1]  // Extract 'png', 'jpeg', 'webp'
  r2Path = 'logos/' + organizationId + '.' + extension

  LOG_INFO('Uploading logo to R2', {
    organizationId: organizationId,
    r2Path: r2Path,
    fileSize: file.size
  })

  // Step 4: Upload to R2
  buffer = file.arrayBuffer()
  R2_UPLOAD(r2Path, buffer, {
    contentType: file.type
  })

  // Step 5: Generate public URL
  logoUrl = R2_GET_PUBLIC_URL(r2Path)

  // Step 6: Update settings with logo URL (upsert)
  DATABASE_UPSERT:
    INSERT INTO platform_settings (
      organization_id,
      logo_url,
      platform_name,
      support_email,
      updated_at
    )
    VALUES (
      organizationId,
      logoUrl,
      'My Platform',  -- Default if first insert
      'support@example.com',  -- Default if first insert
      NOW()
    )
    ON CONFLICT (organization_id) DO UPDATE
    SET logo_url = logoUrl, updated_at = NOW()

  LOG_INFO('Logo uploaded successfully', {
    organizationId: organizationId,
    logoUrl: logoUrl
  })

  RETURN { logoUrl: logoUrl }
END FUNCTION
```

---

### Pseudocode: deleteLogo()

```
FUNCTION deleteLogo(organizationId):
  // Step 1: Get current settings to find logo URL
  settings = DATABASE_QUERY:
    SELECT * FROM platform_settings
    WHERE organization_id = organizationId

  // Step 2: Extract R2 path from logo URL (if exists)
  IF settings AND settings.logo_url IS NOT NULL:
    // URL format: "https://r2.example.com/logos/org-123.png"
    urlParts = settings.logo_url.split('/')
    r2Path = urlParts.slice(-2).join('/')  // "logos/org-123.png"

    LOG_INFO('Deleting logo from R2', {
      organizationId: organizationId,
      r2Path: r2Path
    })

    // Step 3: Delete from R2 (idempotent - safe if file missing)
    R2_DELETE(r2Path)

  // Step 4: Update settings to remove logo URL
  DATABASE_UPDATE:
    UPDATE platform_settings
    SET logo_url = NULL, updated_at = NOW()
    WHERE organization_id = organizationId

  LOG_INFO('Logo deleted', {
    organizationId: organizationId
  })

  RETURN success
END FUNCTION
```

---

## API Integration

### Endpoints

| Method | Path | Purpose | Security Policy |
|--------|------|---------|-----------------|
| GET | `/api/settings` | Get platform settings | Public (no auth) |
| PUT | `/api/settings` | Update platform settings | `requirePlatformOwner()` |
| POST | `/api/settings/logo` | Upload platform logo | `requirePlatformOwner()` |
| DELETE | `/api/settings/logo` | Delete platform logo | `requirePlatformOwner()` |

---

### Standard Pattern

**GET /api/settings** (Public - for frontend branding):
```typescript
app.get('/api/settings', async (c) => {
  const service = getPlatformSettingsService(c.env);
  const settings = await service.getSettings();
  return c.json(settings);
});
```

**PUT /api/settings** (Platform owner only):
```typescript
app.put('/api/settings', requireAuth(), requirePlatformOwner(), async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const input = updatePlatformSettingsSchema.parse(body);

  const service = getPlatformSettingsService({
    ...c.env,
    ORGANIZATION_ID: user.organizationId,
  });

  await service.updateSettings(input);
  return c.json({ success: true });
});
```

**POST /api/settings/logo** (Platform owner only - multipart form):
```typescript
app.post('/api/settings/logo', requireAuth(), requirePlatformOwner(), async (c) => {
  const user = c.get('user');
  const formData = await c.req.formData();
  const file = formData.get('logo') as File;

  if (!file) {
    return c.json({ error: { code: 'MISSING_FILE', message: 'Logo file required' } }, 400);
  }

  const service = getPlatformSettingsService({
    ...c.env,
    ORGANIZATION_ID: user.organizationId,
  });

  try {
    const result = await service.uploadLogo(file);
    return c.json(result);
  } catch (err) {
    const message = (err as Error).message;
    if (message === 'INVALID_FILE_TYPE') {
      return c.json({ error: { code: 'INVALID_FILE_TYPE', message: 'Invalid file type (use PNG, JPEG, or WebP)' } }, 400);
    }
    if (message === 'FILE_TOO_LARGE') {
      return c.json({ error: { code: 'FILE_TOO_LARGE', message: 'File too large (max 5MB)' } }, 400);
    }
    throw err;
  }
});
```

---

### Security Policies

- **Public Access**: `GET /api/settings` (for frontend branding - no auth)
- **Platform Owner Only**: `PUT`, `POST`, `DELETE` (requires `requirePlatformOwner()`)

**Middleware Chain**:
```typescript
app.use('/api/settings/*', requireAuth());           // Step 1: JWT validation
app.use('/api/settings/*', requirePlatformOwner());  // Step 2: Role check
```

---

### Response Format

```typescript
// GET /api/settings (success)
{
  "platformName": "Codex",
  "logoUrl": "https://r2.example.com/logos/org-123.png",
  "primaryColor": "#3498db",
  "secondaryColor": "#2c3e50",
  "supportEmail": "support@codex.com",
  "contactUrl": "https://codex.com/contact",
  "enableSignups": true,
  "enablePurchases": true
}

// PUT /api/settings (success)
{
  "success": true
}

// POST /api/settings/logo (success)
{
  "logoUrl": "https://r2.example.com/logos/org-123.png"
}

// Error (400 Bad Request - invalid file type)
{
  "error": {
    "code": "INVALID_FILE_TYPE",
    "message": "Invalid file type (use PNG, JPEG, or WebP)"
  }
}
```

---

## Available Patterns & Utilities

### Foundation Packages

#### `@codex/database`
- **Upsert Pattern**:
  - `db.insert(table).values(data).onConflictDoUpdate()`: Atomic upsert
  - `eq(table.column, value)`: WHERE condition helper

**When to use**: All database operations for settings

---

#### `@codex/cloudflare-clients`
- **R2 Operations**:
  - `r2.uploadFile(path, buffer, { contentType })`: Upload file to R2
  - `r2.getPublicUrl(path)`: Generate public URL
  - `r2.deleteFile(path)`: Delete file (idempotent)

**When to use**: Logo upload/delete operations

---

#### `@codex/validation`
- **Validation Schemas**:
  - `z.string().regex(/^#[0-9A-Fa-f]{6}$/)`: Hex color validation
  - `z.string().email()`: Email validation
  - `z.string().url()`: URL validation

**When to use**: Settings input validation

---

#### `@codex/observability`
- **Logging**:
  - `obs.info(message, metadata)`: Info logs
  - `obs.warn(message, metadata)`: Warning logs (e.g., missing settings)
  - `obs.trackError(error, metadata)`: Error logs

**When to use**: All service operations for monitoring

---

## Dependencies

### Required (Blocking)

| Dependency | Status | Description |
|------------|--------|-------------|
| @codex/database | ✅ Available | Drizzle ORM client and schema |
| @codex/cloudflare-clients | ✅ Available | R2Service for file uploads |
| @codex/validation | ✅ Available | Zod schemas for input validation |

### Optional (Nice to Have)

| Dependency | Status | Description |
|------------|--------|-------------|
| P1-ADMIN-001 | 🚧 Future | Platform owner middleware (can use auth middleware directly) |

### Infrastructure Ready

- ✅ Database client (Drizzle ORM)
- ✅ R2 client (file uploads)
- ✅ Validation package (Zod)
- ✅ Observability package (logging)

---

## Implementation Checklist

- [ ] **Database Setup**
  - [ ] Create `platform_settings` schema in `@codex/database`
  - [ ] Generate migration with `pnpm db:gen:drizzle`
  - [ ] Run migration in development
  - [ ] Verify table exists in Drizzle Studio

- [ ] **Validation Schemas**
  - [ ] Create `settings.ts` in `@codex/validation/src/schemas/`
  - [ ] Implement `updatePlatformSettingsSchema` (hex colors, email, URL)
  - [ ] Implement `uploadLogoSchema` (file type/size validation)
  - [ ] Add unit tests for validation

- [ ] **Platform Settings Service**
  - [ ] Create `packages/platform-settings/` directory
  - [ ] Implement `PlatformSettingsService` (composition pattern)
  - [ ] Implement `getSettings()` (with defaults)
  - [ ] Implement `updateSettings()` (upsert pattern)
  - [ ] Implement `uploadLogo()` (file validation + R2 upload)
  - [ ] Implement `deleteLogo()` (R2 delete + URL extraction)
  - [ ] Create factory function `getPlatformSettingsService()`
  - [ ] Add unit tests (mocked DB and R2)

- [ ] **API Endpoints**
  - [ ] Create `workers/auth/src/routes/settings.ts`
  - [ ] Implement `GET /api/settings` (public)
  - [ ] Implement `PUT /api/settings` (platform owner)
  - [ ] Implement `POST /api/settings/logo` (platform owner)
  - [ ] Implement `DELETE /api/settings/logo` (platform owner)
  - [ ] Apply `requirePlatformOwner()` middleware
  - [ ] Add integration tests

- [ ] **Tests**
  - [ ] Unit tests for validation schemas
  - [ ] Unit tests for service (mocked DB and R2)
  - [ ] Integration tests for API endpoints
  - [ ] Test file upload error handling

- [ ] **Documentation**
  - [ ] Update public API exports in `packages/platform-settings/src/index.ts`
  - [ ] Document environment variables
  - [ ] Add usage examples

---

## Testing Strategy

### Unit Tests
- **Validation Schemas**: Test hex color validation, email validation, partial updates
- **Service Methods**: Test with mocked DB and R2
  - `getSettings()`: Returns settings or defaults
  - `updateSettings()`: Upsert behavior
  - `uploadLogo()`: File type/size validation, R2 upload
  - `deleteLogo()`: R2 delete, URL extraction

### Integration Tests
- **API Endpoints**: Test full request-response cycle
  - `GET /api/settings`: Public access works
  - `PUT /api/settings`: Platform owner can update
  - `POST /api/settings/logo`: Logo upload works
  - `DELETE /api/settings/logo`: Logo delete works
  - Non-platform-owners receive 403

### Local Development Testing
- **R2 Integration**: Test actual file upload to R2 bucket
- **Database Upsert**: Verify one row per organization
- **Default Settings**: Verify defaults returned when settings not found

### E2E Scenarios
- **Branding Update Flow**: Platform owner updates name/colors → Frontend displays new branding
- **Logo Upload Flow**: Platform owner uploads logo → Logo appears in UI

---

## Notes

### Architectural Decisions

**Why Not BaseService?**
- Settings are organization-scoped, not user-scoped
- No need for `userId` dependency
- Composition over inheritance (minimal dependencies)

**Why Upsert Pattern?**
- Ensures exactly one settings row per organization
- Atomic operation (no race conditions)
- Supports partial updates (only change specified fields)

**Why Public GET Endpoint?**
- Frontend needs branding (name, logo, colors) without authentication
- Read-only, non-sensitive data
- Enables server-side rendering with settings

### Security Considerations

**File Upload Validation**:
- Validate file type BEFORE R2 upload (fail fast)
- Limit file size to 5MB (prevent abuse)
- Use content type from file (not user input)

**Logo URL Storage**:
- Store public R2 URL (or signed URL for private buckets)
- Extract R2 path for deletion (parse URL)

**Feature Toggles**:
- Check toggles in middleware (before route handlers)
- Enforce consistently across all endpoints

### Performance Notes

**Expected Latency**:
- `getSettings()`: ~50ms (single query with defaults)
- `updateSettings()`: ~100ms (upsert operation)
- `uploadLogo()`: ~500-1000ms (file upload to R2)
- `deleteLogo()`: ~200ms (R2 delete + database update)

**Caching** (Future Enhancement):
- Cache settings in KV for faster reads (5-minute TTL)
- Invalidate cache on update

### Future Enhancements

**Phase 2+**:
- Email template customization (custom email branding)
- Multi-language support (locale-specific platform names)
- Advanced theming (CSS variables, font choices)
- Logo variants (dark mode logo, favicon)

---

**Last Updated**: 2025-11-24
**Template Version**: 1.0
