# Work Packet: P1-SETTINGS-001 - Platform Settings

**Status**: 🚧 To Be Implemented
**Priority**: P2 (Nice to Have - can defer)
**Estimated Effort**: 2-3 days
**Branch**: `feature/P1-SETTINGS-001-platform-settings`

---

## Current State

**✅ Already Implemented:**
- R2 client with upload capabilities (`@codex/cloudflare-clients/r2`)
- Database client with Drizzle ORM
- Validation package (`@codex/validation`)
- Platform owner middleware (from P1-ADMIN-001)

**🚧 Needs Implementation:**
- Platform settings schema
- Settings validation schemas
- Settings service (CRUD operations)
- Settings API endpoints
- Logo upload to R2
- Tests

---

## Dependencies

### Required Work Packets
- **P1-ADMIN-001** (Admin Dashboard) - Optional (for platform owner middleware)

### Existing Code
```typescript
// R2 upload already available
import { R2Service } from '@codex/cloudflare-clients/r2';

const r2 = new R2Service(env.R2_BUCKET);
await r2.uploadFile('logos/org-123.png', file, { contentType: 'image/png' });
```

### Required Documentation
- [R2 Storage Patterns](../../core/R2_STORAGE_PATTERNS.md)
- [STANDARDS.md](../STANDARDS.md)

---

## Implementation Steps

### Step 1: Create Platform Settings Schema

**File**: `packages/database/src/schema/settings.ts`

```typescript
import { pgTable, text, timestamp, boolean } from 'drizzle-orm/pg-core';

/**
 * Platform settings for branding and configuration
 *
 * Design decisions:
 * - One row per organization (enforced by unique constraint)
 * - JSONB fields for flexible configuration without schema changes
 * - Logo stored in R2, URL stored here
 * - Upsert pattern for settings updates
 */
export const platformSettings = pgTable('platform_settings', {
  organizationId: text('organization_id').primaryKey(),

  // Branding
  platformName: text('platform_name').notNull(),
  logoUrl: text('logo_url'),
  primaryColor: text('primary_color').notNull().default('#3498db'),
  secondaryColor: text('secondary_color').notNull().default('#2c3e50'),

  // Contact information
  supportEmail: text('support_email').notNull(),
  contactUrl: text('contact_url'),

  // Features
  enableSignups: boolean('enable_signups').notNull().default(true),
  enablePurchases: boolean('enable_purchases').notNull().default(true),

  // Metadata
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
    .$onUpdate(() => new Date()),
});

export type PlatformSettings = typeof platformSettings.$inferSelect;
export type InsertPlatformSettings = typeof platformSettings.$inferInsert;
```

**Migration**: `packages/database/migrations/XXXX_create_platform_settings.sql`

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

-- Insert default settings for existing organizations
-- INSERT INTO platform_settings (organization_id, platform_name, support_email)
-- SELECT id, 'My Platform', 'support@example.com' FROM organizations;
```

### Step 2: Create Settings Validation Schemas

**File**: `packages/validation/src/schemas/settings.ts`

```typescript
import { z } from 'zod';

/**
 * ✅ TESTABLE: Pure validation schemas (no DB dependency)
 */

const hexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color');

export const updatePlatformSettingsSchema = z.object({
  platformName: z.string().min(1, 'Platform name required').max(100, 'Platform name too long').optional(),
  primaryColor: hexColorSchema.optional(),
  secondaryColor: hexColorSchema.optional(),
  supportEmail: z.string().email('Invalid support email').optional(),
  contactUrl: z.string().url('Invalid contact URL').optional(),
  enableSignups: z.boolean().optional(),
  enablePurchases: z.boolean().optional(),
});

export const uploadLogoSchema = z.object({
  file: z.instanceof(File),
  maxSizeBytes: z.number().int().min(1).default(5 * 1024 * 1024), // 5MB default
  allowedTypes: z.array(z.string()).default(['image/png', 'image/jpeg', 'image/webp']),
});

