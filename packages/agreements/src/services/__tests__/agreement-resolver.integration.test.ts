/**
 * `agreementsInForce` — the one rule every payment path reads for which
 * revenue-share agreements apply at a moment (docs/payments/agreements.md
 * §How a share applies; architecture.md WP4) — and
 * `terminateAgreementsOnDeparture`, which ends a removed member's agreements.
 *
 * Owner decisions pinned here:
 * - AGR-01 "Keeps paying" (Codex-2hxff.17): the review date is not an expiry.
 * - AGR-09 "End on removal" (Codex-2hxff.18): a removed creator's agreements
 *   end then, and money earned before is still paid, even when its webhook
 *   lands after the removal.
 */

import { schema } from '@codex/database';
import {
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { terminateAgreementsOnDeparture } from '../agreement-departure';
import { agreementsInForce } from '../agreement-resolver';

const AT = new Date('2026-06-15T12:00:00Z');
const day = (offset: number) => new Date(AT.getTime() + offset * 86_400_000);

describe('agreementsInForce', () => {
  let db: Database;

  beforeAll(() => {
    db = setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  async function org() {
    const [ownerId, creatorA, creatorB] = await seedTestUsers(db, 3);
    const [row] = await db
      .insert(schema.organizations)
      .values({ name: 'Resolver Org', slug: createUniqueSlug('resolver') })
      .returning();
    if (!row || !ownerId || !creatorA || !creatorB) throw new Error('fixture');
    await db.insert(schema.organizationMemberships).values([
      {
        organizationId: row.id,
        userId: ownerId,
        role: 'owner',
        status: 'active',
      },
      {
        organizationId: row.id,
        userId: creatorA,
        role: 'creator',
        status: 'active',
      },
      {
        organizationId: row.id,
        userId: creatorB,
        role: 'creator',
        status: 'active',
      },
    ]);
    return { orgId: row.id, ownerId, creatorA, creatorB };
  }

  /** An agreement and (unless `withProposal: false`) the proposal it points at. */
  async function agreement(
    fx: { orgId: string; ownerId: string },
    params: {
      creatorId: string;
      share: number;
      revenueType?: 'subscription' | 'content_purchase';
      effectiveFrom?: Date;
      effectiveUntil?: Date | null;
      terminatedAt?: Date | null;
      createdAt?: Date;
      withProposal?: boolean;
    }
  ) {
    const revenueType = params.revenueType ?? 'subscription';
    const effectiveFrom = params.effectiveFrom ?? day(-60);
    let proposalId: string | null = null;
    if (params.withProposal !== false) {
      const [proposal] = await db
        .insert(schema.agreementProposals)
        .values({
          organizationId: fx.orgId,
          creatorId: params.creatorId,
          revenueType,
          roundNumber: 1,
          proposedByUserId: fx.ownerId,
          proposedByRole: 'owner',
          proposedCreatorSharePercent: params.share,
          proposedEffectiveFrom: effectiveFrom,
          status: 'accepted',
        })
        .returning();
      proposalId = proposal?.id ?? null;
    }
    const [row] = await db
      .insert(schema.creatorOrganizationAgreements)
      .values({
        organizationId: fx.orgId,
        creatorId: params.creatorId,
        organizationFeePercentage: 10_000 - params.share,
        revenueType,
        status: params.terminatedAt ? 'terminated' : 'active',
        terminatedAt: params.terminatedAt ?? null,
        effectiveFrom,
        effectiveUntil: params.effectiveUntil ?? null,
        currentProposalId: proposalId,
        ...(params.createdAt ? { createdAt: params.createdAt } : {}),
      })
      .returning();
    if (!row) throw new Error('agreement not inserted');
    return row;
  }

  const resolve = (
    orgId: string,
    extra: Partial<Parameters<typeof agreementsInForce>[1]> = {}
  ) =>
    agreementsInForce(db, {
      organizationId: orgId,
      revenueType: 'subscription',
      at: AT,
      ...extra,
    });

  it('keeps paying past the review date: the term is not an expiry (AGR-01)', async () => {
    const fx = await org();
    await agreement(fx, {
      creatorId: fx.creatorA,
      share: 3000,
      effectiveUntil: day(-10),
    });

    expect(await resolve(fx.orgId)).toEqual([
      expect.objectContaining({ creatorId: fx.creatorA, sharePercent: 3000 }),
    ]);
  });

  it('a termination after the sale still pays it; one before does not (no pro-rating)', async () => {
    const fx = await org();
    await agreement(fx, {
      creatorId: fx.creatorA,
      share: 2000,
      terminatedAt: day(1),
    });
    await agreement(fx, {
      creatorId: fx.creatorB,
      share: 2500,
      terminatedAt: day(-1),
    });

    const inForce = await resolve(fx.orgId);
    expect(inForce.map((a) => a.creatorId)).toEqual([fx.creatorA]);
  });

  it('an agreement taking effect after the sale does not apply', async () => {
    const fx = await org();
    await agreement(fx, {
      creatorId: fx.creatorA,
      share: 2000,
      effectiveFrom: day(5),
    });

    expect(await resolve(fx.orgId)).toEqual([]);
  });

  it("an agreement with no proposal linked is logged, and pays nothing rather than a newer agreement's rate", async () => {
    const fx = await org();
    // In force at the sale, but its proposal is gone (ON DELETE SET NULL).
    const orphan = await agreement(fx, {
      creatorId: fx.creatorA,
      share: 2000,
      withProposal: false,
      terminatedAt: day(0),
      createdAt: day(-90),
    });
    // Its successor matches too, mid-renegotiation, but was not yet in force.
    await agreement(fx, {
      creatorId: fx.creatorA,
      share: 4000,
      effectiveFrom: day(-5),
      createdAt: day(0),
    });
    const obs = { warn: vi.fn() };

    expect(await resolve(fx.orgId, { at: day(-1), obs })).toEqual([]);
    expect(obs.warn).toHaveBeenCalledWith(
      'agreement has no current proposal; skipped',
      expect.objectContaining({ agreementId: orphan.id })
    );
  });

  it('mid-renegotiation the agreement in force at the sale wins, deterministically, on both sides of the acceptance', async () => {
    const fx = await org();
    const acceptedAt = day(0);
    // The old agreement ends when the new one is accepted; the new one takes
    // effect from when it was proposed, before the acceptance.
    await agreement(fx, {
      creatorId: fx.creatorA,
      share: 2000,
      terminatedAt: acceptedAt,
      createdAt: day(-90),
    });
    await agreement(fx, {
      creatorId: fx.creatorA,
      share: 4000,
      effectiveFrom: day(-5),
      createdAt: acceptedAt,
    });

    const before = await resolve(fx.orgId, { at: day(-1) });
    const after = await resolve(fx.orgId, { at: day(1) });

    expect(before).toEqual([expect.objectContaining({ sharePercent: 2000 })]);
    expect(after).toEqual([expect.objectContaining({ sharePercent: 4000 })]);
  });

  it('scopes to the revenue type, and narrows to one creator when asked', async () => {
    const fx = await org();
    await agreement(fx, { creatorId: fx.creatorA, share: 2000 });
    await agreement(fx, { creatorId: fx.creatorB, share: 3000 });
    await agreement(fx, {
      creatorId: fx.creatorA,
      share: 5000,
      revenueType: 'content_purchase',
    });

    expect(await resolve(fx.orgId)).toHaveLength(2);
    expect(await resolve(fx.orgId, { creatorId: fx.creatorB })).toEqual([
      expect.objectContaining({ creatorId: fx.creatorB, sharePercent: 3000 }),
    ]);
    expect(
      await resolve(fx.orgId, { revenueType: 'content_purchase' })
    ).toEqual([
      expect.objectContaining({ creatorId: fx.creatorA, sharePercent: 5000 }),
    ]);
  });

  describe('terminateAgreementsOnDeparture (AGR-09)', () => {
    it("ends the creator's active agreements in that organisation at that moment, and only those", async () => {
      const fx = await org();
      const other = await org();
      await agreement(fx, { creatorId: fx.creatorA, share: 2000 });
      await agreement(fx, {
        creatorId: fx.creatorA,
        share: 3000,
        revenueType: 'content_purchase',
      });
      // Ended long before: its end date must not move, or the sales between
      // the two dates would start paying it again.
      const earlier = await agreement(fx, {
        creatorId: fx.creatorA,
        share: 1500,
        effectiveFrom: day(-120),
        terminatedAt: day(-30),
        createdAt: day(-120),
      });
      const sibling = await agreement(fx, {
        creatorId: fx.creatorB,
        share: 2500,
      });
      // The same creator in another organisation they still belong to.
      const elsewhere = await agreement(other, {
        creatorId: fx.creatorA,
        share: 1000,
      });

      const ended = await terminateAgreementsOnDeparture(db, {
        organizationId: fx.orgId,
        creatorId: fx.creatorA,
        at: AT,
      });

      expect(ended).toHaveLength(2);
      for (const row of ended) {
        expect(row.status).toBe('terminated');
        expect(row.terminatedAt?.getTime()).toBe(AT.getTime());
        expect(row.terminatedByUserId).toBeNull();
      }
      const rowOf = async (id: string) =>
        (
          await db
            .select({
              status: schema.creatorOrganizationAgreements.status,
              terminatedAt: schema.creatorOrganizationAgreements.terminatedAt,
            })
            .from(schema.creatorOrganizationAgreements)
            .where(eq(schema.creatorOrganizationAgreements.id, id))
        )[0];
      expect((await rowOf(earlier.id))?.terminatedAt?.getTime()).toBe(
        day(-30).getTime()
      );
      expect((await rowOf(sibling.id))?.status).toBe('active');
      expect((await rowOf(elsewhere.id))?.status).toBe('active');
    });

    it('money earned before the removal is still paid, even when its webhook lands after; nothing after it is', async () => {
      const fx = await org();
      await agreement(fx, { creatorId: fx.creatorA, share: 2000 });
      // The whole removal: membership ended, agreements terminated at AT.
      await db
        .update(schema.organizationMemberships)
        .set({ status: 'inactive' })
        .where(
          and(
            eq(schema.organizationMemberships.organizationId, fx.orgId),
            eq(schema.organizationMemberships.userId, fx.creatorA)
          )
        );
      await terminateAgreementsOnDeparture(db, {
        organizationId: fx.orgId,
        creatorId: fx.creatorA,
        at: AT,
      });

      // Resolved now, after the removal, for an invoice raised before it.
      expect(await resolve(fx.orgId, { at: day(-1) })).toEqual([
        expect.objectContaining({ creatorId: fx.creatorA, sharePercent: 2000 }),
      ]);
      expect(await resolve(fx.orgId, { at: day(1) })).toEqual([]);
    });
  });
});
