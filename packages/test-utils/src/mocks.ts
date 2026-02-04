/**
 * Test Mock Factories
 *
 * Centralized mock creation utilities for Codex test suites.
 * Provides consistent, type-safe mocks for common dependencies:
 * - Observability/logging
 * - Hono context
 * - Drizzle database
 * - Cloudflare KV/R2
 * - Stripe events
 *
 * Usage:
 * ```typescript
 * import { createMockObservability, createMockHonoContext } from '@codex/test-utils';
 *
 * const { obs, logs } = createMockObservability();
 * const { context, logs } = createMockHonoContext({ env: { DATABASE_URL: 'test' } });
 * ```
 */

import { randomUUID } from 'node:crypto';
import { type MockInstance, vi } from 'vitest';

// =============================================================================
// Types
// =============================================================================

/** Log entry captured by mock observability */
export interface MockLogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data?: unknown;
}

/** Mock observability client with spy-tracked methods */
export interface MockObservability {
  debug: MockInstance<(message: string, data?: unknown) => void>;
  info: MockInstance<(message: string, data?: unknown) => void>;
  warn: MockInstance<(message: string, data?: unknown) => void>;
  error: MockInstance<(message: string, data?: unknown) => void>;
}

/** Mock observability result with logs array for assertions */
export interface MockObservabilityResult {
  obs: MockObservability;
  logs: MockLogEntry[];
}

/** Options for creating mock Hono context */
export interface MockHonoContextOptions<
  TEnv extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Environment bindings (DATABASE_URL, ENVIRONMENT, etc.) */
  env?: Partial<TEnv>;
  /** Authenticated user data */
  user?: {
    id: string;
    email: string;
    name?: string | null;
    role?: string;
    emailVerified?: boolean;
    createdAt?: string;
    updatedAt?: string;
  };
  /** Session data */
  session?: {
    id: string;
    userId: string;
    token?: string;
    expiresAt?: string;
    createdAt?: string;
    updatedAt?: string;
  };
  /** Route parameters */
  params?: Record<string, string>;
  /** Request ID for tracking */
  requestId?: string;
  /** Additional context variables */
  variables?: Record<string, unknown>;
}

/** Mock Hono context with utilities for testing */
export interface MockHonoContext<
  TEnv extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Mock context get function */
  get: MockInstance;
  /** Mock context set function */
  set: MockInstance;
  /** Environment bindings */
  env: TEnv;
  /** Captured log entries */
  _logs: MockLogEntry[];
  /** Direct access to mock observability */
  _obs: MockObservability;
  /** Request parameters (for route handlers) */
  req: {
    param: MockInstance;
    json: MockInstance;
    header: MockInstance;
    url: string;
    method: string;
  };
  /** JSON response helper */
  json: MockInstance;
  /** Status setter */
  status: MockInstance;
}

/** Mock database query result */
export interface MockDatabaseQuery {
  findFirst: MockInstance;
  findMany: MockInstance;
}

/** Mock database with chainable Drizzle-like API */
export interface MockDatabase {
  query: Record<string, MockDatabaseQuery>;
  insert: MockInstance;
  update: MockInstance;
  delete: MockInstance;
  select: MockInstance;
  transaction: MockInstance;
}

/** Mock KV namespace with Map-backed storage */
export interface MockKVNamespace {
  get: MockInstance;
  put: MockInstance;
  delete: MockInstance;
  list: MockInstance;
  getWithMetadata: MockInstance;
  /** Internal storage for functional testing */
  _storage: Map<string, unknown>;
}

/** Mock R2 Bucket */
export interface MockR2Bucket {
  get: MockInstance;
  put: MockInstance;
  delete: MockInstance;
  head: MockInstance;
  list: MockInstance;
  createMultipartUpload: MockInstance;
  resumeMultipartUpload: MockInstance;
  /** Internal storage for functional testing */
  _storage: Map<string, { body: unknown; metadata?: unknown }>;
}

// =============================================================================
// Observability Mocks
// =============================================================================

/**
 * Create a mock observability client with spy-tracked logging methods.
 *
 * @returns Object containing:
 *   - `obs`: Mock observability client with debug/info/warn/error methods
 *   - `logs`: Array of captured log entries for assertions
 *
 * @example
 * ```typescript
 * const { obs, logs } = createMockObservability();
 *
 * // Use in handler
 * obs.info('Processing request', { id: 123 });
 *
 * // Assert logging
 * expect(obs.info).toHaveBeenCalledWith('Processing request', { id: 123 });
 * expect(logs).toContainEqual({
 *   level: 'info',
 *   message: 'Processing request',
 *   data: { id: 123 }
 * });
 * ```
 */