export type UpdatePlatformSettingsInput = z.infer<typeof updatePlatformSettingsSchema>;
export type UploadLogoInput = z.infer<typeof uploadLogoSchema>;
```

### Step 3: Create Platform Settings Service

**File**: `packages/platform-settings/src/service.ts`

```typescript
import { eq } from 'drizzle-orm';
import type { DrizzleClient } from '@codex/database';
import { platformSettings } from '@codex/database/schema';
import { R2Service } from '@codex/cloudflare-clients/r2';
import { ObservabilityClient } from '@codex/observability';
import type { UpdatePlatformSettingsInput } from '@codex/validation/schemas/settings';

export interface PlatformSettingsServiceConfig {
  db: DrizzleClient;
  r2: R2Service;
  obs: ObservabilityClient;
  organizationId: string;
}

export class PlatformSettingsService {
  constructor(private config: PlatformSettingsServiceConfig) {}

  /**
   * Get platform settings (returns defaults if not set)
   */
  async getSettings(): Promise<{
    platformName: string;
    logoUrl: string | null;
    primaryColor: string;
    secondaryColor: string;
    supportEmail: string;
    contactUrl: string | null;
    enableSignups: boolean;
    enablePurchases: boolean;
  }> {
    const { db, obs, organizationId } = this.config;

    obs.info('Getting platform settings', { organizationId });

    const settings = await db.query.platformSettings.findFirst({
      where: eq(platformSettings.organizationId, organizationId),
    });

    // Return defaults if not set
    if (!settings) {
      obs.warn('Platform settings not found, returning defaults', { organizationId });
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

    return {
      platformName: settings.platformName,
      logoUrl: settings.logoUrl,
      primaryColor: settings.primaryColor,
      secondaryColor: settings.secondaryColor,
      supportEmail: settings.supportEmail,
      contactUrl: settings.contactUrl,
      enableSignups: settings.enableSignups,
      enablePurchases: settings.enablePurchases,
    };
  }

  /**
   * Update platform settings (upsert pattern)
   */
  async updateSettings(input: UpdatePlatformSettingsInput): Promise<void> {
    const { db, obs, organizationId } = this.config;

    obs.info('Updating platform settings', {
      organizationId,
      fields: Object.keys(input),
    });

    // Upsert pattern
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

    obs.info('Platform settings updated', { organizationId });
  }

  /**
   * Upload logo to R2 and update settings
   */
  async uploadLogo(file: File): Promise<{ logoUrl: string }> {
    const { r2, db, obs, organizationId } = this.config;

    obs.info('Uploading logo', {
      organizationId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
    });

    // Validate file type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      throw new Error('INVALID_FILE_TYPE');
    }

    // Validate file size (5MB max)
    const maxSizeBytes = 5 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      throw new Error('FILE_TOO_LARGE');
    }

    // Generate R2 path
    const extension = file.type.split('/')[1]; // 'png', 'jpeg', etc.
    const r2Path = `logos/${organizationId}.${extension}`;

    // Upload to R2
    const buffer = await file.arrayBuffer();
    await r2.uploadFile(r2Path, new Uint8Array(buffer), {
      contentType: file.type,
    });

    // Generate public URL (or signed URL if bucket is private)
    const logoUrl = await r2.getPublicUrl(r2Path);

    // Update settings with logo URL
    await db.insert(platformSettings).values({
      organizationId,
      logoUrl,
      platformName: 'My Platform', // Default
      supportEmail: 'support@example.com', // Default
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: platformSettings.organizationId,
      set: {
        logoUrl,
        updatedAt: new Date(),
      },
    });

    obs.info('Logo uploaded successfully', {
      organizationId,
      logoUrl,
    });

    return { logoUrl };
  }

  /**
   * Delete logo from R2 and settings
   */
  async deleteLogo(): Promise<void> {
    const { r2, db, obs, organizationId } = this.config;

    obs.info('Deleting logo', { organizationId });

    // Get current settings to find logo path
    const settings = await db.query.platformSettings.findFirst({
      where: eq(platformSettings.organizationId, organizationId),
    });

    if (settings?.logoUrl) {
      // Extract R2 path from URL (assumes URL format: https://bucket.r2.dev/logos/org-123.png)
      const r2Path = settings.logoUrl.split('/').slice(-2).join('/'); // 'logos/org-123.png'

      // Delete from R2
      await r2.deleteFile(r2Path);
    }

    // Update settings to remove logo URL
    await db.update(platformSettings)
      .set({
        logoUrl: null,
        updatedAt: new Date(),
      })
      .where(eq(platformSettings.organizationId, organizationId));

    obs.info('Logo deleted', { organizationId });
  }
}

