/**
 * `followUpMemberDeparture` — what runs after a removal commits
 * (Codex-2hxff.64): course subscriptions cancelled at period end, caches
 * cleared, one email to the creator (owner decision Q5). Each step is
 * independent, so one failing never stops the others.
 */
import type { MemberDeparture } from '@codex/organization';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEPARTURE_COURSE_CANCEL_LIMIT,
  followUpMemberDeparture,
  type MemberDepartureDeps,
} from '../member-departure';

const invalidateContentAccess = vi.fn(async () => {});
vi.mock('@codex/content', () => ({
  invalidateContentAccess: (...args: unknown[]) =>
    invalidateContentAccess(...(args as [])),
}));

function departure(overrides: Partial<MemberDeparture> = {}): MemberDeparture {
  return {
    organizationId: 'org-1',
    creatorId: 'creator-1',
    at: new Date('2026-10-21T10:00:00Z'),
    endedAgreements: [{ id: 'agr-1' }] as MemberDeparture['endedAgreements'],
    catalogue: { contentIds: ['c-1', 'c-2'], courseIds: ['course-1'] },
    ...overrides,
  };
}

function makeDeps() {
  const cache = { invalidate: vi.fn(async () => {}) };
  const db = {
    query: {
      users: {
        findFirst: vi.fn(async () => ({
          email: 'creator@example.test',
          name: 'Jane Doe',
        })),
      },
      organizations: {
        findFirst: vi.fn(async () => ({ name: 'Studio Alpha', slug: 'alpha' })),
      },
    },
  };
  const deps = {
    db,
    cache,
    waitUntil: vi.fn(),
    cancelCourseSubscriptions: vi.fn(async () => ({
      cancelled: 50,
      failed: 2,
      remaining: 9,
    })),
    sendEmail: vi.fn(),
    obs: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  return deps as typeof deps & MemberDepartureDeps;
}

describe('followUpMemberDeparture', () => {
  beforeEach(() => invalidateContentAccess.mockClear());

  it('cancels course subscriptions, clears caches, and emails the creator what ended', async () => {
    const deps = makeDeps();

    await followUpMemberDeparture(deps, departure());

    expect(deps.cancelCourseSubscriptions).toHaveBeenCalledWith({
      courseIds: ['course-1'],
      limit: DEPARTURE_COURSE_CANCEL_LIMIT,
    });
    expect(DEPARTURE_COURSE_CANCEL_LIMIT).toBe(50);
    // Org collections, topics, journeys, the publish feed, and the slug key.
    expect(deps.cache.invalidate).toHaveBeenCalledWith('alpha');
    expect(deps.cache.invalidate.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(invalidateContentAccess).toHaveBeenCalledTimes(2);

    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
    expect(deps.sendEmail.mock.calls[0]?.[0]).toMatchObject({
      to: 'creator@example.test',
      templateName: 'removed-from-organisation',
      category: 'transactional',
      userId: 'creator-1',
      data: {
        orgName: 'Studio Alpha',
        agreementsEnded: '1',
        contentOffSale: '2',
        coursesOffSale: '1',
        // Cancelled now + left for the sweep (the failed are among those left).
        courseSubscriptionsEnding: '59',
      },
    });
  });

  it('a failed cancel is logged and the caches and email still happen', async () => {
    const deps = makeDeps();
    deps.cancelCourseSubscriptions.mockRejectedValueOnce(new Error('Stripe'));

    await followUpMemberDeparture(deps, departure());

    expect(deps.obs.error).toHaveBeenCalledWith(
      'Departure course subscription cancel failed',
      expect.objectContaining({ creatorId: 'creator-1' })
    );
    expect(invalidateContentAccess).toHaveBeenCalledTimes(2);
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
    expect(
      deps.sendEmail.mock.calls[0]?.[0].data.courseSubscriptionsEnding
    ).toBe('0');
  });

  it('a removal that ended nothing sends nothing and touches nothing', async () => {
    const deps = makeDeps();

    await followUpMemberDeparture(
      deps,
      departure({
        endedAgreements: [],
        catalogue: { contentIds: [], courseIds: [] },
      })
    );

    expect(deps.cancelCourseSubscriptions).not.toHaveBeenCalled();
    expect(deps.cache.invalidate).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  it('agreements alone still get the email, with nothing to cancel', async () => {
    const deps = makeDeps();

    await followUpMemberDeparture(
      deps,
      departure({ catalogue: { contentIds: [], courseIds: [] } })
    );

    expect(deps.cancelCourseSubscriptions).not.toHaveBeenCalled();
    expect(deps.cache.invalidate).not.toHaveBeenCalled();
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('a creator with no email address is logged, not emailed', async () => {
    const deps = makeDeps();
    deps.db.query.users.findFirst.mockResolvedValueOnce({
      email: '',
      name: 'Jane Doe',
    });

    await followUpMemberDeparture(deps, departure());

    expect(deps.sendEmail).not.toHaveBeenCalled();
    expect(deps.obs.warn).toHaveBeenCalledWith(
      'Removal email skipped: recipient has no email',
      expect.objectContaining({ creatorId: 'creator-1' })
    );
  });
});
