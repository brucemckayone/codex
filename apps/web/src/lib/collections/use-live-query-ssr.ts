/**
 * SSR-safe useLiveQuery wrapper
 *
 * TanStack DB's useLiveQuery requires collections to exist, but our collections
 * are undefined on the server (by design, to prevent cross-request data leaks).
 *
 * This wrapper handles SSR by returning static data on the server and delegating
 * to the real useLiveQuery on the client.
 *
 * Usage:
 * ```svelte
 * <script>
 *   import { useLiveQuery, libraryCollection } from '$lib/collections';
 *
 *   let { data } = $props();  // Server-loaded data from +page.server.ts
 *
 *   const libraryQuery = useLiveQuery(
 *     (q) => q.from({ item: libraryCollection }).orderBy(...),
 *     undefined,  // deps (optional)
 *     { ssrData: data.library?.items }  // SSR fallback data
 *   );
 * </script>
 * ```
 *
 * Architecture:
 * 1. Server (SSR): Returns static result with ssrData, no reactivity
 * 2. Client (browser): Returns real useLiveQuery result with live reactivity
 * 3. Hydration: onMount populates QueryClient cache, useLiveQuery uses cached data
 */

import type {
  Context,
  GetResult,
  InitialQueryBuilder,
  QueryBuilder,
} from '@tanstack/db';
import type {
  UseLiveQueryReturn,
  UseLiveQueryReturnWithCollection,
} from '@tanstack/svelte-db';
import { useLiveQuery as baseUseLiveQuery } from '@tanstack/svelte-db';
import { browser } from '$app/environment';

/**
 * Options for SSR-safe useLiveQuery
 */
export interface UseLiveQuerySSROptions {
  /** Static data to return during SSR. Falls back to empty array if undefined. */
  ssrData?: object[];
}

/**
 * Create a static noop result for SSR
 *
 * Returns a result object that matches the useLiveQuery API but contains
 * static data and doesn't perform any reactive operations.
 */
function createSSRResult(
  data: object[]
):
  | UseLiveQueryReturn<object>
  | UseLiveQueryReturnWithCollection<object, string, Record<string, never>> {
  return {
    state: new Map(),
    data,
    // biome-ignore lint/suspicious/noExplicitAny: Intentional - collection is undefined on server by design
    collection: undefined as any,
    status: 'ready' as const,
    isLoading: false,
    isReady: true,
    isIdle: false,
    isError: false,
    isCleanedUp: false,
  };
}

// ============================================================================
// Overload 1: Query function only
// ============================================================================
export function useLiveQuerySSR<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
  deps?: Array<() => unknown>,
  options?: UseLiveQuerySSROptions
): UseLiveQueryReturn<GetResult<TContext>>;

// ============================================================================
// Overload 2: Config object
// ============================================================================
export function useLiveQuerySSR<TContext extends Context>(
  config: Parameters<typeof baseUseLiveQuery>[0],
  deps?: Array<() => unknown>,
  options?: UseLiveQuerySSROptions
): UseLiveQueryReturn<GetResult<TContext>>;

// ============================================================================
// Overload 3: Pre-created collection
// ============================================================================
export function useLiveQuerySSR<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, never> | Record<string, unknown>,
>(
  liveQueryCollection: Parameters<typeof baseUseLiveQuery>[0],
  options?: UseLiveQuerySSROptions
): UseLiveQueryReturnWithCollection<TResult, TKey, TUtils>;

// ============================================================================
// Implementation
// ============================================================================
export function useLiveQuerySSR(
  // biome-ignore lint/suspicious/noExplicitAny: Intentional - accepts multiple overload signatures
  queryFnOrConfigOrCollection: any,
  depsOrOptions?: Array<() => unknown> | UseLiveQuerySSROptions,
  options?: UseLiveQuerySSROptions
  // biome-ignore lint/suspicious/noExplicitAny: Intentional - return type varies by overload
): any {
  // During SSR, return static data
  if (!browser) {
    // Normalize parameters - options might be in second position for overload 3
    const ssrOptions =
      options && 'ssrData' in options
        ? options
        : depsOrOptions && 'ssrData' in depsOrOptions
          ? (depsOrOptions as UseLiveQuerySSROptions)
          : undefined;

    return createSSRResult(ssrOptions?.ssrData ?? []);
  }

  // On client, delegate to real useLiveQuery
  // Runtime disambiguation: if first arg has a `.state` property it's a collection (overload 3),
  // otherwise it's a query function or config object (overload 1/2).
  const isCollection =
    queryFnOrConfigOrCollection != null &&
    typeof queryFnOrConfigOrCollection === 'object' &&
    'state' in queryFnOrConfigOrCollection;

  if (!isCollection && Array.isArray(depsOrOptions)) {
    // Overload 1 or 2: deps is second param, options is third
    return baseUseLiveQuery(queryFnOrConfigOrCollection, depsOrOptions);
  } else {
    // Overload 3: collection is first param, options is second (or omitted)
    // Also handles overload 1/2 when deps are omitted
    return baseUseLiveQuery(queryFnOrConfigOrCollection);
  }
}