/**
 * Factory function for dependency injection
 */
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

### Step 4: Create Settings API Endpoints

**File**: `workers/auth/src/routes/settings.ts`

```typescript
import { Hono } from 'hono';
import type { AuthContext } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { requirePlatformOwner } from '../middleware/require-platform-owner';
import { getPlatformSettingsService } from '@codex/platform-settings';
import { updatePlatformSettingsSchema } from '@codex/validation/schemas/settings';
import { ObservabilityClient } from '@codex/observability';

const app = new Hono<AuthContext>();

/**
 * GET /api/settings
 * Get platform settings (public - no auth required)
 */
app.get('/api/settings', async (c) => {
  const obs = new ObservabilityClient('settings-api', c.env.ENVIRONMENT);

  try {
    // Extract organizationId from request (e.g., subdomain or header)
    // For simplicity, using env variable here
    const service = getPlatformSettingsService(c.env);

    const settings = await service.getSettings();

    return c.json(settings);
  } catch (err) {
    obs.trackError(err as Error);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get settings' } }, 500);
  }
});

/**
 * PUT /api/settings
 * Update platform settings (platform owner only)
 */
app.put('/api/settings', requireAuth(), requirePlatformOwner(), async (c) => {
  const obs = new ObservabilityClient('settings-api', c.env.ENVIRONMENT);
  const user = c.get('user');

  try {
    const body = await c.req.json();
    const input = updatePlatformSettingsSchema.parse(body);

    const service = getPlatformSettingsService({
      ...c.env,
      ORGANIZATION_ID: user.organizationId,
    });

    await service.updateSettings(input);

    return c.json({ success: true });
  } catch (err) {
    if ((err as any).errors) {
      // Zod validation error
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: (err as any).errors } }, 400);
    }
    obs.trackError(err as Error, { userId: user.id });
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to update settings' } }, 500);
  }
});

/**
 * POST /api/settings/logo
 * Upload platform logo (platform owner only)
 */
app.post('/api/settings/logo', requireAuth(), requirePlatformOwner(), async (c) => {
  const obs = new ObservabilityClient('settings-api', c.env.ENVIRONMENT);
  const user = c.get('user');

  try {
    const formData = await c.req.formData();
    const file = formData.get('logo') as File;

    if (!file) {
      return c.json({ error: { code: 'MISSING_FILE', message: 'Logo file required' } }, 400);
    }

    const service = getPlatformSettingsService({
      ...c.env,
      ORGANIZATION_ID: user.organizationId,
    });

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
    obs.trackError(err as Error, { userId: user.id });
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to upload logo' } }, 500);
  }
});

/**
 * DELETE /api/settings/logo
 * Delete platform logo (platform owner only)
 */
app.delete('/api/settings/logo', requireAuth(), requirePlatformOwner(), async (c) => {
  const obs = new ObservabilityClient('settings-api', c.env.ENVIRONMENT);
  const user = c.get('user');

  try {
    const service = getPlatformSettingsService({
      ...c.env,
      ORGANIZATION_ID: user.organizationId,
    });

    await service.deleteLogo();

    return c.json({ success: true });
  } catch (err) {
    obs.trackError(err as Error, { userId: user.id });
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to delete logo' } }, 500);
  }
});

export default app;
```

### Step 5: Wire Up Routes

**File**: `workers/auth/src/index.ts` (modify existing)

```typescript
import settingsRoutes from './routes/settings';

// ... existing routes ...

app.route('/', settingsRoutes);
```

### Step 6: Add Tests

