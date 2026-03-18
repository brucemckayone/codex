/**
 * Centralized Test Mocks
 *
 * This file is imported by setup.ts, which is configured in vitest.config.ts's
 * setupFiles array. These mocks are applied BEFORE any test modules are loaded,
 * preventing race conditions during module initialization.
 *
 * CRITICAL: These mocks must be at the top level (hoisted by Vitest) and
 * imported before any other test code.
 */

import { vi } from 'vitest';

/**
 * Mock $app/environment
 *
 * Controls browser-specific code paths. We set browser: true for client-side
 * tests, which affects:
 * - query-client.ts: Creates QueryClient only when browser === true
 * - SSR guards in various components
 */
vi.mock('$app/environment', () => ({
  browser: true,
  dev: false,
  building: false,
}));

/**
 * Mock TanStack DB
 *
 * TanStack DB has heavy initialization that can timeout in tests. We mock
 * the core utilities to test the integration layer without actual DB calls.
 */
const mockCollection = {
  state: new Map(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('@tanstack/db', () => ({
  createCollection: vi.fn(() => mockCollection),
  localStorageCollectionOptions: vi.fn((options) => options),
  and: vi.fn(),
  eq: vi.fn(),
  gt: vi.fn(),
  gte: vi.fn(),
  lt: vi.fn(),
  lte: vi.fn(),
  not: vi.fn(),
  or: vi.fn(),
}));

vi.mock('@tanstack/query-db-collection', () => ({
  queryCollectionOptions: vi.fn((options) => options),
}));

vi.mock('@tanstack/svelte-db', () => ({
  useLiveQuery: vi.fn(),
}));

/**
 * Mock $app/server
 *
 * Remote functions import from $app/server for server-side execution.
 * Mocking this prevents hanging during module initialization.
 */
vi.mock('$app/server', () => ({
  command: vi.fn((fn) => fn),
  form: vi.fn((_schema, fn) => fn),
  query: vi.fn((fn) => fn),
  getRequestEvent: vi.fn(() => ({
    platform: { env: {} },
    cookies: {
      get: vi.fn(() => ({ value: '' })),
      set: vi.fn(),
      delete: vi.fn(),
    },
    url: new URL('http://localhost:3000'),
    request: new Request('http://localhost:3000'),
  })),
}));

/**
 * Mock $lib/server/api
 *
 * Remote functions call the server API. We mock this to avoid actual
 * network calls or database operations during tests.
 */
vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    auth: { getSession: vi.fn(), logout: vi.fn() },
    content: { list: vi.fn(), get: vi.fn() },
    library: { getUserLibrary: vi.fn() },
    org: { getPublicBranding: vi.fn() },
    checkout: { createCheckout: vi.fn() },
  })),
  serverApiUrl: vi.fn(() => 'http://localhost:42069'),
}));
