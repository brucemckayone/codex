/**
 * Worker URLs for E2E tests.
 *
 * Re-exports from @codex/constants to maintain single source of truth for worker ports.
 * All workers use localhost URLs for local E2E testing.
 *
 * @module e2e/helpers/worker-urls
 */

import { getServiceUrl } from '@codex/constants';

/**
 * Worker URLs for E2E testing.
 * All URLs derived from @codex/constants SERVICE_PORTS.
 */
export const WORKER_URLS = {
  auth: getServiceUrl('auth', true), // http://localhost:42069
  content: getServiceUrl('content', true), // http://localhost:4001
  access: getServiceUrl('access', true), // http://localhost:4001 (shares with content)
  organization: getServiceUrl('org', true), // http://localhost:42071
  ecom: getServiceUrl('ecom', true), // http://localhost:42072
  admin: getServiceUrl('admin', true), // http://localhost:42073
  identity: getServiceUrl('identity', true), // http://localhost:42074
  notifications: getServiceUrl('notifications', true), // http://localhost:42075
  media: getServiceUrl('media', true), // http://localhost:4002
} as const;

/**
 * Type definition for WORKER_URLS.
 */
export type WorkerUrls = typeof WORKER_URLS;