**File**: `packages/platform-settings/src/service.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlatformSettingsService } from './service';

describe('PlatformSettingsService', () => {
  let mockDb: any;
  let mockR2: any;
  let mockObs: any;
  let service: PlatformSettingsService;

  beforeEach(() => {
    mockDb = {
      query: {
        platformSettings: {
          findFirst: vi.fn(),
        },
      },
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn().mockResolvedValue(undefined),
        })),
      })),
    };

    mockR2 = {
      uploadFile: vi.fn().mockResolvedValue(undefined),
      getPublicUrl: vi.fn().mockReturnValue('https://r2.example.com/logos/org-123.png'),
      deleteFile: vi.fn().mockResolvedValue(undefined),
    };

    mockObs = {
      info: vi.fn(),
      warn: vi.fn(),
    };

    service = new PlatformSettingsService({
      db: mockDb,
      r2: mockR2,
      obs: mockObs,
      organizationId: 'org-123',
    });
  });

  describe('getSettings', () => {
    it('should return settings if exists', async () => {
      mockDb.query.platformSettings.findFirst.mockResolvedValue({
        platformName: 'Test Platform',
        logoUrl: 'https://example.com/logo.png',
        primaryColor: '#ff0000',
        secondaryColor: '#00ff00',
        supportEmail: 'support@test.com',
        contactUrl: 'https://test.com/contact',
        enableSignups: true,
        enablePurchases: true,
      });

      const settings = await service.getSettings();

      expect(settings.platformName).toBe('Test Platform');
      expect(settings.logoUrl).toBe('https://example.com/logo.png');
    });

    it('should return defaults if settings not found', async () => {
      mockDb.query.platformSettings.findFirst.mockResolvedValue(null);

      const settings = await service.getSettings();

      expect(settings.platformName).toBe('My Platform');
      expect(settings.logoUrl).toBeNull();
      expect(settings.primaryColor).toBe('#3498db');
    });
  });

  describe('uploadLogo', () => {
    it('should upload logo and update settings', async () => {
      const file = new File(['test'], 'logo.png', { type: 'image/png' });
      Object.defineProperty(file, 'size', { value: 1024 }); // 1KB

      const result = await service.uploadLogo(file);

      expect(mockR2.uploadFile).toHaveBeenCalled();
      expect(result.logoUrl).toBe('https://r2.example.com/logos/org-123.png');
    });

    it('should reject invalid file type', async () => {
      const file = new File(['test'], 'logo.txt', { type: 'text/plain' });

      await expect(service.uploadLogo(file)).rejects.toThrow('INVALID_FILE_TYPE');
    });

    it('should reject file too large', async () => {
      const file = new File(['test'], 'logo.png', { type: 'image/png' });
      Object.defineProperty(file, 'size', { value: 10 * 1024 * 1024 }); // 10MB

      await expect(service.uploadLogo(file)).rejects.toThrow('FILE_TOO_LARGE');
    });
  });

  describe('deleteLogo', () => {
    it('should delete logo from R2 and settings', async () => {
      mockDb.query.platformSettings.findFirst.mockResolvedValue({
        logoUrl: 'https://r2.example.com/logos/org-123.png',
      });

      await service.deleteLogo();

      expect(mockR2.deleteFile).toHaveBeenCalledWith('logos/org-123.png');
      expect(mockDb.update).toHaveBeenCalled();
    });
  });
});
```

**File**: `packages/validation/src/schemas/settings.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { updatePlatformSettingsSchema } from './settings';

describe('Settings Validation Schemas', () => {
  describe('updatePlatformSettingsSchema', () => {
    it('should validate valid settings', () => {
      const result = updatePlatformSettingsSchema.parse({
        platformName: 'My Platform',
        primaryColor: '#ff0000',
        secondaryColor: '#00ff00',
        supportEmail: 'support@example.com',
        contactUrl: 'https://example.com/contact',
        enableSignups: true,
        enablePurchases: false,
      });

      expect(result.platformName).toBe('My Platform');
      expect(result.primaryColor).toBe('#ff0000');
    });

    it('should reject invalid hex color', () => {
      expect(() =>
        updatePlatformSettingsSchema.parse({
          primaryColor: 'red', // Not hex
        })
      ).toThrow();
    });

    it('should reject invalid email', () => {
      expect(() =>
        updatePlatformSettingsSchema.parse({
          supportEmail: 'not-an-email',
        })
      ).toThrow();
    });

    it('should allow partial updates', () => {
      const result = updatePlatformSettingsSchema.parse({
        platformName: 'New Name',
      });

      expect(result.platformName).toBe('New Name');
      expect(result.primaryColor).toBeUndefined();
    });
  });
});
```

