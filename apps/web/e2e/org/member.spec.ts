import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';

/**
 * Organization Member E2E Tests
 *
 * Demonstrates usage of org member fixtures for testing role-based
 * access control in organization-scoped features.
 *
 * These tests create users with specific organization roles using
 * the createOrgMember and createOrgWithMembers fixtures.
 *
 * Valid roles (from database schema):
 * - 'owner' - Organization creator, full control
 * - 'admin' - Administrative access, can manage members
 * - 'creator' - Can publish content to the organization
 * - 'member' - Basic member access
 * - 'subscriber' - Paid subscriber access to org content
 */

test.describe('Organization Member - Fixtures', () => {
  test('org member can be created with specific role', async ({
    createOrgMember,
  }) => {
    // Use timestamp to ensure unique email
    const timestamp = Date.now();
    const admin = await createOrgMember({
      email: `admin-org-${timestamp}@test.com`,
      password: 'Test123!@#',
      orgRole: 'admin',
      orgName: `Test Organization ${timestamp}`,
      orgSlug: `test-org-${timestamp}`,
    });

    // Verify the context has all expected properties
    expect(admin.user).toBeDefined();
    expect(admin.user.email).toContain(`admin-org-${timestamp}`);
    expect(admin.organization).toBeDefined();
    expect(admin.organization.slug).toContain(`test-org-${timestamp}`);
    expect(admin.orgRole).toBe('admin');
    // BetterAuth uses better-auth.session_token format
    expect(admin.cookie).toContain('better-auth.session_token');
  });

  test('can create multiple members with different roles in same org', async ({
    createOrgWithMembers,
    getMemberByRole,
  }) => {
    const timestamp = Date.now();
    const { memberContexts } = await createOrgWithMembers(
      {
        name: `Multi-Role Org ${timestamp}`,
        slug: `multi-role-org-${timestamp}`,
      },
      [
        {
          email: `owner-${timestamp}@test.com`,
          password: 'Test123!',
          role: 'owner',
        },
        {
          email: `admin-${timestamp}@test.com`,
          password: 'Test123!',
          role: 'admin',
        },
        {
          email: `creator-${timestamp}@test.com`,
          password: 'Test123!',
          role: 'creator',
        },
        {
          email: `member-${timestamp}@test.com`,
          password: 'Test123!',
          role: 'member',
        },
      ]
    );

    // Verify all members were created
    expect(memberContexts).toHaveLength(4);

    // Verify we can find members by role
    const owner = getMemberByRole(memberContexts, 'owner');
    const admin = getMemberByRole(memberContexts, 'admin');
    const creator = getMemberByRole(memberContexts, 'creator');
    const member = getMemberByRole(memberContexts, 'member');

    expect(owner?.orgRole).toBe('owner');
    expect(admin?.orgRole).toBe('admin');
    expect(creator?.orgRole).toBe('creator');
    expect(member?.orgRole).toBe('member');

    // All members share the same organization
    expect(owner?.organization.id).toBe(admin?.organization.id);
    expect(owner?.organization.id).toBe(creator?.organization.id);
    expect(owner?.organization.id).toBe(member?.organization.id);
  });

  test('can add member to existing organization', async ({
    createOrgMember,
  }) => {
    const timestamp = Date.now();
    // Create first org and owner
    const orgOwner = await createOrgMember({
      email: `org-owner-${timestamp}@test.com`,
      password: 'Test123!@#',
      orgRole: 'owner',
      orgName: `Existing Org ${timestamp}`,
      orgSlug: `existing-org-${timestamp}`,
    });

    // Add a new member to the same organization
    const newMember = await createOrgMember({
      email: `new-member-${timestamp}@test.com`,
      password: 'Test123!@#',
      orgRole: 'member',
      organization: orgOwner.organization, // Use existing org
    });

    // Verify both users are in the same org
    expect(newMember.organization.id).toBe(orgOwner.organization.id);
    expect(newMember.organization.slug).toContain(`existing-org-${timestamp}`);
    expect(newMember.orgRole).toBe('member');
  });

  test('subscriber role is supported', async ({ createOrgMember }) => {
    const timestamp = Date.now();
    const subscriber = await createOrgMember({
      email: `subscriber-${timestamp}@test.com`,
      password: 'Test123!@#',
      orgRole: 'subscriber',
      orgName: `Content Org ${timestamp}`,
      orgSlug: `content-org-${timestamp}`,
    });

    expect(subscriber.orgRole).toBe('subscriber');
    expect(subscriber.user.email).toContain(`subscriber-${timestamp}`);
  });
});

test.describe('Organization Page - With Authenticated Member', () => {
  test('authenticated org member can access organization page', async ({
    page,
    createOrgMember,
  }) => {
    const timestamp = Date.now();
    // Create org member
    const member = await createOrgMember({
      email: `member-access-${timestamp}@test.com`,
      password: 'Test123!@#',
      orgRole: 'member',
      orgName: `Access Test Org ${timestamp}`,
      orgSlug: `access-test-org-${timestamp}`,
    });

    // The cookie string contains both session_token and session_data
    // We need to parse them and add both cookies
    const cookieParts = member.cookie.split('; ').map((part) => {
      const [name, value] = part.split('=');
      return { name, value };
    });

    // Add each cookie separately
    for (const cookie of cookieParts) {
      if (cookie.name && cookie.value) {
        await page.context().addCookies([
          {
            name: cookie.name,
            value: cookie.value,
            domain: 'localhost',
            path: '/',
            httpOnly: true,
            secure: false,
            sameSite: 'Lax' as 'Lax',
          },
        ]);
      }
    }

    // Navigate to organization page
    await page.goto(`/org/${member.organization.slug}`);

    // Page should load (specific assertions depend on page implementation)
    await expect(page).toHaveTitle(/Codex/i);
  });

  test('can use createOrgWithMembers for complex scenarios', async ({
    createOrgWithMembers,
  }) => {
    const timestamp = Date.now();
    // Create a content team with different roles
    const { organization, memberContexts } = await createOrgWithMembers(
      { name: `Content Team ${timestamp}`, slug: `content-team-${timestamp}` },
      [
        {
          email: `lead-${timestamp}@test.com`,
          password: 'Test123!',
          role: 'owner',
        },
        {
          email: `editor-${timestamp}@test.com`,
          password: 'Test123!',
          role: 'admin',
        },
        {
          email: `writer-${timestamp}@test.com`,
          password: 'Test123!',
          role: 'creator',
        },
      ]
    );

    // Verify setup
    expect(memberContexts).toHaveLength(3);
    expect(organization.slug).toContain(`content-team-${timestamp}`);

    // First member should be owner
    expect(memberContexts[0].orgRole).toBe('owner');
  });
});
