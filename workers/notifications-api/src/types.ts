/**
 * Notifications API Worker Types
 *
 * Type definitions specific to the notifications-api worker.
 * Extends base types from @codex/shared-types.
 */

import type { HonoEnv } from '@codex/shared-types';

/**
 * Extended HonoEnv for notifications-api specific bindings and variables.
 * Currently uses base HonoEnv, will extend when notification-specific
 * bindings are added (e.g., email service credentials).
 */
export type NotificationsApiEnv = HonoEnv;