---

## Test Specifications

### Unit Tests (Validation)
- `updatePlatformSettingsSchema` - Valid settings, hex color validation
- `updatePlatformSettingsSchema` - Email validation, partial updates

### Unit Tests (Service)
- `getSettings` - Returns settings or defaults
- `updateSettings` - Upsert behavior
- `uploadLogo` - Uploads to R2, updates settings
- `uploadLogo` - Validates file type and size
- `deleteLogo` - Deletes from R2 and settings

### Integration Tests (API)
- `GET /api/settings` - Returns settings (public endpoint)
- `PUT /api/settings` - Updates settings (platform owner only)
- `POST /api/settings/logo` - Uploads logo (platform owner only)
- `DELETE /api/settings/logo` - Deletes logo (platform owner only)
- `PUT /api/settings` - 403 for non-platform-owner

---

## Definition of Done

- [ ] Platform settings schema created with migration
- [ ] Settings validation schemas implemented (Zod)
- [ ] Platform settings service implemented
- [ ] Settings API endpoints created
- [ ] Logo upload to R2 working
- [ ] Logo deletion from R2 working
- [ ] Unit tests for validation (100% coverage)
- [ ] Unit tests for service (mocked DB and R2)
- [ ] Integration tests for API endpoints
- [ ] Error handling comprehensive (file validation, upload errors)
- [ ] Observability logging complete
- [ ] Upsert pattern working for settings updates
- [ ] CI passing (tests + typecheck + lint)

---

## Integration Points

### Depends On
- **Database client**: Already available
- **R2 client**: Already available (`@codex/cloudflare-clients/r2`)
- **P1-ADMIN-001** (Optional): For platform owner middleware

### Integrates With
- Existing auth worker: `workers/auth/src/index.ts`
- R2 storage: `@codex/cloudflare-clients/r2`

### Enables
- Platform branding customization
- Logo management
- Feature toggles (signups, purchases)

---

## Step 7: Public API and Package Exports

**Why This Matters**: Clear public API enables other packages to import only what they need and work in isolation.

**File**: `packages/platform-settings/src/index.ts`

```typescript
/**
 * @codex/platform-settings - Platform branding and configuration
 *
 * PUBLIC API
 * ==========
 * This package exports a service for managing platform-wide settings like branding, logos, and feature toggles.
 *
 * INTERFACE CONTRACT:
 * ------------------
 * Other packages (e.g., @codex/web, @codex/auth) depend on:
 * 1. PlatformSettingsService class with CRUD methods
 * 2. Settings data types (PlatformSettings, UpdatePlatformSettingsInput)
 * 3. Factory function for dependency injection
 *
 * INTERNAL IMPLEMENTATION:
 * -----------------------
 * Database queries, R2 uploads, and validation logic are internal.
 * Other packages MUST NOT import from subdirectories.
 *
 * USAGE EXAMPLE:
 * -------------
 * ```typescript
 * import { getPlatformSettingsService } from '@codex/platform-settings';
 *
 * const service = getPlatformSettingsService(env);
 * const settings = await service.getSettings();
 * // { platformName: 'My Platform', logoUrl: '...', ... }
 * ```
 */

// ============================================================================
// PUBLIC API - Safe to import from other packages
// ============================================================================

// Service
export { PlatformSettingsService, getPlatformSettingsService } from './service';
export type { PlatformSettingsServiceConfig } from './service';

// Type exports from database schema
export type { PlatformSettings, InsertPlatformSettings } from '@codex/database/schema';

// Validation types (re-exported for convenience)
export type { UpdatePlatformSettingsInput, UploadLogoInput } from '@codex/validation/schemas/settings';

// ============================================================================
// INTERNAL - DO NOT import from other packages
// ============================================================================

// Service implementation details are internal
// Use getPlatformSettingsService() factory instead
```

**File**: `packages/platform-settings/package.json`

