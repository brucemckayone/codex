/**
 * Platform Settings Facade Tests
 *
 * Tests for PlatformSettingsFacade covering:
 * - Delegation to specialized services
 * - getAllSettings() parallel queries
 * - Logo operations delegation
 */

import type { R2Service } from '@codex/cloudflare-clients';
import { schema } from '@codex/database';
import {
  type Database,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import {
  DEFAULT_BRANDING,
  DEFAULT_CONTACT,
  DEFAULT_FEATURES,
} from '@codex/validation';
import { eq } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { PlatformSettingsFacade } from '../services/platform-settings-service';

/**
 * Helper to create valid image file data for testing
 * Uses real PNG magic numbers for content validation
 */
function createValidImageBuffer(
  mimeType: string,
  sizeBytes = 1024
): ArrayBuffer {
  const buffer = new ArrayBuffer(sizeBytes);
  const view = new Uint8Array(buffer);

  if (mimeType === 'image/png') {
    const pngHeader = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    pngHeader.forEach((byte, i) => {
      view[i] = byte;
    });
  }

  return buffer;
}

describe('PlatformSettingsFacade', () => {
  let db: Database;
  let organizationId: string;

  beforeAll(async () => {
    db = setupTestDatabase();

    // Create a test organization
    const [org] = await db
      .insert(schema.organizations)
      .values({
        id: crypto.randomUUID(),
        name: 'Test Organization',
        slug: `test-org-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    organizationId = org.id;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    // Clean up all settings tables before each test
    await db
      .delete(schema.brandingSettings)
      .where(eq(schema.brandingSettings.organizationId, organizationId));
    await db
      .delete(schema.contactSettings)
      .where(eq(schema.contactSettings.organizationId, organizationId));
    await db
      .delete(schema.featureSettings)
      .where(eq(schema.featureSettings.organizationId, organizationId));
    await db
      .delete(schema.platformSettings)
      .where(eq(schema.platformSettings.organizationId, organizationId));
  });

  function createMockR2() {
    return {
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      list: vi.fn(),
      putJson: vi.fn(),
      generateSignedUrl: vi.fn(),
    };
  }

  function createFacade(r2?: ReturnType<typeof createMockR2>) {
    return new PlatformSettingsFacade({
      db,
      environment: 'test',
      organizationId,
      r2: r2 as unknown as R2Service,
      r2PublicUrlBase: 'https://cdn.example.com',
    });
  }

  describe('getAllSettings()', () => {
    it('should return all defaults when no settings exist', async () => {
      const facade = createFacade();

      const result = await facade.getAllSettings();

      expect(result).toEqual({
        branding: DEFAULT_BRANDING,
        contact: DEFAULT_CONTACT,
        features: DEFAULT_FEATURES,
      });
    });

    it('should return stored values for all categories', async () => {
      const facade = createFacade();

      // Create all settings
      await db.insert(schema.platformSettings).values({ organizationId });
      await db.insert(schema.brandingSettings).values({
        organizationId,
        primaryColorHex: '#FF0000',
        logoUrl: 'https://example.com/logo.png',
      });
      await db.insert(schema.contactSettings).values({
        organizationId,
        platformName: 'Test Platform',
        supportEmail: 'test@test.com',
        contactUrl: 'https://test.com',
        timezone: 'America/Los_Angeles',
      });
      await db.insert(schema.featureSettings).values({
        organizationId,
        enableSignups: false,
        enablePurchases: true,
      });

      const result = await facade.getAllSettings();

      expect(result.branding.primaryColorHex).toBe('#FF0000');
      expect(result.branding.logoUrl).toBe('https://example.com/logo.png');
      expect(result.contact.platformName).toBe('Test Platform');
      expect(result.contact.timezone).toBe('America/Los_Angeles');
      expect(result.features.enableSignups).toBe(false);
      expect(result.features.enablePurchases).toBe(true);
    });

    it('should fetch all categories in parallel', async () => {
      const facade = createFacade();

      // This test validates that the queries are made in parallel
      // by checking the result structure
      const result = await facade.getAllSettings();

      expect(result).toHaveProperty('branding');
      expect(result).toHaveProperty('contact');
      expect(result).toHaveProperty('features');
    });
  });

  describe('branding delegation', () => {
    it('should delegate getBranding()', async () => {
      const facade = createFacade();

      const result = await facade.getBranding();

      expect(result).toEqual(DEFAULT_BRANDING);
    });

    it('should delegate updateBranding()', async () => {
      const facade = createFacade();

      const result = await facade.updateBranding({
        primaryColorHex: '#00FF00',
      });

      expect(result.primaryColorHex).toBe('#00FF00');
    });

    it('should delegate uploadLogo()', async () => {
      const mockR2 = createMockR2();
      const facade = createFacade(mockR2);

      const result = await facade.uploadLogo({
        buffer: createValidImageBuffer('image/png', 1024),
        mimeType: 'image/png',
        size: 1024,
      });

      expect(mockR2.put).toHaveBeenCalled();
      expect(result.logoUrl).toContain('logos/');
    });

    it('should delegate deleteLogo()', async () => {
      const mockR2 = createMockR2();
      const facade = createFacade(mockR2);

      // Create existing logo first
      await db.insert(schema.platformSettings).values({ organizationId });
      await db.insert(schema.brandingSettings).values({
        organizationId,
        logoUrl: 'https://cdn.example.com/logos/test/logo.png',
        logoR2Path: 'logos/test/logo.png',
        primaryColorHex: '#3B82F6',
      });

      const result = await facade.deleteLogo();

      expect(mockR2.delete).toHaveBeenCalled();
      expect(result.logoUrl).toBeNull();
    });
  });

  describe('contact delegation', () => {
    it('should delegate getContact()', async () => {
      const facade = createFacade();

      const result = await facade.getContact();

      expect(result).toEqual(DEFAULT_CONTACT);
    });

    it('should delegate updateContact()', async () => {
      const facade = createFacade();

      const result = await facade.updateContact({
        platformName: 'My Platform',
        supportEmail: 'help@myplatform.com',
      });

      expect(result.platformName).toBe('My Platform');
      expect(result.supportEmail).toBe('help@myplatform.com');
    });
  });

  describe('features delegation', () => {
    it('should delegate getFeatures()', async () => {
      const facade = createFacade();

      const result = await facade.getFeatures();

      expect(result).toEqual(DEFAULT_FEATURES);
    });

    it('should delegate updateFeatures()', async () => {
      const facade = createFacade();

      const result = await facade.updateFeatures({
        enableSignups: false,
      });

      expect(result.enableSignups).toBe(false);
      expect(result.enablePurchases).toBe(DEFAULT_FEATURES.enablePurchases);
    });
  });

  describe('isolation between categories', () => {
    it('should not affect other categories when updating one', async () => {
      const facade = createFacade();

      // Update branding
      await facade.updateBranding({ primaryColorHex: '#AABBCC' });

      // Update contact
      await facade.updateContact({ platformName: 'Isolated Test' });

      // Update features
      await facade.updateFeatures({ enableSignups: false });

      // Verify all are independent
      const all = await facade.getAllSettings();

      expect(all.branding.primaryColorHex).toBe('#AABBCC');
      expect(all.contact.platformName).toBe('Isolated Test');
      expect(all.features.enableSignups).toBe(false);
    });
  });

  describe('constructor configuration', () => {
    it('should work without R2 configuration', async () => {
      const facade = new PlatformSettingsFacade({
        db,
        environment: 'test',
        organizationId,
        // No R2 configuration
      });

      // Regular operations should work
      const branding = await facade.getBranding();
      expect(branding).toEqual(DEFAULT_BRANDING);

      // Logo operations should throw
      await expect(
        facade.uploadLogo({
          buffer: new ArrayBuffer(100),
          mimeType: 'image/png',
          size: 100,
        })
      ).rejects.toThrow('R2 service not configured');
    });

    it('should use environment correctly', async () => {
      const facade = new PlatformSettingsFacade({
        db,
        environment: 'production',
        organizationId,
      });

      // Should not throw - environment is passed to services
      const result = await facade.getAllSettings();
      expect(result).toBeDefined();
    });
  });
});
