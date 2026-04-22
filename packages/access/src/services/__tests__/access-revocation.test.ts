/**
 * AccessRevocation unit tests.
 *
 * KV mock: rolled locally rather than using `createMockKVNamespace` from
 * `@codex/test-utils` because we need to assert the `expirationTtl` passed
 * to `put()` (the test-utils mock discards the options bag). The mock here
 * deliberately mirrors the narrow KVNamespace surface AccessRevocation uses:
 * raw string storage via `get`, `put(options)`, and `delete`. Values are
 * stored as raw strings exactly as KV would hold them — this is what lets us
 * simulate "malformed JSON was somehow written" without monkey-patching.
 */

import type {
  KVNamespace,
  KVNamespacePutOptions,
} from '@cloudflare/workers-types';
import { ValidationError } from '@codex/service-errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AccessRevocation,
  REVOCATION_KEY_PREFIX,
  REVOCATION_TTL_SECONDS,
  type Revocation,
} from '../access-revocation';

interface MockKVRecord {
  value: string;
  ttl: number | undefined;
}

interface MockKV {
  kv: KVNamespace;
  store: Map<string, MockKVRecord>;
  putSpy: ReturnType<typeof vi.fn>;
  getSpy: ReturnType<typeof vi.fn>;
  deleteSpy: ReturnType<typeof vi.fn>;
}

function createMockKV(): MockKV {
  const store = new Map<string, MockKVRecord>();

  const putSpy = vi.fn(
    async (key: string, value: string, options?: KVNamespacePutOptions) => {
      store.set(key, { value, ttl: options?.expirationTtl });
    }
  );

  const getSpy = vi.fn(async (key: string) => {
    const record = store.get(key);
    return record ? record.value : null;
  });

  const deleteSpy = vi.fn(async (key: string) => {
    store.delete(key);
  });

  // Narrow cast: AccessRevocation only uses get/put/delete. The KVNamespace
  // surface is vast; this constructs the minimal shape we need without `any`.
  const kv = {
    get: getSpy,
    put: putSpy,
    delete: deleteSpy,
  } as unknown as KVNamespace;

  return { kv, store, putSpy, getSpy, deleteSpy };
}

const userId = 'user_abc';
const orgId = 'org_xyz';
const expectedKey = `${REVOCATION_KEY_PREFIX}:${userId}:${orgId}`;

