/**
 * Organization and Member Fixtures for E2E Tests
 *
 * Provides shared logic for creating organizations and member contexts
 * across different E2E test suites (web, API, etc.)
 */

import { dbHttp, schema } from '@codex/database';
import type { OrgMemberContext, OrgMemberRole } from '@codex/shared-types';
import { authFixture } from './auth.fixture';

export interface CreateOrgMemberOptions {
  email: string;
  password: string;
  name?: string;
  orgRole: OrgMemberRole;
  organization?: {
    id: string;
    name: string;
    slug: string;
  };
  orgName?: string;
  orgSlug?: string;
}

export interface CreateOrgMemberWithAuthOptions {
  email: string;
  password: string;
  name?: string;
  role: OrgMemberRole;
}

export interface OrganizationConfig {
  name: string;
  slug: string;
}

export const orgFixture = {
  /**
   * Create a user with a specific role in an organization
   *
   * 1. Registers user via auth worker
   * 2. Creates organization (or uses existing)
   * 3. Creates organization membership with specified role
   */
  async createOrgMember(
    data: CreateOrgMemberOptions
  ): Promise<OrgMemberContext> {
    // Step 1: Register user via auth worker
    const registeredUser = await authFixture.registerUser({
      email: data.email,
      password: data.password,
      name: data.name ?? data.email.split('@')[0],
      role: 'customer', // Default user role
    });

    // Step 2: Get or create organization
    let organization = data.organization;

    if (!organization) {
      const [org] = await dbHttp
        .insert(schema.organizations)
        .values({
          name: data.orgName ?? `Test Org ${Date.now()}`,
          slug: data.orgSlug ?? `test-org-${Date.now()}`,
          description: 'E2E Test Organization',
        })
        .returning();
      organization = org;
    }

    if (!organization) {
      throw new Error('Failed to create or resolve organization');
    }

    // Step 3: Create organization membership with specified role
    await dbHttp.insert(schema.organizationMemberships).values({
      organizationId: organization.id,
      userId: registeredUser.user.id,
      role: data.orgRole,
      status: 'active',
      invitedBy: registeredUser.user.id, // Self-invited for test
    });

    return {
      user: {
        id: registeredUser.user.id,
        email: registeredUser.user.email,
        name: registeredUser.user.name ?? '',
        role: registeredUser.user.role,
      },
      session: {
        id: registeredUser.session.id,
        userId: registeredUser.session.userId,
        token: registeredUser.session.token ?? '',
        expiresAt:
          typeof registeredUser.session.expiresAt === 'string'
            ? registeredUser.session.expiresAt
            : (registeredUser.session.expiresAt as Date).toISOString(),
      },
      cookie: registeredUser.cookie,
      organization,
      orgRole: data.orgRole,
    };
  },

  /**
   * Create multiple users with different roles in the same organization
   * Useful for testing role-based access control
   */
  async createOrgWithMembers(
    orgConfig: OrganizationConfig,
    members: CreateOrgMemberWithAuthOptions[]
  ): Promise<{
    organization: OrgMemberContext['organization'];
    memberContexts: OrgMemberContext[];
  }> {
    if (members.length === 0) {
      throw new Error('At least one member must be provided');
    }

    // Create org with first member as owner (or override role if specified)
    const [firstMember, ...otherMembers] = members;
    if (!firstMember) {
      throw new Error('First member is undefined.');
    }

    const ownerContext = await orgFixture.createOrgMember({
      email: firstMember.email,
      password: firstMember.password,
      name: firstMember.name,
      orgRole:
        firstMember.role === 'subscriber' || firstMember.role === 'member'
          ? 'owner' // First member must be owner
          : (firstMember.role as 'owner' | 'admin' | 'creator'),
      orgName: orgConfig.name,
      orgSlug: orgConfig.slug,
    });

    const memberContexts: OrgMemberContext[] = [ownerContext];

    // Add other members
    for (const member of otherMembers) {
      const context = await orgFixture.createOrgMember({
        email: member.email,
        password: member.password,
        name: member.name,
        orgRole: member.role,
        organization: ownerContext.organization,
      });
      memberContexts.push(context);
    }

    return {
      organization: ownerContext.organization,
      memberContexts,
    };
  },

  /**
   * Helper for tests that need to find a specific role
   */
  getMemberByRole(
    members: OrgMemberContext[],
    role: OrgMemberRole
  ): OrgMemberContext | undefined {
    return members.find((m) => m.orgRole === role);
  },
};
