/**
 * Category space resolvers — Unit Tests
 *
 * Locks the category-route authorization contract that `categories.ts` delegates
 * to. Two gates, both fail-closed, both self-scoped for personal space:
 *   - resolveMemberCategorySpace  (list / create)  → any ACTIVE org member
 *   - resolveManagedCategorySpace (curate: edit/delete/reorder/cover) → owner|admin
 *
 * Extracted from the routes (mirrors public-cache.test.ts / content-cleanup.test.ts)
 * so the gate is asserted directly, WITHOUT a worker request or live KV/DB — the
 * membership lookup is injected.
 *
 * Falsifiability (implement/tests-must-be-able-to-fail): the "member CANNOT
 * curate", "non-member denied", and "member CAN read+create" assertions are
 * UNCONDITIONAL — they fail if the split regresses (e.g. curation opens to plain
 * members, or listing/creating wrongly demands owner/admin, or a non-member slips
 * through).
 */

import { ForbiddenError } from '@codex/service-errors';
import { describe, expect, it, vi } from 'vitest';
import {
  type MembershipChecker,
  resolveManagedCategorySpace,
  resolveMemberCategorySpace,
} from '../category-space';

const USER = 'user-1';
const ORG = '11111111-1111-1111-1111-111111111111';

/** Membership checker returning the given role (or null = non-member).
 * `checkOrganizationMembership` only ever returns ACTIVE rows, so a role here
 * models an active member. */
function memberWith(role: string | null): MembershipChecker {
  return vi.fn(async () => (role === null ? null : { role }));
}

describe('resolveMemberCategorySpace (list / create gate)', () => {
  it('personal space: no org → self-scoped, membership never consulted', async () => {
    const checkMembership = memberWith('owner');
    const space = await resolveMemberCategorySpace({
      organizationId: undefined,
      userId: USER,
      checkMembership,
    });
    expect(space).toEqual({ creatorId: USER });
    expect(checkMembership).not.toHaveBeenCalled();
  });

  it('org space: a plain member role (editor) CAN read+create', async () => {
    // The key WP-5 requirement: a non-owner/admin member must be able to list
    // and inline-create categories to tag their content.
    const space = await resolveMemberCategorySpace({
      organizationId: ORG,
      userId: USER,
      checkMembership: memberWith('editor'),
    });
    expect(space).toEqual({ organizationId: ORG, creatorId: USER });
  });

  it('org space: owner/admin also allowed', async () => {
    for (const role of ['owner', 'admin']) {
      const space = await resolveMemberCategorySpace({
        organizationId: ORG,
        userId: USER,
        checkMembership: memberWith(role),
      });
      expect(space).toEqual({ organizationId: ORG, creatorId: USER });
    }
  });

  it('org space: REJECTS a non-member (ForbiddenError)', async () => {
    await expect(
      resolveMemberCategorySpace({
        organizationId: ORG,
        userId: USER,
        checkMembership: memberWith(null),
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('resolveManagedCategorySpace (curation gate)', () => {
  it('personal space: no org → self-scoped, membership never consulted', async () => {
    const checkMembership = memberWith('owner');
    const space = await resolveManagedCategorySpace({
      organizationId: undefined,
      userId: USER,
      checkMembership,
    });
    expect(space).toEqual({ creatorId: USER });
    expect(checkMembership).not.toHaveBeenCalled();
  });

  it('org space: owner is authorized → org-scoped space', async () => {
    const space = await resolveManagedCategorySpace({
      organizationId: ORG,
      userId: USER,
      checkMembership: memberWith('owner'),
    });
    expect(space).toEqual({ organizationId: ORG, creatorId: USER });
  });

  it('org space: admin is authorized → org-scoped space', async () => {
    const space = await resolveManagedCategorySpace({
      organizationId: ORG,
      userId: USER,
      checkMembership: memberWith('admin'),
    });
    expect(space).toEqual({ organizationId: ORG, creatorId: USER });
  });

  it('org space: REJECTS a plain member (editor) — curation is owner/admin only', async () => {
    await expect(
      resolveManagedCategorySpace({
        organizationId: ORG,
        userId: USER,
        checkMembership: memberWith('editor'),
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('org space: REJECTS a non-member', async () => {
    await expect(
      resolveManagedCategorySpace({
        organizationId: ORG,
        userId: USER,
        checkMembership: memberWith(null),
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('org space: passes the resolved org + user to the membership checker', async () => {
    const checkMembership = memberWith('owner');
    await resolveManagedCategorySpace({
      organizationId: ORG,
      userId: USER,
      checkMembership,
    });
    expect(checkMembership).toHaveBeenCalledWith(ORG, USER);
  });
});
