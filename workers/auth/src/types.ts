/**
 * Auth Worker Types
 *
 * Type definitions specific to the auth worker.
 * Extends shared types with auth-specific bindings.
 */

import type {
  Bindings as SharedBindings,
  Variables,
} from '@codex/shared-types';

/**
 * Auth Worker Bindings
 * Extends shared bindings with auth-specific environment variables
 */
export type AuthBindings = SharedBindings & {
  /**
   * Session secret for secure cookie signing
   */
  SESSION_SECRET?: string;

  /**
   * BetterAuth secret for authentication operations
   */
  BETTER_AUTH_SECRET?: string;

  /**
   * KV namespace for session caching
   */
  AUTH_SESSION_KV: KVNamespace;
};

/**
 * Auth Worker Environment
 */
export type AuthEnv = {
  Bindings: AuthBindings;
  Variables: Variables;
};
