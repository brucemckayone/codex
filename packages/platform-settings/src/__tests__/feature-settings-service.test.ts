/**
 * Feature Settings Service Tests
 *
 * Tests for FeatureSettingsService covering:
 * - get() returns defaults when no row exists
 * - get() returns stored values
 * - update() creates via upsert
 * - update() partial updates work
 */

import { schema } from '@codex/database';
import {
  type Database,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { DEFAULT_FEATURES } from '@codex/validation';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FeatureSettingsService } from '../services/feature-settings-service';

describe('FeatureSettingsService', () => {
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
    // Clean up settings tables before each test
    await db
      .delete(schema.featureSettings)
      .where(eq(schema.featureSettings.organizationId, organizationId));
    await db
      .delete(schema.platformSettings)
      .where(eq(schema.platformSettings.organizationId, organizationId));
  });

  function createService() {
    return new FeatureSettingsService({
      db,
      environment: 'test',
      organizationId,
    });
  }

  describe('get()', () => {
    it('should return defaults when no feature settings exist', async () => {
      const service = createService();

      const result = await service.get();

      expect(result).toEqual(DEFAULT_FEATURES);
    });

    it('should return stored values when feature settings exist', async () => {
      const service = createService();

      // Create platform settings hub row
      await db.insert(schema.platformSettings).values({
        organizationId,
      });

      // Insert feature settings
      await db.insert(schema.featureSettings).values({
        organizationId,
        enableSignups: false,
        enablePurchases: false,
      });

      const result = await service.get();

      expect(result.enableSignups).toBe(false);
      expect(result.enablePurchases).toBe(false);
    });

    it('should return mixed values correctly', async () => {
      const service = createService();

      await db.insert(schema.platformSettings).values({ organizationId });
      await db.insert(schema.featureSettings).values({
        organizationId,
        enableSignups: true,
        enablePurchases: false,
      });

      const result = await service.get();

      expect(result.enableSignups).toBe(true);
      expect(result.enablePurchases).toBe(false);
    });
  });

  describe('update()', () => {
    it('should create feature settings via upsert when none exist', async () => {
      const service = createService();

      const result = await service.update({
        enableSignups: false,
      });

      expect(result.enableSignups).toBe(false);
      expect(result.enablePurchases).toBe(DEFAULT_FEATURES.enablePurchases);

      // Verify database state
      const [dbRow] = await db
        .select()
        .from(schema.featureSettings)
        .where(eq(schema.featureSettings.organizationId, organizationId));
      expect(dbRow.enableSignups).toBe(false);
    });

    it('should update existing feature settings', async () => {
      const service = createService();

      // Create initial settings
      await db.insert(schema.platformSettings).values({ organizationId });
      await db.insert(schema.featureSettings).values({
        organizationId,
        enableSignups: true,
        enablePurchases: true,
      });

      // Update
      const result = await service.update({
        enableSignups: false,
      });

      expect(result.enableSignups).toBe(false);
      // enablePurchases should remain unchanged
      expect(result.enablePurchases).toBe(true);
    });

    it('should handle partial updates correctly', async () => {
      const service = createService();

      // Create initial settings
      await db.insert(schema.platformSettings).values({ organizationId });
      await db.insert(schema.featureSettings).values({
        organizationId,
        enableSignups: false,
        enablePurchases: false,
      });

      // Update only one field
      const result = await service.update({
        enablePurchases: true,
      });

      expect(result.enableSignups).toBe(false);
      expect(result.enablePurchases).toBe(true);
    });

    it('should return current state when no updates provided', async () => {
      const service = createService();

      // Create initial settings
      await db.insert(schema.platformSettings).values({ organizationId });
      await db.insert(schema.featureSettings).values({
        organizationId,
        enableSignups: false,
        enablePurchases: true,
      });

      // Update with empty object
      const result = await service.update({});

      expect(result.enableSignups).toBe(false);
      expect(result.enablePurchases).toBe(true);
    });

    it('should create platform settings hub row if not exists', async () => {
      const service = createService();

      await service.update({ enableSignups: false });

      // Verify hub row exists
      const [hubRow] = await db
        .select()
        .from(schema.platformSettings)
        .where(eq(schema.platformSettings.organizationId, organizationId));
      expect(hubRow).toBeDefined();
    });

    it('should update both fields at once', async () => {
      const service = createService();

      const result = await service.update({
        enableSignups: false,
        enablePurchases: false,
      });

      expect(result.enableSignups).toBe(false);
      expect(result.enablePurchases).toBe(false);
    });

    it('should toggle features on and off', async () => {
      const service = createService();

      // Start with defaults (both true)
      let result = await service.update({
        enableSignups: false,
        enablePurchases: false,
      });
      expect(result.enableSignups).toBe(false);
      expect(result.enablePurchases).toBe(false);

      // Toggle back on
      result = await service.update({
        enableSignups: true,
        enablePurchases: true,
      });
      expect(result.enableSignups).toBe(true);
      expect(result.enablePurchases).toBe(true);
    });
  });
});