export function createMockObservability(): MockObservabilityResult {
  const logs: MockLogEntry[] = [];

  const obs: MockObservability = {
    debug: vi.fn((message: string, data?: unknown) => {
      logs.push({ level: 'debug', message, data });
    }),
    info: vi.fn((message: string, data?: unknown) => {
      logs.push({ level: 'info', message, data });
    }),
    warn: vi.fn((message: string, data?: unknown) => {
      logs.push({ level: 'warn', message, data });
    }),
    error: vi.fn((message: string, data?: unknown) => {
      logs.push({ level: 'error', message, data });
    }),
  };

  return { obs, logs };
}

// =============================================================================
// Hono Context Mocks
// =============================================================================

/**
 * Create a mock Hono context for handler/middleware testing.
 *
 * @param options - Configuration for the mock context
 * @returns Mock context with utilities for testing
 *
 * @example
 * ```typescript
 * const { context, _logs, _obs } = createMockHonoContext({
 *   env: { DATABASE_URL: 'postgresql://test' },
 *   user: { id: 'user_123', email: 'test@example.com' },
 *   params: { id: 'content_456' },
 * });
 *
 * await myHandler(context);
 *
 * expect(_obs.info).toHaveBeenCalled();
 * expect(_logs).toHaveLength(1);
 * ```
 */
export function createMockHonoContext<
  TEnv extends Record<string, unknown> = Record<string, unknown>,
>(options: MockHonoContextOptions<TEnv> = {}): MockHonoContext<TEnv> {
  const { obs, logs } = createMockObservability();

  const defaultEnv = {
    DATABASE_URL: 'postgresql://test',
    ENVIRONMENT: 'test',
    DB_METHOD: 'LOCAL',
  };

  const env = { ...defaultEnv, ...options.env } as unknown as TEnv;
  const requestId = options.requestId || randomUUID();

  // Build variables storage
  const variables: Record<string, unknown> = {
    obs,
    requestId,
    ...options.variables,
  };

  if (options.user) {
    variables.user = {
      role: 'user',
      emailVerified: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...options.user,
    };
  }

  if (options.session) {
    variables.session = {
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...options.session,
    };
  }

  const context: MockHonoContext<TEnv> = {
    get: vi.fn((key: string) => variables[key]),
    set: vi.fn((key: string, value: unknown) => {
      variables[key] = value;
    }),
    env,
    _logs: logs,
    _obs: obs,
    req: {
      param: vi.fn((key: string) => options.params?.[key]),
      json: vi.fn().mockResolvedValue({}),
      header: vi.fn().mockReturnValue(null),
      url: 'http://localhost/test',
      method: 'GET',
    },
    json: vi.fn((data: unknown) => new Response(JSON.stringify(data))),
    status: vi.fn().mockReturnThis(),
  };

  return context;
}

// =============================================================================
// Database Mocks
// =============================================================================

/**
 * Create a mock Drizzle-like database client.
 *
 * Provides chainable query API matching Drizzle ORM patterns:
 * - `db.query.tableName.findFirst()`
 * - `db.query.tableName.findMany()`
 * - `db.insert()`, `db.update()`, `db.delete()`, `db.select()`
 * - `db.transaction()`
 *
 * @param tables - List of table names to create query mocks for
 * @returns Mock database with all methods as vi.fn() spies
 *
 * @example
 * ```typescript
 * const mockDb = createMockDatabase(['users', 'sessions', 'content']);
 *
 * mockDb.query.users.findFirst.mockResolvedValue({
 *   id: 'user_1',
 *   email: 'test@example.com'
 * });
 *
 * const result = await mockDb.query.users.findFirst();
 * expect(result.id).toBe('user_1');
 * ```
 */
export function createMockDatabase(
  tables: string[] = [
    'users',
    'sessions',
    'content',
    'organizations',
    'mediaItems',
  ]
): MockDatabase {
  const query: Record<string, MockDatabaseQuery> = {};

  for (const table of tables) {
    query[table] = {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    };
  }

  // Create chainable insert/update/delete mocks
  const createChainableMock = () => {
    const mock = vi.fn();
    const chain = {
      values: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue({ rowCount: 0 }),
    };
    mock.mockReturnValue(chain);
    return mock;
  };

  const db: MockDatabase = {
    query,
    insert: createChainableMock(),
    update: createChainableMock(),
    delete: createChainableMock(),
    select: createChainableMock(),
    transaction: vi.fn(async <T>(fn: (tx: MockDatabase) => Promise<T>) => {
      // Execute transaction callback with the same mock db
      return fn(db);
    }),
  };

  return db;
}

// =============================================================================
// KV Namespace Mocks
// =============================================================================

