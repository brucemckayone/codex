/**
 * E2E Test Types
 * Re-exports shared types and defines minimal e2e-specific types
 */

export type { User } from '@codex/database';
// Re-export existing types from shared packages
export type {
  ErrorResponse,
  PaginatedListResponse,
  SessionData,
  SingleItemResponse,
  UserData,
} from '@codex/shared-types';

/**
 * Registered user with session cookie (e2e-specific)
 * Combines auth response with extracted cookie for subsequent requests
 */
export interface RegisteredUser {
  user: UserData;
  session: SessionData;
  cookie: string; // Extracted session cookie for subsequent requests
}
