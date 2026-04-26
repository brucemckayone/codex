/**
 * Denoise iter-028 F5 — proof test for
 * `types:as-cast-without-guard` (recurrence — hits=2 from iter-005/iter-006,
 * this would be hit 3 → R7 promotion threshold).
 *
 * Finding: `packages/content/src/services/content-service.ts:158` performs
 *
 *   await this.validateMediaItem(
 *     tx as DatabaseTransaction,
 *     ...
 *   );
 *
 * inside `await this.db.transaction(async (tx) => { ... })`.
 *
 * Tier 6.A (1c499d79) widened `Database` to `DatabaseClient = Database |
 * DatabaseWs` so service constructors accept either. Inside `transaction()`,
 * `tx` is typed by the runtime client type — for `dbHttp` it's
 * `Parameters<Parameters<typeof dbHttp.transaction>[0]>[0]` (the HTTP tx
 * type, which `DatabaseTransaction` aliases at types.ts:28); for `dbWs` it's
 * a different (WS) tx type.
 *
 * Concrete drift exposure:
 *   - Production callers pass `dbHttp` → `tx` is HTTP tx → cast is identity, OK
 *   - Test callers pass `dbWs` → `tx` is WS tx → cast `as DatabaseTransaction`
 *     LIES: the runtime type is WS, the cast claims HTTP. Today the API
 *     surface of HTTP and WS transactions overlaps enough that
 *     `validateMediaItem` works either way — but if `validateMediaItem` ever
 *     reaches for a WS-only or HTTP-only method, the cast hides the bug at
 *     compile time and reports it only at runtime in tests OR production
 *     (whichever uses the missing transport).
 *
 * R11 root cause: `DatabaseTransaction` is HTTP-only-derived but used as a
 * universal transaction parameter type. After Tier 6.A widened `Database`,
 * `DatabaseTransaction` should similarly widen to a union of HTTP|WS tx
 * types (or be derived from `DatabaseClient.transaction`).
 *
 * Suggested fix:
 *   export type DatabaseTransaction =
 *     | Parameters<Parameters<typeof dbHttp.transaction>[0]>[0]
 *     | Parameters<Parameters<typeof dbWs.transaction>[0]>[0];
 *
 * — then drop the `as DatabaseTransaction` cast at line 158 (the assignment
 * compiles without it once tx and parameter types align).
 *
 * Proof shape: structural narrowing assertion (Catalogue row 3 / row 7 hybrid)
 * — assert that the parameter type of `validateMediaItem` is assignable from
 * BOTH the HTTP tx type AND the WS tx type. FAILS today (parameter is
 * HTTP-only); PASSES after `DatabaseTransaction` is widened.
 *
 * Severity: minor (no observed runtime bug today because validateMediaItem's
 * call surface stays in the HTTP|WS overlap; the bug is the type-system
 * bypass that hides future drift).
 *
 * Recurrence: this is hit 3 of fingerprint `types:as-cast-without-guard`
 * (after iter-005, iter-006). One more hit triggers R7 standard promotion
 * (3-hit threshold in trailing 6 cycles).
 *
 * Remove the `.skip()` modifier in the same PR as the DatabaseTransaction
 * widening + cast removal.
 */

import type { dbHttp, dbWs } from '@codex/database';
import { describe, expectTypeOf, it } from 'vitest';
import type { DatabaseTransaction } from '../types';

type HttpTxType = Parameters<Parameters<typeof dbHttp.transaction>[0]>[0];
type WsTxType = Parameters<Parameters<typeof dbWs.transaction>[0]>[0];

describe('denoise proof: F5 types:as-cast-without-guard — DatabaseTransaction widening', () => {
  it.skip('DatabaseTransaction MUST accept the WS tx type without an unchecked cast', () => {
    // FAILS today: DatabaseTransaction is HTTP-only-derived, so a WS tx is
    // NOT assignable. Service code at line 158 hides this with `as
    // DatabaseTransaction`. The fix widens DatabaseTransaction to HTTP|WS.
    expectTypeOf<WsTxType>().toMatchTypeOf<DatabaseTransaction>();
  });

  it.skip('DatabaseTransaction MUST accept the HTTP tx type (regression guard)', () => {
    // PASSES today (HTTP is the current basis). This proof guards against
    // a future fix that accidentally narrows to WS-only.
    expectTypeOf<HttpTxType>().toMatchTypeOf<DatabaseTransaction>();
  });
});
