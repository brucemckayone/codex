/**
 * Organization and Membership Types
 *
 * Shared types for organization members, roles, and contexts.
 * Used across identity services, API workers, and E2E fixtures.
 */

/**
 * Valid roles for organization members
 * Aligns with organizationMembers.role column CHECK constraint in database.
 */
export type OrgMemberRole =
  | 'owner'
  | 'admin'
  | 'creator'
  | 'member'
  | 'subscriber';

/**
 * Context for an organization member in E2E tests
 * Includes user data, session data, and organization association.
 */
export interface OrgMemberContext {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
  session: {
    id: string;
    userId: string;
    token: string;
    expiresAt: string;
  };
  cookie: string;
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  orgRole: OrgMemberRole;
}
