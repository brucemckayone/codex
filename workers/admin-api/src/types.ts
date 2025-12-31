/**
 * Admin API Worker Types
 *
 * Type definitions for the admin-api worker environment and context.
 */

import type { DatabaseWs } from '@codex/database';
import type { Bindings, Variables } from '@codex/shared-types';

/**
 * Extended Variables for admin-api that includes organizationId
 * cached after platform owner authentication.
 */
export interface AdminVariables extends Variables {
  /** Platform owner's organization ID, set by middleware */
  organizationId: string;
  /** Per-request database client for transaction support, set by withPerRequestDb middleware */
  perRequestDb?: DatabaseWs;
}

/**
 * Admin API worker environment extends the base HonoEnv with AdminVariables.
 */
export type AdminApiEnv = {
  Bindings: Bindings;
  Variables: AdminVariables;
};
