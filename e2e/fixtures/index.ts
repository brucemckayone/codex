/**
 * Unified fixture exports for e2e tests
 */

// Re-export http client for direct API calls in tests
export { httpClient } from '../helpers/http-client';
export { adminFixture } from './admin.fixture';
export { authFixture } from './auth.fixture';
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
