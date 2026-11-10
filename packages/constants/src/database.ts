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
  /** A lock wait ran past `lock_timeout` (or a NOWAIT lock was taken). */
  LOCK_NOT_AVAILABLE: '55P03',
} as const;

export const ORGANIZATION_ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  CREATOR: 'creator',
  SUBSCRIBER: 'subscriber',
  MEMBER: 'member',
} as const;

/**
 * Every role except `subscriber`: the people an owner or admin put on the
 * org's Team page (owner, admin, creator, member). A paying subscriber holds
 * an ACTIVE membership too (role `subscriber`), so a check that means "on
 * the Team page" must filter by these roles, never by status alone. Email
 * templates use this set (Codex-tgkgb, owner decision 2026-11-09). So does a
 * subscription, which never downgrades these roles to `subscriber`
 * (`upsertSubscriberMembership`).
 *
 * NOT the access set. A `member` still pays for content. Gates that let a
 * role in without paying use `ORGANIZATION_TEAM_ROLES` (owner, admin,
 * creator).
 */
export const ORGANIZATION_NON_SUBSCRIBER_ROLES = [
  ORGANIZATION_ROLES.OWNER,
  ORGANIZATION_ROLES.ADMIN,
  ORGANIZATION_ROLES.CREATOR,
  ORGANIZATION_ROLES.MEMBER,
] as const;

export const ORGANIZATION_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  INVITED: 'invited',
} as const;
