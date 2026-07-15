/**
 * resolveMembershipWithRetry unit tests (Codex-jko8i).
 *
 * Locks the read-after-write retry contract for the studio guard:
 *  - a non-null role short-circuits immediately (no wasted backoff);
 *  - a role that appears on a later attempt (fresh-owner lag) is returned;
 *  - an always-null role (genuine non-member) exhausts the backoff and returns
 *    null so the guard still redirects to access-denied.
 *
 * `sleep` is injected so the suite runs without real timers.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  type MembershipRole,
  resolveMembershipWithRetry,
} from './membership-retry';

const noSleep = vi.fn(async () => {});

describe('resolveMembershipWithRetry', () => {
  it('returns immediately when the role is present on the first read (no backoff)', async () => {
    const sleep = vi.fn(async () => {});
    const fetchMembership = vi
      .fn<() => Promise<MembershipRole>>()
      .mockResolvedValue({ role: 'owner', joinedAt: '2026-01-01' });

    const result = await resolveMembershipWithRetry(fetchMembership, {
      delaysMs: [80, 160, 240],
      sleep,
    });

    expect(result.role).toBe('owner');
    expect(fetchMembership).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries while role is null and returns the role once it becomes visible (fresh-owner lag)', async () => {
    const sleep = vi.fn(async () => {});
    const fetchMembership = vi
      .fn<() => Promise<MembershipRole>>()
      .mockResolvedValueOnce({ role: null, joinedAt: null })
      .mockResolvedValueOnce({ role: null, joinedAt: null })
      .mockResolvedValueOnce({ role: 'owner', joinedAt: '2026-01-01' });

    const result = await resolveMembershipWithRetry(fetchMembership, {
      delaysMs: [80, 160, 240],
      sleep,
    });

    expect(result.role).toBe('owner');
    // initial + 2 retries = 3 reads; 2 backoffs consumed.
    expect(fetchMembership).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 80);
    expect(sleep).toHaveBeenNthCalledWith(2, 160);
  });

  it('exhausts the backoff and returns null for a genuine non-member', async () => {
    const sleep = vi.fn(async () => {});
    const fetchMembership = vi
      .fn<() => Promise<MembershipRole>>()
      .mockResolvedValue({ role: null, joinedAt: null });

    const result = await resolveMembershipWithRetry(fetchMembership, {
      delaysMs: [80, 160, 240],
      sleep,
    });

    expect(result.role).toBeNull();
    // initial + 3 retries = 4 reads; all 3 backoffs consumed.
    expect(fetchMembership).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it('does not retry a definitive non-privileged role (member is not null)', async () => {
    const sleep = vi.fn(async () => {});
    const fetchMembership = vi
      .fn<() => Promise<MembershipRole>>()
      .mockResolvedValue({ role: 'member', joinedAt: '2026-01-01' });

    const result = await resolveMembershipWithRetry(fetchMembership, {
      delaysMs: [80, 160, 240],
      sleep,
    });

    // 'member' is a real, visible role — no retry; the guard decides access.
    expect(result.role).toBe('member');
    expect(fetchMembership).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('uses the default backoff shape when none is provided', async () => {
    const fetchMembership = vi
      .fn<() => Promise<MembershipRole>>()
      .mockResolvedValue({ role: null, joinedAt: null });

    const result = await resolveMembershipWithRetry(fetchMembership, {
      sleep: noSleep,
    });

    expect(result.role).toBeNull();
    // Default [80,160,240] → 1 initial + 3 retries.
    expect(fetchMembership).toHaveBeenCalledTimes(4);
  });
});
