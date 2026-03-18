/**
 * Unified fixture exports for e2e tests
 */

import { authFixture, httpClient } from '@codex/test-utils/e2e';

// Re-export http client for direct API calls in tests
export { httpClient };
export { adminFixture } from './admin.fixture';
export { authFixture };
export type { DatabaseFixture } from './database.fixture';
export {
  setupDatabaseFixture,
  teardownDatabaseFixture,
} from './database.fixture';
export type {
  AllSettings,
  BrandingSettings,
  ContactSettings,
  FeatureSettings,
} from './settings.fixture';
export { settingsFixture } from './settings.fixture';
