/**
 * @codex/shared-types
 *
 * Shared TypeScript types for the Codex platform.
 * Provides common type definitions used across workers and services.
 */

// Worker types
export type {
  Bindings,
  Variables,
  SessionData,
  UserData,
  ErrorResponse,
  SuccessResponse,
  HonoEnv,
  AuthenticatedContext,
} from './worker-types';
