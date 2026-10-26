/**
 * getMyMembership answers the access check without the banner read
 * (Codex-2hxff.42).
 *
 * NO DATABASE. The membership read and the ownership-offer read are two
 * separate queries, so a stub `db` can fail one and not the other:
 *   - `query.organizationMemberships.findFirst` is the access check;
 *   - `select().from().innerJoin().where().limit()` is the offer banner
 *     (`getPendingOwnershipOffer`, run for real against the stub).
 *
 * The first case is the stub's own control: a successful offer read must
 * come back as the banner. If the chain stopped matching the real query, the
 * offer read would throw a TypeError, be answered as "no offer", and the
 * failure case below would pass for the wrong reason.
 */

import { InternalServiceError } from '@codex/service-errors';
import { describe, expect, it, vi } from 'vitest';
import type { OrganizationServiceConfig } from '../organization-service';
import { OrganizationService } from '../organization-service';

const ORG_ID = 'org-membership-1';
const USER_ID = 'user-owner-1';
const JOINED_AT = new Date('2026-01-02T03:04:05.000Z');
const EXPIRES_AT = new Date('2026-11-01T00:00:00.000Z');

interface StubOptions {
  membershipError?: Error;
  offerError?: Error;
}

function makeService({ membershipError, offerError }: StubOptions = {}) {
  const limit = vi.fn(() =>
    offerError
      ? Promise.reject(offerError)
      : Promise.resolve([
          {
            offerId: 'offer-1',
            offeredByName: 'Previous Owner',
            expiresAt: EXPIRES_AT,
          },
        ])
  );
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit,
  };
  const select = vi.fn(() => chain);
  const db = {
    query: {
      organizationMemberships: {
        findFirst: vi.fn(() =>
          membershipError
            ? Promise.reject(membershipError)
            : Promise.resolve({ role: 'owner', createdAt: JOINED_AT })
        ),
      },
    },
    select,
  };
  const service = new OrganizationService({
    db: db as unknown as OrganizationServiceConfig['db'],
    environment: 'test',
  });
  // `obs` is protected on BaseService; reach it structurally for the spy.
  const obs = (
    service as unknown as { obs: { error: (...a: unknown[]) => void } }
  ).obs;
  return { service, select, error: vi.spyOn(obs, 'error') };
}

describe('OrganizationService.getMyMembership', () => {
  it('carries the open offer when the banner read succeeds (stub control)', async () => {
    const { service, error } = makeService();

    const result = await service.getMyMembership(ORG_ID, USER_ID);

    expect(result).toEqual({
      role: 'owner',
      joinedAt: JOINED_AT.toISOString(),
      pendingOwnershipOffer: {
        offerId: 'offer-1',
        offeredByName: 'Previous Owner',
        expiresAt: EXPIRES_AT.toISOString(),
      },
    });
    expect(error).not.toHaveBeenCalled();
  });

  it('a failed offer read still answers the membership, with no offer, and logs it', async () => {
    const { service, error } = makeService({
      offerError: new Error('offer read boom'),
    });

    const result = await service.getMyMembership(ORG_ID, USER_ID);

    expect(result).toEqual({
      role: 'owner',
      joinedAt: JOINED_AT.toISOString(),
      pendingOwnershipOffer: null,
    });
    // Exactly once: the offer catch logged it, and handleError never ran.
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      'Ownership offer read failed; membership answered without it',
      {
        errorId: expect.any(String),
        organizationId: ORG_ID,
        userId: USER_ID,
        errorName: 'Error',
        errorMessage: 'offer read boom',
        code: undefined,
      }
    );
  });

  it("a failed offer read logs the driver's error under drizzle's wrapper, never the query", async () => {
    // drizzle 0.44 throws a plain-named Error whose message is the SQL and
    // every bound value; its cause is the driver's error.
    const dropped = Object.assign(new Error('Connection terminated'), {
      code: '08006',
    });
    const { service, error } = makeService({
      offerError: Object.assign(
        new Error(`Failed query: select 1\nparams: ${ORG_ID},${USER_ID}`),
        { cause: dropped }
      ),
    });

    const result = await service.getMyMembership(ORG_ID, USER_ID);

    expect(result.pendingOwnershipOffer).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      'Ownership offer read failed; membership answered without it',
      {
        errorId: expect.any(String),
        organizationId: ORG_ID,
        userId: USER_ID,
        errorName: 'Error',
        errorMessage: 'Connection terminated',
        code: '08006',
      }
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain('Failed query');
  });

  it('a failed membership read still throws, and the offer is never read', async () => {
    const { service, select } = makeService({
      membershipError: new Error('membership read boom'),
    });

    await expect(
      service.getMyMembership(ORG_ID, USER_ID)
    ).rejects.toBeInstanceOf(InternalServiceError);
    expect(select).not.toHaveBeenCalled();
  });
});