```json
{
  "name": "@codex/platform-settings",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@codex/database": "workspace:*",
    "@codex/cloudflare-clients": "workspace:*",
    "@codex/observability": "workspace:*",
    "@codex/validation": "workspace:*",
    "drizzle-orm": "^0.30.0"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "vitest": "^1.0.0"
  }
}
```

---

## Step 8: Local Development Setup

**Why This Matters**: Developers need to test platform settings locally, including logo uploads to R2.

### Local R2 Access (Already Configured)

Platform settings uses the same R2 bucket as other services, so R2 access is already configured in your local environment:

**File**: `.env.local` (R2 credentials already exist)

```bash
# R2 Storage (shared with all services)
R2_ENDPOINT=https://<your-account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY=<your-r2-access-key>
R2_SECRET_KEY=<your-r2-secret-key>

# Organization ID for platform settings
ORGANIZATION_ID=default-org-123
```

### Local Development Workflow

**Start Local Services**:
```bash
# Start postgres and neon-proxy
cd infrastructure/neon
docker compose -f docker-compose.dev.local.yml up -d

# Verify services are running
docker compose -f docker-compose.dev.local.yml ps
```

**Run Database Migrations**:
```bash
# Apply platform_settings schema
pnpm --filter @codex/database db:migrate

# Verify table exists
pnpm --filter @codex/database db:studio
# Check that 'platform_settings' table appears in Drizzle Studio
```

**Seed Default Settings (Optional)**:
```bash
# Create seed script: packages/database/scripts/seed-settings.ts
import { db } from '../src/client';
import { platformSettings } from '../src/schema/settings';

await db.insert(platformSettings).values({
  organizationId: 'default-org-123',
  platformName: 'Codex Dev',
  supportEmail: 'support@localhost',
  primaryColor: '#3498db',
  secondaryColor: '#2c3e50',
  enableSignups: true,
  enablePurchases: true,
});

console.log('✓ Default settings seeded');
```

**Test Platform Settings Service**:
```bash
cd packages/platform-settings
pnpm test           # Run all tests
pnpm test:watch     # Watch mode for development
```

**Manual Testing via Auth Worker**:

1. Start your local dev server:
```bash
pnpm dev
```

2. Test GET endpoint (public - no auth):
```bash
curl http://localhost:8787/api/settings
# Returns: { "platformName": "Codex Dev", "logoUrl": null, ... }
```

3. Test logo upload (requires auth + platform owner role):
```bash
# First, get auth token by logging in
TOKEN="your-auth-token"

# Upload logo
curl -X POST http://localhost:8787/api/settings/logo \
  -H "Authorization: Bearer $TOKEN" \
  -F "logo=@/path/to/logo.png"

# Response: { "logoUrl": "https://r2.example.com/logos/default-org-123.png" }
```

4. Verify logo in R2:
```bash
# Check R2 bucket via Cloudflare dashboard or CLI
wrangler r2 object get codex-media logos/default-org-123.png --file=downloaded-logo.png
```

**View Uploaded Logos**:
- Navigate to Cloudflare dashboard → R2 → codex-media bucket
- Browse to `logos/` folder
- See uploaded logo files

---

## Step 9: CI/CD Integration

**Why This Matters**: Ensures tests run in CI and settings work correctly across environments.

### GitHub Actions Workflow

**No Changes Required**: Existing workflow already handles this package.

**File**: `.github/workflows/test.yml` (already exists)

```yaml
name: Test

on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install

      - name: Run tests
        run: pnpm test
        # This will test @codex/platform-settings with mocked DB and R2

      - name: Type check
        run: pnpm run typecheck

      - name: Lint
        run: pnpm run lint
```

### Environment-Specific Configuration

**Local Development** (.env.local):
```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/main
R2_ENDPOINT=https://<your-account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY=<your-r2-access-key>
R2_SECRET_KEY=<your-r2-secret-key>
ORGANIZATION_ID=default-org-123
ENVIRONMENT=local
```

**Preview Environments** (Cloudflare Workers):
```bash
# Set in wrangler.jsonc [env.preview] or Cloudflare dashboard
DATABASE_URL=<neon-preview-branch-url>
ORGANIZATION_ID=preview-org
ENVIRONMENT=preview

# R2 secrets already configured for workers:
# R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET_KEY
```

