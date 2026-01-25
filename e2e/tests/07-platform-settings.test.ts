/**
 * E2E Test: Platform Settings
 *
 * Tests the complete platform settings functionality including:
 * 1. Authentication & Authorization (org owner required)
 * 2. Get default settings (branding, contact, features)
 * 3. Update branding settings (color)
 * 4. Update contact settings (platform name, email, timezone)
 * 5. Update feature toggles (signups, purchases)
 * 6. Logo upload and delete
 * 7. Organization scoping (isolation between orgs)
 *
 * All tests validate organization scoping to ensure data isolation.
 */

import { closeDbPool } from '@codex/database';
import { afterAll, describe, expect, test } from 'vitest';
import { adminFixture, httpClient, settingsFixture } from '../fixtures';
import { expectErrorResponse, expectForbidden } from '../helpers/assertions';
import { WORKER_URLS } from '../helpers/worker-urls';

describe('Platform Settings', () => {
  // ============================================================================
  // 1. Authentication & Authorization
  // ============================================================================

  describe('Authentication & Authorization', () => {
    test('should reject unauthenticated requests', async () => {
      // Call settings endpoint without cookie
      const response = await httpClient.get(
        `${WORKER_URLS.organization}/api/organizations/fake-org-id/settings`
      );

      expect(response.status).toBe(401);
      await expectErrorResponse(response, 'UNAUTHORIZED', 401);
    });

    test('should reject non-org-member users', { timeout: 60000 }, async () => {
      // Create org owner with their org
      const admin1 = await adminFixture.createOrgOwner({
        email: `admin1-settings-${Date.now()}@example.com`,
        password: 'SecurePassword123!',
        orgName: `Settings Org 1 ${Date.now()}`,
        orgSlug: `settings-org-1-${Date.now()}`,
      });

      // Create another org owner with different org (NOT platform_owner)
      // Regular org owners should NOT have cross-org access
      const admin2 = await adminFixture.createOrgOwner({
        email: `admin2-settings-${Date.now()}@example.com`,
        password: 'SecurePassword123!',
        orgName: `Settings Org 2 ${Date.now()}`,
        orgSlug: `settings-org-2-${Date.now()}`,
      });

      // Admin2 tries to access admin1's org settings - should fail with 403
      const response = await httpClient.get(
        `${WORKER_URLS.organization}/api/organizations/${admin1.organization.id}/settings`,
        {
          headers: { Cookie: admin2.cookie },
        }
      );

      expect(response.status).toBe(403);
      await expectForbidden(response);
    });

    test('should accept org owner', { timeout: 60000 }, async () => {
      const admin = await adminFixture.createPlatformOwner({
        email: `admin-accept-settings-${Date.now()}@example.com`,
        password: 'SecurePassword123!',
        orgName: `Accept Org ${Date.now()}`,
        orgSlug: `accept-org-${Date.now()}`,
      });

      // Access own org settings - should succeed
      const settings = await settingsFixture.getAllSettings(
        admin.cookie,
        admin.organization.id
      );

      expect(settings).toBeDefined();
      expect(settings.branding).toBeDefined();
      expect(settings.contact).toBeDefined();
      expect(settings.features).toBeDefined();
    });
  });

  // ============================================================================
  // 2. Default Settings
  // ============================================================================

  describe('Default Settings', () => {
    test(
      'should return branding defaults for new org',
      { timeout: 60000 },
      async () => {
        const admin = await adminFixture.createPlatformOwner({
          email: `admin-branding-default-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          orgName: `Branding Default Org ${Date.now()}`,
          orgSlug: `branding-default-${Date.now()}`,
        });

        const branding = await settingsFixture.getBranding(
          admin.cookie,
          admin.organization.id
        );

        expect(branding.logoUrl).toBeNull();
        expect(branding.primaryColorHex).toBe('#3B82F6');
      }
    );

    test(
      'should return contact defaults for new org',
      { timeout: 60000 },
      async () => {
        const admin = await adminFixture.createPlatformOwner({
          email: `admin-contact-default-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          orgName: `Contact Default Org ${Date.now()}`,
          orgSlug: `contact-default-${Date.now()}`,
        });

        const contact = await settingsFixture.getContact(
          admin.cookie,
          admin.organization.id
        );

        expect(contact.platformName).toBe('Codex Platform');
        expect(contact.supportEmail).toBe('support@example.com');
        expect(contact.contactUrl).toBeNull();
        expect(contact.timezone).toBe('UTC');
      }
    );

    test(
      'should return feature defaults for new org',
      { timeout: 60000 },
      async () => {
        const admin = await adminFixture.createPlatformOwner({
          email: `admin-feature-default-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          orgName: `Feature Default Org ${Date.now()}`,
          orgSlug: `feature-default-${Date.now()}`,
        });

        const features = await settingsFixture.getFeatures(
          admin.cookie,
          admin.organization.id
        );

        expect(features.enableSignups).toBe(true);
        expect(features.enablePurchases).toBe(true);
      }
    );

    test('should return all settings at once', { timeout: 60000 }, async () => {
      const admin = await adminFixture.createPlatformOwner({
        email: `admin-all-default-${Date.now()}@example.com`,
        password: 'SecurePassword123!',
        orgName: `All Default Org ${Date.now()}`,
        orgSlug: `all-default-${Date.now()}`,
      });

      const settings = await settingsFixture.getAllSettings(
        admin.cookie,
        admin.organization.id
      );

      // Branding defaults
      expect(settings.branding.logoUrl).toBeNull();
      expect(settings.branding.primaryColorHex).toBe('#3B82F6');

      // Contact defaults
      expect(settings.contact.platformName).toBe('Codex Platform');
      expect(settings.contact.supportEmail).toBe('support@example.com');
      expect(settings.contact.timezone).toBe('UTC');

      // Feature defaults
      expect(settings.features.enableSignups).toBe(true);
      expect(settings.features.enablePurchases).toBe(true);
    });
  });

  // ============================================================================
  // 3. Update Branding
  // ============================================================================

  describe('Update Branding', () => {
    test('should update primary color', { timeout: 60000 }, async () => {
      const admin = await adminFixture.createPlatformOwner({
        email: `admin-color-${Date.now()}@example.com`,
        password: 'SecurePassword123!',
        orgName: `Color Org ${Date.now()}`,
        orgSlug: `color-org-${Date.now()}`,
      });

      const updated = await settingsFixture.updateBranding(
        admin.cookie,
        admin.organization.id,
        { primaryColorHex: '#FF5733' }
      );

      expect(updated.primaryColorHex).toBe('#FF5733');

      // Verify persisted
      const branding = await settingsFixture.getBranding(
        admin.cookie,
        admin.organization.id
      );
      expect(branding.primaryColorHex).toBe('#FF5733');
    });

    test('should reject invalid hex color', { timeout: 60000 }, async () => {
      const admin = await adminFixture.createPlatformOwner({
        email: `admin-invalid-color-${Date.now()}@example.com`,
        password: 'SecurePassword123!',
        orgName: `Invalid Color Org ${Date.now()}`,
        orgSlug: `invalid-color-${Date.now()}`,
      });

      const response = await httpClient.put(
        settingsFixture.buildUrl(admin.organization.id, '/branding'),
        {
          headers: {
            Cookie: admin.cookie,
            Origin: WORKER_URLS.organization,
          },
          data: { primaryColorHex: 'not-a-hex' },
        }
      );

      expect(response.status).toBe(400);
    });
  });

  // ============================================================================
  // 4. Update Contact
  // ============================================================================

  describe('Update Contact', () => {
    test(
      'should update platform name and email',
      { timeout: 60000 },
      async () => {
        const admin = await adminFixture.createPlatformOwner({
          email: `admin-contact-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          orgName: `Contact Org ${Date.now()}`,
          orgSlug: `contact-org-${Date.now()}`,
        });

        const updated = await settingsFixture.updateContact(
          admin.cookie,
          admin.organization.id,
          {
            platformName: 'My Custom Platform',
            supportEmail: 'help@myplatform.com',
          }
        );

        expect(updated.platformName).toBe('My Custom Platform');
        expect(updated.supportEmail).toBe('help@myplatform.com');

        // Verify persisted
        const contact = await settingsFixture.getContact(
          admin.cookie,
          admin.organization.id
        );
        expect(contact.platformName).toBe('My Custom Platform');
        expect(contact.supportEmail).toBe('help@myplatform.com');
      }
    );

    test('should update timezone', { timeout: 60000 }, async () => {
      const admin = await adminFixture.createPlatformOwner({
        email: `admin-timezone-${Date.now()}@example.com`,
        password: 'SecurePassword123!',
        orgName: `Timezone Org ${Date.now()}`,
        orgSlug: `timezone-org-${Date.now()}`,
      });

      const updated = await settingsFixture.updateContact(
        admin.cookie,
        admin.organization.id,
        { timezone: 'America/New_York' }
      );

      expect(updated.timezone).toBe('America/New_York');
    });

    test('should set and clear contact URL', { timeout: 60000 }, async () => {
      const admin = await adminFixture.createPlatformOwner({
        email: `admin-contact-url-${Date.now()}@example.com`,
        password: 'SecurePassword123!',
        orgName: `Contact URL Org ${Date.now()}`,
        orgSlug: `contact-url-${Date.now()}`,
      });

      // Set contact URL
      const updated = await settingsFixture.updateContact(
        admin.cookie,
        admin.organization.id,
        { contactUrl: 'https://example.com/contact' }
      );

      expect(updated.contactUrl).toBe('https://example.com/contact');

      // Clear contact URL
      const cleared = await settingsFixture.updateContact(
        admin.cookie,
        admin.organization.id,
        { contactUrl: null }
      );

      expect(cleared.contactUrl).toBeNull();
    });
  });

  // ============================================================================
  // 5. Update Features
  // ============================================================================

  describe('Update Features', () => {
    test('should toggle signups off and on', { timeout: 60000 }, async () => {
      const admin = await adminFixture.createPlatformOwner({
        email: `admin-signups-${Date.now()}@example.com`,
        password: 'SecurePassword123!',
        orgName: `Signups Org ${Date.now()}`,
        orgSlug: `signups-org-${Date.now()}`,
      });

      // Disable signups
      const disabled = await settingsFixture.updateFeatures(
        admin.cookie,
        admin.organization.id,
        { enableSignups: false }
      );

      expect(disabled.enableSignups).toBe(false);

      // Re-enable signups
      const enabled = await settingsFixture.updateFeatures(
        admin.cookie,
        admin.organization.id,
        { enableSignups: true }
      );

      expect(enabled.enableSignups).toBe(true);
    });

    test('should toggle purchases off and on', { timeout: 60000 }, async () => {
      const admin = await adminFixture.createPlatformOwner({
        email: `admin-purchases-${Date.now()}@example.com`,
        password: 'SecurePassword123!',
        orgName: `Purchases Org ${Date.now()}`,
        orgSlug: `purchases-org-${Date.now()}`,
      });

      // Disable purchases
      const disabled = await settingsFixture.updateFeatures(
        admin.cookie,
        admin.organization.id,
        { enablePurchases: false }
      );

      expect(disabled.enablePurchases).toBe(false);

      // Re-enable purchases
      const enabled = await settingsFixture.updateFeatures(
        admin.cookie,
        admin.organization.id,
        { enablePurchases: true }
      );

      expect(enabled.enablePurchases).toBe(true);
    });

    test(
      'should update both feature toggles at once',
      { timeout: 60000 },
      async () => {
        const admin = await adminFixture.createPlatformOwner({
          email: `admin-both-features-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          orgName: `Both Features Org ${Date.now()}`,
          orgSlug: `both-features-${Date.now()}`,
        });

        const updated = await settingsFixture.updateFeatures(
          admin.cookie,
          admin.organization.id,
          { enableSignups: false, enablePurchases: false }
        );

        expect(updated.enableSignups).toBe(false);
        expect(updated.enablePurchases).toBe(false);
      }
    );
  });

  // ============================================================================
  // 6. Organization Scoping
  // ============================================================================

  describe('Organization Scoping', () => {
    test(
      'should isolate settings between organizations',
      { timeout: 120000 },
      async () => {
        // Create two orgs
        const admin1 = await adminFixture.createPlatformOwner({
          email: `admin1-scope-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          orgName: `Scope Org 1 ${Date.now()}`,
          orgSlug: `scope-org-1-${Date.now()}`,
        });

        const admin2 = await adminFixture.createPlatformOwner({
          email: `admin2-scope-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          orgName: `Scope Org 2 ${Date.now()}`,
          orgSlug: `scope-org-2-${Date.now()}`,
        });

        // Update admin1's settings
        await settingsFixture.updateBranding(
          admin1.cookie,
          admin1.organization.id,
          { primaryColorHex: '#111111' }
        );

        await settingsFixture.updateContact(
          admin1.cookie,
          admin1.organization.id,
          { platformName: 'Org One Platform' }
        );

        // Update admin2's settings differently
        await settingsFixture.updateBranding(
          admin2.cookie,
          admin2.organization.id,
          { primaryColorHex: '#222222' }
        );

        await settingsFixture.updateContact(
          admin2.cookie,
          admin2.organization.id,
          { platformName: 'Org Two Platform' }
        );

        // Verify each org sees only their own settings
        const settings1 = await settingsFixture.getAllSettings(
          admin1.cookie,
          admin1.organization.id
        );

        expect(settings1.branding.primaryColorHex).toBe('#111111');
        expect(settings1.contact.platformName).toBe('Org One Platform');

        const settings2 = await settingsFixture.getAllSettings(
          admin2.cookie,
          admin2.organization.id
        );

        expect(settings2.branding.primaryColorHex).toBe('#222222');
        expect(settings2.contact.platformName).toBe('Org Two Platform');
      }
    );

    test(
      'should prevent cross-org settings modification',
      { timeout: 120000 },
      async () => {
        // Create two regular org owners (NOT platform_owner)
        // Regular org owners should NOT have cross-org access
        const admin1 = await adminFixture.createOrgOwner({
          email: `admin1-crossmod-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          orgName: `CrossMod Org 1 ${Date.now()}`,
          orgSlug: `crossmod-org-1-${Date.now()}`,
        });

        const admin2 = await adminFixture.createOrgOwner({
          email: `admin2-crossmod-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          orgName: `CrossMod Org 2 ${Date.now()}`,
          orgSlug: `crossmod-org-2-${Date.now()}`,
        });

        // Admin2 tries to update admin1's branding - should fail
        const response = await httpClient.put(
          settingsFixture.buildUrl(admin1.organization.id, '/branding'),
          {
            headers: {
              Cookie: admin2.cookie,
              Origin: WORKER_URLS.organization,
            },
            data: { primaryColorHex: '#FFFFFF' },
          }
        );

        expect(response.status).toBe(403);
      }
    );
  });

  afterAll(async () => {
    await closeDbPool();
  });
});
