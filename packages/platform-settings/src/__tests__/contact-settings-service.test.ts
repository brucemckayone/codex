/**
 * Contact Settings Service Tests
 *
 * Tests for ContactSettingsService covering:
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
import { DEFAULT_CONTACT } from '@codex/validation';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ContactSettingsService } from '../services/contact-settings-service';

describe('ContactSettingsService', () => {
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
      .delete(schema.contactSettings)
      .where(eq(schema.contactSettings.organizationId, organizationId));
    await db
      .delete(schema.platformSettings)
      .where(eq(schema.platformSettings.organizationId, organizationId));
  });

  function createService() {
    return new ContactSettingsService({
      db,
      environment: 'test',
      organizationId,
    });
  }

  describe('get()', () => {
    it('should return defaults when no contact settings exist', async () => {
      const service = createService();

      const result = await service.get();

      expect(result).toEqual(DEFAULT_CONTACT);
    });

    it('should return stored values when contact settings exist', async () => {
      const service = createService();

      // Create platform settings hub row
      await db.insert(schema.platformSettings).values({
        organizationId,
      });

      // Insert contact settings
      await db.insert(schema.contactSettings).values({
        organizationId,
        platformName: 'My Platform',
        supportEmail: 'help@myplatform.com',
        contactUrl: 'https://myplatform.com/contact',
        timezone: 'America/New_York',
      });

      const result = await service.get();

      expect(result.platformName).toBe('My Platform');
      expect(result.supportEmail).toBe('help@myplatform.com');
      expect(result.contactUrl).toBe('https://myplatform.com/contact');
      expect(result.timezone).toBe('America/New_York');
    });

    it('should return null contactUrl when not set', async () => {
      const service = createService();

      await db.insert(schema.platformSettings).values({ organizationId });
      await db.insert(schema.contactSettings).values({
        organizationId,
        platformName: 'Test',
        supportEmail: 'test@test.com',
        contactUrl: null,
        timezone: 'UTC',
      });

      const result = await service.get();

      expect(result.contactUrl).toBeNull();
    });
  });

  describe('update()', () => {
    it('should create contact settings via upsert when none exist', async () => {
      const service = createService();

      const result = await service.update({
        platformName: 'New Platform',
        supportEmail: 'support@new.com',
      });

      expect(result.platformName).toBe('New Platform');
      expect(result.supportEmail).toBe('support@new.com');
      expect(result.contactUrl).toBe(DEFAULT_CONTACT.contactUrl);
      expect(result.timezone).toBe(DEFAULT_CONTACT.timezone);

      // Verify database state
      const [dbRow] = await db
        .select()
        .from(schema.contactSettings)
        .where(eq(schema.contactSettings.organizationId, organizationId));
      expect(dbRow.platformName).toBe('New Platform');
    });

    it('should update existing contact settings', async () => {
      const service = createService();

      // Create initial settings
      await db.insert(schema.platformSettings).values({ organizationId });
      await db.insert(schema.contactSettings).values({
        organizationId,
        platformName: 'Old Platform',
        supportEmail: 'old@old.com',
        contactUrl: null,
        timezone: 'UTC',
      });

      // Update
      const result = await service.update({
        platformName: 'Updated Platform',
        timezone: 'Europe/London',
      });

      expect(result.platformName).toBe('Updated Platform');
      expect(result.timezone).toBe('Europe/London');
      // Email should remain unchanged
      expect(result.supportEmail).toBe('old@old.com');
    });

    it('should handle partial updates correctly', async () => {
      const service = createService();

      // Create initial settings with all fields
      await db.insert(schema.platformSettings).values({ organizationId });
      await db.insert(schema.contactSettings).values({
        organizationId,
        platformName: 'My Platform',
        supportEmail: 'support@platform.com',
        contactUrl: 'https://contact.com',
        timezone: 'America/Chicago',
      });

      // Update only one field
      const result = await service.update({
        supportEmail: 'new-support@platform.com',
      });

      expect(result.platformName).toBe('My Platform');
      expect(result.supportEmail).toBe('new-support@platform.com');
      expect(result.contactUrl).toBe('https://contact.com');
      expect(result.timezone).toBe('America/Chicago');
    });

    it('should return current state when no updates provided', async () => {
      const service = createService();

      // Create initial settings
      await db.insert(schema.platformSettings).values({ organizationId });
      await db.insert(schema.contactSettings).values({
        organizationId,
        platformName: 'Existing Platform',
        supportEmail: 'existing@platform.com',
        contactUrl: null,
        timezone: 'UTC',
      });

      // Update with empty object
      const result = await service.update({});

      expect(result.platformName).toBe('Existing Platform');
      expect(result.supportEmail).toBe('existing@platform.com');
    });

    it('should allow setting contactUrl to null', async () => {
      const service = createService();

      // Create initial settings with contactUrl
      await db.insert(schema.platformSettings).values({ organizationId });
      await db.insert(schema.contactSettings).values({
        organizationId,
        platformName: 'Test',
        supportEmail: 'test@test.com',
        contactUrl: 'https://contact.com',
        timezone: 'UTC',
      });

      // Update to null
      const result = await service.update({ contactUrl: null });

      expect(result.contactUrl).toBeNull();
    });

    it('should create platform settings hub row if not exists', async () => {
      const service = createService();

      await service.update({ platformName: 'New Name' });

      // Verify hub row exists
      const [hubRow] = await db
        .select()
        .from(schema.platformSettings)
        .where(eq(schema.platformSettings.organizationId, organizationId));
      expect(hubRow).toBeDefined();
    });

    it('should update all fields at once', async () => {
      const service = createService();

      const result = await service.update({
        platformName: 'Complete Platform',
        supportEmail: 'complete@platform.com',
        contactUrl: 'https://complete.com/contact',
        timezone: 'Asia/Tokyo',
      });

      expect(result.platformName).toBe('Complete Platform');
      expect(result.supportEmail).toBe('complete@platform.com');
      expect(result.contactUrl).toBe('https://complete.com/contact');
      expect(result.timezone).toBe('Asia/Tokyo');
    });
  });
});
