/**
 * Database domain constants
 */

export const DB_METHODS = {
  LOCAL_PROXY: 'LOCAL_PROXY',
  NEON_BRANCH: 'NEON_BRANCH',
  PRODUCTION: 'PRODUCTION',
} as const;

export const DATABASE_DIALECT = 'postgresql';

export const POSTGRES_ERROR_CODES = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  NOT_NULL_VIOLATION: '23502',
  CHECK_VIOLATION: '23514',
} as const;

export const ORGANIZATION_ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  CREATOR: 'creator',
  SUBSCRIBER: 'subscriber',
  MEMBER: 'member',
} as const;

/**
 * The org's team: the roles that make and run its catalogue. `subscriber`
 * and `member` are its audience. Read with an active membership: re-joining
 * as an audience member reactivates a departed creator's row with an
 * audience role, so status alone never proves someone is on the team.
 */
export const ORGANIZATION_TEAM_ROLES: readonly string[] = [
  ORGANIZATION_ROLES.OWNER,
  ORGANIZATION_ROLES.ADMIN,
  ORGANIZATION_ROLES.CREATOR,
];

export const ORGANIZATION_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  INVITED: 'invited',
} as const;
