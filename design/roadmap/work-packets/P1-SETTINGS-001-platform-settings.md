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