describe('AccessRevocation', () => {
  let mock: MockKV;
  let revocation: AccessRevocation;

  beforeEach(() => {
    mock = createMockKV();
    revocation = new AccessRevocation(mock.kv);
  });

  describe('revoke()', () => {
    it('writes the key with correct payload and expirationTtl=1200', async () => {
      await revocation.revoke(userId, orgId, 'subscription_deleted');

      expect(mock.putSpy).toHaveBeenCalledTimes(1);
      const [calledKey, calledValue, calledOptions] = mock.putSpy.mock.calls[0];
      expect(calledKey).toBe(expectedKey);
      expect(calledOptions).toEqual({ expirationTtl: REVOCATION_TTL_SECONDS });
      expect(REVOCATION_TTL_SECONDS).toBe(1200);

      const parsed = JSON.parse(calledValue as string) as Revocation;
      expect(parsed.reason).toBe('subscription_deleted');
      expect(typeof parsed.revokedAt).toBe('string');
      // ISO 8601 sanity — Date.parse returns NaN on garbage
      expect(Number.isNaN(Date.parse(parsed.revokedAt))).toBe(false);
    });

    it('overwrites an existing entry — later reason wins', async () => {
      await revocation.revoke(userId, orgId, 'payment_failed');
      await revocation.revoke(userId, orgId, 'refund');

      const stored = mock.store.get(expectedKey);
      expect(stored).toBeDefined();
      const parsed = JSON.parse(stored?.value ?? '{}') as Revocation;
      expect(parsed.reason).toBe('refund');
    });

    it('throws ValidationError for empty userId', async () => {
      await expect(
        revocation.revoke('', orgId, 'subscription_deleted')
      ).rejects.toBeInstanceOf(ValidationError);
      expect(mock.putSpy).not.toHaveBeenCalled();
    });

    it('throws ValidationError for empty orgId', async () => {
      await expect(
        revocation.revoke(userId, '', 'subscription_deleted')
      ).rejects.toBeInstanceOf(ValidationError);
      expect(mock.putSpy).not.toHaveBeenCalled();
    });
  });

  describe('isRevoked()', () => {
    it('returns the parsed revocation after revoke()', async () => {
      await revocation.revoke(userId, orgId, 'admin_revoke');

      const result = await revocation.isRevoked(userId, orgId);
      expect(result).not.toBeNull();
      expect(result?.reason).toBe('admin_revoke');
      expect(typeof result?.revokedAt).toBe('string');
    });

    it('returns null for a key that was never written', async () => {
      const result = await revocation.isRevoked(userId, orgId);
      expect(result).toBeNull();
    });

    it('returns null for malformed JSON in KV (does not throw)', async () => {
      // Simulate corrupt KV state by writing raw text directly
      mock.store.set(expectedKey, { value: '{not-json', ttl: undefined });

      const result = await revocation.isRevoked(userId, orgId);
      expect(result).toBeNull();
    });

    it('returns null for JSON that does not match Revocation shape', async () => {
      // Valid JSON, wrong shape — defensive validator must reject
      mock.store.set(expectedKey, {
        value: JSON.stringify({ foo: 'bar' }),
        ttl: undefined,
      });

      const result = await revocation.isRevoked(userId, orgId);
      expect(result).toBeNull();
    });

    it('throws ValidationError for empty userId', async () => {
      await expect(revocation.isRevoked('', orgId)).rejects.toBeInstanceOf(
        ValidationError
      );
      expect(mock.getSpy).not.toHaveBeenCalled();
    });

    it('throws ValidationError for empty orgId', async () => {
      await expect(revocation.isRevoked(userId, '')).rejects.toBeInstanceOf(
        ValidationError
      );
      expect(mock.getSpy).not.toHaveBeenCalled();
    });
  });

  describe('clear()', () => {
    it('deletes the key — subsequent isRevoked() returns null', async () => {
      await revocation.revoke(userId, orgId, 'payment_failed');
      expect(await revocation.isRevoked(userId, orgId)).not.toBeNull();

      await revocation.clear(userId, orgId);

      expect(mock.deleteSpy).toHaveBeenCalledWith(expectedKey);
      expect(await revocation.isRevoked(userId, orgId)).toBeNull();
    });

    it('is idempotent — clearing a non-existent key does not throw', async () => {
      await expect(revocation.clear(userId, orgId)).resolves.toBeUndefined();
    });

    it('throws ValidationError for empty userId', async () => {
      await expect(revocation.clear('', orgId)).rejects.toBeInstanceOf(
        ValidationError
      );
      expect(mock.deleteSpy).not.toHaveBeenCalled();
    });

    it('throws ValidationError for empty orgId', async () => {
      await expect(revocation.clear(userId, '')).rejects.toBeInstanceOf(
        ValidationError
      );
      expect(mock.deleteSpy).not.toHaveBeenCalled();
    });
  });

  describe('keyspace isolation', () => {
    it('uses the revoked: prefix — never collides with cache: keyspace', async () => {
      await revocation.revoke(userId, orgId, 'subscription_deleted');
      const [calledKey] = mock.putSpy.mock.calls[0];
      expect(calledKey).toMatch(/^revoked:user:/);
      expect(calledKey).not.toMatch(/^cache:/);
    });

    it('keys are scoped per (userId, orgId) — different orgs do not collide', async () => {
      await revocation.revoke(userId, 'org_a', 'subscription_deleted');
      await revocation.revoke(userId, 'org_b', 'payment_failed');

      const a = await revocation.isRevoked(userId, 'org_a');
      const b = await revocation.isRevoked(userId, 'org_b');
      expect(a?.reason).toBe('subscription_deleted');
      expect(b?.reason).toBe('payment_failed');
    });
  });
});