**Production** (Cloudflare Workers):
```bash
# Set in Cloudflare dashboard as secrets
DATABASE_URL=<neon-production-url>
ORGANIZATION_ID=production-org
ENVIRONMENT=production
```

### Testing Strategy

1. **Unit Tests** (packages/platform-settings):
   - Mock DrizzleClient and R2Service
   - Test service methods in isolation
   - Test validation schemas
   - No external dependencies

2. **Local Development**:
   - Use real Postgres (via docker-compose)
   - Use real R2 bucket (your dev bucket)
   - Test logo upload/delete flows
   - Verify R2 file operations

3. **Preview Environment**:
   - Use Neon preview branch (ephemeral database)
   - Use production R2 bucket (isolated paths)
   - Test with real auth worker
   - Verify API endpoints

4. **Production**:
   - Use production Neon database
   - Use production R2 bucket
   - Monitor via observability
   - Track errors and performance

### Database Migrations in CI/CD

**Preview Deployments**:
```bash
# .github/workflows/preview-deploy.yml
- name: Run migrations on preview branch
  run: |
    pnpm --filter @codex/database db:migrate
  env:
    DATABASE_URL: ${{ secrets.NEON_PREVIEW_DATABASE_URL }}
```

**Production Deployments**:
```bash
# .github/workflows/deploy-production.yml
- name: Run migrations on production
  run: |
    pnpm --filter @codex/database db:migrate
  env:
    DATABASE_URL: ${{ secrets.NEON_PRODUCTION_DATABASE_URL }}
```

---

## Integration Points (Detailed)

### How Other Packages Use This Service

**Example: Frontend App** (`apps/web/src/routes/+layout.server.ts`)

```typescript
import { getPlatformSettingsService } from '@codex/platform-settings';

export async function load({ locals }) {
  const service = getPlatformSettingsService({
    DATABASE_URL: locals.env.DATABASE_URL,
    R2_BUCKET: locals.env.R2_BUCKET,
    ENVIRONMENT: locals.env.ENVIRONMENT,
    ORGANIZATION_ID: locals.env.ORGANIZATION_ID,
  });

  // Get settings for layout branding
  const settings = await service.getSettings();

  return {
    platformName: settings.platformName,
    logoUrl: settings.logoUrl,
    primaryColor: settings.primaryColor,
    // ... other settings for UI theming
  };
}
```

**Example: Auth Worker** (`workers/auth/src/routes/settings.ts`)

```typescript
import { getPlatformSettingsService, type UpdatePlatformSettingsInput } from '@codex/platform-settings';

// GET /api/settings (public endpoint)
app.get('/api/settings', async (c) => {
  const service = getPlatformSettingsService(c.env);
  const settings = await service.getSettings();
  return c.json(settings);
});

// PUT /api/settings (platform owner only)
app.put('/api/settings', requireAuth(), requirePlatformOwner(), async (c) => {
  const body = await c.req.json();
  const input: UpdatePlatformSettingsInput = updatePlatformSettingsSchema.parse(body);

  const service = getPlatformSettingsService(c.env);
  await service.updateSettings(input);

  return c.json({ success: true });
});
```

**Example: Admin Dashboard** (`apps/admin/src/routes/settings/+page.svelte`)

```typescript
<script lang="ts">
  import { onMount } from 'svelte';

  let settings = { platformName: '', logoUrl: null };

  onMount(async () => {
    const response = await fetch('/api/settings');
    settings = await response.json();
  });

  async function uploadLogo(file: File) {
    const formData = new FormData();
    formData.append('logo', file);

    const response = await fetch('/api/settings/logo', {
      method: 'POST',
      body: formData,
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const result = await response.json();
    settings.logoUrl = result.logoUrl;
  }
</script>

<h1>Platform Settings</h1>
<img src={settings.logoUrl} alt={settings.platformName} />
```

### Interface Contracts

**What Other Packages Can Depend On**:

