/**
 * Admin API Worker Types
 *
 * Type definitions for the admin-api worker environment and context.
 */

import type { HonoEnv } from '@codex/shared-types';

/**
 * Admin API worker environment extends the base HonoEnv.
 * Inherits all standard bindings and variables.
 */
export type AdminApiEnv = HonoEnv;
