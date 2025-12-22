/**
 * Cloudflare KV Secondary Storage Adapter
 *
 * Provides a unified session caching layer for Better Auth's secondaryStorage interface.
 * This adapter enables all workers to use the same KV namespace for session caching,
 * reducing database load and ensuring consistency across the platform.
 *
 * Better Auth's secondaryStorage is used for:
 * - Session caching (reduces database queries)
 * - Token storage (verification tokens, password reset tokens)
 *
 * Key format: Better Auth internally manages the key structure.
 * TTL: Set based on session/token expiration times.
 */

/// <reference types="@cloudflare/workers-types" />

/**
 * Better Auth's SecondaryStorage interface
 * Defines the contract for cache storage operations
 */
export interface SecondaryStorage {
  /**
   * Retrieve a value from cache
   * @param key - Cache key
   * @returns Parsed value or null if not found
   */
  get: (key: string) => Promise<unknown>;

  /**
   * Store a value in cache
   * @param key - Cache key
   * @param value - JSON string to store
   * @param ttl - Time-to-live in seconds (optional)
   */
  set: (key: string, value: string, ttl?: number) => Promise<void>;

  /**
   * Delete a value from cache
   * @param key - Cache key to delete
   */
  delete: (key: string) => Promise<void>;
}

/**
 * Create a KV-backed secondary storage adapter for Better Auth
 *
 * This adapter wraps Cloudflare KV to provide Better Auth's secondaryStorage interface.
 * It handles JSON serialization/deserialization and TTL-based expiration.
 *
 * @param kv - Cloudflare KV namespace binding
 * @returns SecondaryStorage adapter
 *
 * @example
 * ```typescript
 * import { createKVSecondaryStorage } from '@codex/security';
 *
 * const storage = createKVSecondaryStorage(env.AUTH_SESSION_KV);
 *
 * // Use with Better Auth
 * betterAuth({
 *   secondaryStorage: storage,
 *   // ... other config
 * });
 * ```
 */
export function createKVSecondaryStorage(kv: KVNamespace): SecondaryStorage {
  return {
    async get(key: string): Promise<unknown> {
      try {
        const value = await kv.get(key);
        if (!value) {
          return null;
        }
        return JSON.parse(value);
      } catch (error) {
        // Log error but don't throw - graceful degradation
        console.error('[KV Secondary Storage] Get error:', {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },

    async set(key: string, value: string, ttl?: number): Promise<void> {
      try {
        if (ttl) {
          await kv.put(key, value, { expirationTtl: ttl });
        } else {
          await kv.put(key, value);
        }
      } catch (error) {
        // Log error but don't throw - cache write failure shouldn't break auth
        console.error('[KV Secondary Storage] Set error:', {
          key,
          ttl,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    async delete(key: string): Promise<void> {
      try {
        await kv.delete(key);
      } catch (error) {
        // Log error but don't throw - cache deletion failure is non-critical
        console.error('[KV Secondary Storage] Delete error:', {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
