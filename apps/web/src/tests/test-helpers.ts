/**
 * Test Helper Types and Utilities
 *
 * Provides type-safe mock utilities for testing SvelteKit load functions.
 */

import type { Cookies, Platform, RequestEvent } from '@sveltejs/kit';
import { vi } from 'vitest';
import type { ServerApi } from '$lib/server/api';

/**
 * Mock cookies object for testing
 */
export interface MockCookies extends Cookies {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  serialize: ReturnType<typeof vi.fn>;
  getAll: ReturnType<typeof vi.fn>;
}

/**
 * Create a mock cookies object
 */
export function createMockCookies(): MockCookies {
  return {
    get: vi.fn(() => 'session-cookie'),
    set: vi.fn(),
    delete: vi.fn(),
    serialize: vi.fn(),
    getAll: vi.fn(() => []),
  };
}

/**
 * Mock platform object for testing
 */
export interface MockPlatform extends Platform {
  env: App.Platform['env'];
}

/**
 * Create a mock platform object
 */
export function createMockPlatform(
  env: App.Platform['env'] = {}
): MockPlatform {
  return {
    env,
    context: {} as ExecutionContext,
    caches: {} as CacheStorage,
  };
}

/**
 * Mock load event for server-side load functions
 */
export interface MockServerLoadEvent {
  params: Record<string, string>;
  cookies: MockCookies;
  platform: MockPlatform;
  url: URL;
  locals?: App.Locals;
  setHeaders?: ReturnType<typeof vi.fn>;
  request?: Request;
  route: { id: string | null };
}

/**
 * Create a mock server load event
 */
export function createMockServerLoadEvent(
  overrides: Partial<MockServerLoadEvent> = {}
): MockServerLoadEvent {
  return {
    params: {},
    cookies: createMockCookies(),
    platform: createMockPlatform(),
    url: new URL('http://localhost:3000'),
    route: { id: null },
    ...overrides,
  };
}

/**
 * Type for a partial ServerApi mock
 */
export type PartialServerApi = Partial<ServerApi>;

/**
 * Create a mock server API with the given overrides
 *
 * @example
 * ```typescript
 * const mockContentGet = vi.fn();
 * const mockApi = createMockServerApi({
 *   content: { get: mockContentGet }
 * });
 * vi.mock('$lib/server/api', () => ({
 *   createServerApi: mockApi
 * }));
 * ```
 */
export function createMockServerApi(overrides: PartialServerApi) {
  return vi.fn(() => overrides);
}
