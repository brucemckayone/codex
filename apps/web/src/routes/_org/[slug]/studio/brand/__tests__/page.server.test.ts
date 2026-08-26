/**
 * Brand studio — admin/owner guard (Codex-cijzb WP-1.1).
 *
 * The studio layout admits creator/admin/owner; this page tightens the bar to
 * admin/owner and 303-redirects everyone else to /studio. The role source is
 * `userRole` from the studio layout's parent data (getMyMembership) — no
 * second source. These tests prove the guard can fail: a creator/member/absent
 * role is redirected; only admin/owner passes.
 */
import { describe, expect, it } from 'vitest';
import { load } from '../+page.server';

type LoadInput = Parameters<typeof load>[0];

const inputForRole = (userRole: string | null): LoadInput =>
  ({
    parent: async () => ({ userRole }),
  }) as unknown as LoadInput;

describe('studio/brand — admin/owner guard', () => {
  it('redirects a creator to /studio (303)', async () => {
    await expect(load(inputForRole('creator'))).rejects.toMatchObject({
      status: 303,
      location: '/studio',
    });
  });

  it('redirects a plain member to /studio (303)', async () => {
    await expect(load(inputForRole('member'))).rejects.toMatchObject({
      status: 303,
      location: '/studio',
    });
  });

  it('redirects when the role is absent (303)', async () => {
    await expect(load(inputForRole(null))).rejects.toMatchObject({
      status: 303,
      location: '/studio',
    });
  });

  it('allows an admin through (no redirect)', async () => {
    await expect(load(inputForRole('admin'))).resolves.toEqual({});
  });

  it('allows an owner through (no redirect)', async () => {
    await expect(load(inputForRole('owner'))).resolves.toEqual({});
  });
});
