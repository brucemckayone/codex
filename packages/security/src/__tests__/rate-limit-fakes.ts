/**
 * Test doubles for the rate-limit substrate.
 *
 * `createFakeDurableObjectState` implements only the storage surface
 * `RateLimitDO` actually touches — `sql.exec` for the six statements it issues,
 * `transactionSync`, and `blockConcurrencyWhile`. That is enough to exercise
 * the DO's real control flow (window rollover, the counter cap, prune
 * scheduling, the decision arithmetic) in the node test environment. Verifying
 * the SQL text itself needs workerd, so a `@cloudflare/vitest-pool-workers`
 * suite for that is tracked separately.
 */

import type { DurableObjectState, RateLimit } from '@cloudflare/workers-types';
import { RateLimitDO, type RateLimitNamespace } from '../rate-limit-do';

interface WindowRow {
  hits: number;
  window_start_ms: number;
  expires_at_ms: number;
}

function cursor<T>(rows: T[]) {
  return { toArray: () => rows };
}

export function createFakeDurableObjectState(): DurableObjectState {
  const rows = new Map<string, WindowRow>();
  let tableExists = false;

  const exec = (query: string, ...bindings: unknown[]) => {
    const statement = query.trim().replace(/\s+/g, ' ');

    if (statement.startsWith('CREATE TABLE')) {
      tableExists = true;
      return cursor([]);
    }
    if (statement.startsWith('CREATE INDEX')) {
      return cursor([]);
    }
    if (!tableExists) {
      throw new Error('no such table: rate_limit_windows');
    }

    if (statement.startsWith('SELECT')) {
      const row = rows.get(String(bindings[0]));
      return cursor(row ? [{ ...row }] : []);
    }
    if (statement.startsWith('INSERT')) {
      rows.set(String(bindings[0]), {
        hits: 1,
        window_start_ms: Number(bindings[1]),
        expires_at_ms: Number(bindings[2]),
      });
      return cursor([]);
    }
    if (statement.startsWith('UPDATE')) {
      const row = rows.get(String(bindings[1]));
      if (row) row.hits = Number(bindings[0]);
      return cursor([]);
    }
    if (statement.startsWith('DELETE')) {
      const cutoff = Number(bindings[0]);
      for (const [key, row] of rows) {
        if (row.expires_at_ms <= cutoff) rows.delete(key);
      }
      return cursor([]);
    }

    throw new Error(`fake sql: unhandled statement "${statement}"`);
  };

  return {
    storage: {
      sql: { exec },
      transactionSync: <T>(closure: () => T): T => closure(),
    },
    blockConcurrencyWhile: async <T>(closure: () => Promise<T>): Promise<T> =>
      closure(),
    // Exposed for assertions on stored state.
    __rows: rows,
  } as unknown as DurableObjectState;
}

/**
 * A namespace that routes to real `RateLimitDO` instances, one per shard, over
 * the fake storage. The middleware tests therefore exercise the DO's actual
 * counting logic rather than a reimplementation of it.
 */
export function createFakeRateLimitNamespace(): RateLimitNamespace<string> & {
  shards: Map<string, RateLimitDO>;
} {
  const shards = new Map<string, RateLimitDO>();

  return {
    shards,
    idFromName: (name: string) => name,
    get: (id: string) => {
      let instance = shards.get(id);
      if (!instance) {
        instance = new RateLimitDO(createFakeDurableObjectState());
        shards.set(id, instance);
      }
      const target = instance;
      // `RateLimitStub` takes a URL + init (not a constructed Request) so its
      // public type never touches the colliding ambient globals; the real DO
      // still receives a Request, so build it here.
      return {
        fetch: (url: string, init: { method: string; body: string }) =>
          target.fetch(new Request(url, init)),
      };
    },
  };
}

/** A namespace whose stub always throws, to drive the backend-error path. */
export function createBrokenRateLimitNamespace(): RateLimitNamespace<string> {
  return {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: () => Promise.reject(new Error('durable object unreachable')),
    }),
  };
}

/**
 * Fake native Workers Rate Limiting binding. Records every key it saw so tests
 * can assert on bucket separation, and reports `{ success }` only — exactly
 * what the real binding returns.
 */
export function createFakeRateLimitBinding(limit: number): RateLimit & {
  counts: Map<string, number>;
} {
  const counts = new Map<string, number>();
  return {
    counts,
    limit: async ({ key }: { key: string }) => {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return { success: next <= limit };
    },
  };
}