1. **PlatformSettingsService** class with these methods:
   - `getSettings(): Promise<PlatformSettings>`
   - `updateSettings(input: UpdatePlatformSettingsInput): Promise<void>`
   - `uploadLogo(file: File): Promise<{ logoUrl: string }>`
   - `deleteLogo(): Promise<void>`

2. **Data Types**:
   - `PlatformSettings` - Full settings object
   - `UpdatePlatformSettingsInput` - Partial update input
   - `UploadLogoInput` - Logo upload validation

3. **Factory Function**:
   - `getPlatformSettingsService(env): PlatformSettingsService`

**What Other Packages CANNOT Depend On**:
- Database query implementations (internal)
- R2 upload/delete implementations (internal)
- Service constructor (use factory instead)

### Environment Variables Required by Consumers

Workers and apps that use `@codex/platform-settings` must set:

```bash
DATABASE_URL=postgresql://...       # Neon database connection
ORGANIZATION_ID=org-123            # Organization ID for settings
ENVIRONMENT=production|preview|local
# R2_BUCKET is passed directly (not string URL)
```

### Package Dependencies

**This package depends on**:
- `@codex/database` - Drizzle ORM client and schema
- `@codex/cloudflare-clients` - R2Service for file uploads
- `@codex/observability` - Logging and error tracking
- `@codex/validation` - Validation schemas (Zod)

**Packages that depend on this**:
- `@codex/web` - Frontend app (for branding)
- `workers/auth` - Auth worker (API endpoints)
- `@codex/admin` (future) - Admin dashboard

### API Endpoints

These endpoints are available after integrating with auth worker:

| Method | Endpoint | Auth Required | Description |
|--------|----------|---------------|-------------|
| GET | `/api/settings` | No (public) | Get platform settings |
| PUT | `/api/settings` | Platform Owner | Update platform settings |
| POST | `/api/settings/logo` | Platform Owner | Upload platform logo |
| DELETE | `/api/settings/logo` | Platform Owner | Delete platform logo |

**Request/Response Examples**:

```typescript
// GET /api/settings
Response: {
  "platformName": "Codex",
  "logoUrl": "https://r2.example.com/logos/org-123.png",
  "primaryColor": "#3498db",
  "secondaryColor": "#2c3e50",
  "supportEmail": "support@codex.com",
  "contactUrl": "https://codex.com/contact",
  "enableSignups": true,
  "enablePurchases": true
}

// PUT /api/settings
Request: {
  "platformName": "New Name",
  "primaryColor": "#ff0000"
}
Response: { "success": true }

// POST /api/settings/logo (multipart/form-data)
Request: FormData with 'logo' field (File)
Response: { "logoUrl": "https://r2.example.com/logos/org-123.png" }

// DELETE /api/settings/logo
Response: { "success": true }
```

---

## Related Documentation

**Must Read**:
- [Platform Settings TDD](../../features/platform-settings/ttd-dphase-1.md) - Feature specification
- [R2 Storage Patterns](../../core/R2_STORAGE_PATTERNS.md)
- [STANDARDS.md](../STANDARDS.md) - § 3 Validation separation

**Reference**:
- [Testing Strategy](../../infrastructure/Testing.md)

**Code Examples**:
- R2 client: `packages/cloudflare-clients/src/r2/client.ts`

---

## Notes for LLM Developer

1. **No Dependencies**: This work packet can be started immediately (independent)
2. **Upsert Pattern**: Use `onConflictDoUpdate` for settings updates (one row per organization)
3. **File Validation**: Check file type and size before R2 upload
4. **Public Endpoint**: GET /api/settings is public (no auth required) for frontend branding
5. **Logo Storage**: Store in R2 under `logos/{organizationId}.{extension}`
6. **Default Settings**: Return sensible defaults if settings not found
7. **Platform Owner Only**: Write operations require platform owner role

**Common Pitfalls**:
- Don't forget file size/type validation before R2 upload
- Handle missing settings gracefully (return defaults)
- Clean up old logo from R2 when uploading new one
- Use proper content types for R2 uploads

**If Stuck**: Check [CONTEXT_MAP.md](../CONTEXT_MAP.md) or existing R2 client implementation.

---

**Last Updated**: 2025-11-05