/**
 * Create a mock Cloudflare KV namespace backed by an in-memory Map.
 *
 * Supports both spy assertions and functional testing:
 * - All methods are vi.fn() spies for expectation assertions
 * - Internal `_storage` Map provides functional get/put behavior
 *
 * @param options - Initial data to populate storage
 * @returns Mock KVNamespace with get, put, delete, list methods
 *
 * @example
 * ```typescript
 * const mockKV = createMockKVNamespace({
 *   initialData: { 'session:abc': { userId: 'user_1' } }
 * });
 *
 * // Spy-based assertions
 * expect(mockKV.get).toHaveBeenCalledWith('session:abc', 'json');
 *
 * // Or use functional storage
 * mockKV._storage.set('key', 'value');
 * ```
 */
export function createMockKVNamespace(options?: {
  initialData?: Record<string, unknown>;
}): MockKVNamespace {
  const storage = new Map<string, unknown>();

  // Populate initial data
  if (options?.initialData) {
    for (const [key, value] of Object.entries(options.initialData)) {
      storage.set(key, value);
    }
  }

  const kv: MockKVNamespace = {
    get: vi.fn(async (key: string, type?: string) => {
      const value = storage.get(key);
      if (value === undefined) return null;
      if (type === 'json') return value;
      if (type === 'text') return String(value);
      if (type === 'arrayBuffer') return value;
      return value;
    }),
    put: vi.fn(async (key: string, value: unknown) => {
      storage.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      storage.delete(key);
    }),
    list: vi.fn(async (options?: { prefix?: string; limit?: number }) => {
      const keys: Array<{ name: string }> = [];
      for (const key of storage.keys()) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          keys.push({ name: key });
        }
      }
      return {
        keys: options?.limit ? keys.slice(0, options.limit) : keys,
        list_complete: true,
        cursor: '',
      };
    }),
    getWithMetadata: vi.fn(async (key: string) => {
      const value = storage.get(key);
      return { value: value ?? null, metadata: null };
    }),
    _storage: storage,
  };

  return kv;
}

// =============================================================================
// R2 Bucket Mocks
// =============================================================================

/**
 * Create a mock Cloudflare R2 bucket backed by an in-memory Map.
 *
 * @returns Mock R2Bucket with get, put, delete, head, list methods
 *
 * @example
 * ```typescript
 * const mockR2 = createMockR2Bucket();
 *
 * await mockR2.put('videos/123.mp4', videoBuffer);
 * const obj = await mockR2.get('videos/123.mp4');
 *
 * expect(mockR2.put).toHaveBeenCalledWith('videos/123.mp4', videoBuffer);
 * ```
 */
export function createMockR2Bucket(): MockR2Bucket {
  const storage = new Map<string, { body: unknown; metadata?: unknown }>();

  const bucket: MockR2Bucket = {
    get: vi.fn(async (key: string) => {
      const item = storage.get(key);
      if (!item) return null;
      return {
        key,
        body: item.body,
        bodyUsed: false,
        arrayBuffer: vi.fn().mockResolvedValue(item.body),
        text: vi.fn().mockResolvedValue(String(item.body)),
        json: vi.fn().mockResolvedValue(item.body),
        blob: vi.fn().mockResolvedValue(new Blob([String(item.body)])),
        httpMetadata: {},
        customMetadata: item.metadata || {},
        writeHttpMetadata: vi.fn(),
      };
    }),
    put: vi.fn(
      async (
        key: string,
        body: unknown,
        options?: { customMetadata?: unknown }
      ) => {
        storage.set(key, { body, metadata: options?.customMetadata });
        return { key };
      }
    ),
    delete: vi.fn(async (key: string | string[]) => {
      const keys = Array.isArray(key) ? key : [key];
      for (const k of keys) {
        storage.delete(k);
      }
    }),
    head: vi.fn(async (key: string) => {
      const item = storage.get(key);
      if (!item) return null;
      return {
        key,
        size: typeof item.body === 'string' ? item.body.length : 0,
        etag: 'mock-etag',
        httpMetadata: {},
        customMetadata: item.metadata || {},
      };
    }),
    list: vi.fn(async (options?: { prefix?: string; limit?: number }) => {
      const objects: Array<{ key: string }> = [];
      for (const key of storage.keys()) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          objects.push({ key });
        }
      }
      return {
        objects: options?.limit ? objects.slice(0, options.limit) : objects,
        truncated: false,
        cursor: '',
        delimitedPrefixes: [],
      };
    }),
    createMultipartUpload: vi.fn(async (key: string) => ({
      key,
      uploadId: `upload_${randomUUID()}`,
      uploadPart: vi.fn(),
      complete: vi.fn(),
      abort: vi.fn(),
    })),
    resumeMultipartUpload: vi.fn(async (key: string, uploadId: string) => ({
      key,
      uploadId,
      uploadPart: vi.fn(),
      complete: vi.fn(),
      abort: vi.fn(),
    })),
    _storage: storage,
  };

  return bucket;
}
