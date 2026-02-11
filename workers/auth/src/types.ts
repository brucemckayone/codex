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

  /**
   * Resend API key for production email delivery
   * Set via `wrangler secret put RESEND_API_KEY`
   */
  RESEND_API_KEY?: string;

  /**
   * Sender email address for transactional emails
   */
  FROM_EMAIL?: string;

  /**
   * Sender display name for transactional emails
   */
  FROM_NAME?: string;

  /**
   * When "true", uses ConsoleProvider instead of Resend
   */
  USE_MOCK_EMAIL?: string;
};

/**
 * Auth Worker Environment
 */
export type AuthEnv = {
  Bindings: AuthBindings;
  Variables: Variables;
};
