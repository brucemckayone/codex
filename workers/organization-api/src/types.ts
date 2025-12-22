/**
 * Organization API Worker Types
 *
 * Extends shared HonoEnv with worker-specific context variables.
 */

import type { Database, DatabaseWs } from '@codex/database';
import type { PlatformSettingsFacade } from '@codex/platform-settings';
import type { HonoEnv as BaseHonoEnv } from '@codex/shared-types';

/**
 * Extended Variables for Organization API Worker
 *
 * Adds worker-specific context variables set by middleware:
 * - settingsFacade: Auto-injected PlatformSettingsFacade for settings routes
 * - db: Database client (for advanced use cases requiring manual queries)
 */
export type OrganizationApiVariables = BaseHonoEnv['Variables'] & {
  /**
   * PlatformSettingsFacade instance with automatic cleanup
   * Set by withSettingsFacade() middleware
   */
  settingsFacade?: PlatformSettingsFacade;

  /**
   * Database client (HTTP or WebSocket)
   * Set by withSettingsFacade() middleware
   */
  db?: Database | DatabaseWs;
};

/**
 * Extended HonoEnv for Organization API Worker
 *
 * Combines base bindings with extended variables.
 */
export type HonoEnv = {
  Bindings: BaseHonoEnv['Bindings'];
  Variables: OrganizationApiVariables;
};
