/**
 * Denoise iter-001 F2 — proof test for
 * `packages:identifier-no-shape-validation` (new fingerprint).
 *
 * Finding: `AccessRevocation.revoke` / `isRevoked` / `clear`
 * (packages/access/src/services/access-revocation.ts) accept `userId` and
 * `orgId` as raw strings, gated only by `assertNonEmptyIdentifier` (length > 0).
 * The KV key is built as `${REVOCATION_KEY_PREFIX}:${userId}:${orgId}`.
 *
 * The `:` separator collides if either identifier itself contains `:`. A
 * caller that passes `userId="abc:foo"` and `orgId="x"` produces the same key
 * as `userId="abc"` and `orgId="foo:x"` — meaning revocation written for one
 * (userId, orgId) pair would mask another. In production callers always pass
 * UUIDs (no colons), but defense-in-depth wants validation at the boundary so
 * a future caller with an arbitrary identifier source can't break the
 * invariant silently.
 *
 * Rule: identifier inputs that participate in delimiter-based key
 * construction must validate against the delimiter (or the whole shape) at
 * the boundary, OR the key construction must be delimiter-safe (e.g.
 * URL-encoded, length-prefixed, or a hash of the pair).
 *
 * Proof shape: structural / parity test (Catalogue row 1 — "behaviour-
 * equivalent refactor"). Two distinct (userId, orgId) pairs that collide
 * under the current key scheme MUST resolve to distinct KV keys after fix.
 * The test exercises the public surface — write a revocation under pair A,
 * read under pair B, expect `null` (no collision).
 *
 * Severity: minor (defense-in-depth; current callers all pass UUIDs).
 *
 * Remove the `.skip()` modifier in the same PR as the fix (most likely the
 * fix introduces shape validation via uuidSchema.parse(), or switches the
 * key to a non-delimiter construction).
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import { describe, expect, it } from 'vitest';
import { AccessRevocation } from '../../services/access-revocation';

class InMemoryKv {
  private readonly store = new Map<string, string>();

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

describe('denoise proof: F2 packages:identifier-no-shape-validation — AccessRevocation key collision', () => {
  it.skip('distinct (userId, orgId) pairs MUST NOT collide on the underlying KV key', async () => {
    const kv = new InMemoryKv() as unknown as KVNamespace;
    const ar = new AccessRevocation(kv);

    // Pair A: userId="abc:foo", orgId="x" → current key:
    //   revoked:user:abc:foo:x
    // Pair B: userId="abc",   orgId="foo:x" → current key:
    //   revoked:user:abc:foo:x
    // Same key! Without a fix, writing under Pair A returns a hit under
    // Pair B's `isRevoked`. After the fix (shape validation OR safe key
    // construction), Pair A either rejects at write or produces a
    // distinct key — Pair B's `isRevoked` returns null.
    await ar.revoke('abc:foo', 'x', 'admin_revoke');

    const hit = await ar.isRevoked('abc', 'foo:x');
    expect(hit).toBeNull();
  });
});
