/**
 * cleanupDatabase and cleanupDatabaseComplete against the RESTRICT children
 * batch C1 added (migration review M1): price changes and price moves (0124)
 * and a fee notice's marker (0123). A child the helpers miss makes a later
 * suite's cleanup fail with 23503 on a table it never touched.
 *
 * Real database. Both helpers refuse anything but a disposable one (CI's
 * `neondb`, the local `main_test`), so on a throwaway `b_*` database this file
 * fails at the guard, as every caller of the helpers does.
 */

import {
  feeChangeNotices,
  feeChanges,
  organizations,
  priceChanges,
  subscriptionPriceMoves,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanupDatabase,
  cleanupDatabaseComplete,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '../database';
import { createTestOrganizationInput, createUniqueSlug } from '../factories';
import {
  createTestSubscriptionInput,
  createTestTierInput,
} from '../subscription-factories';

describe('the cleanup helpers clear what C1 added first', () => {
  let db: Database;
  const platformChangeIds: string[] = [];

  beforeAll(() => {
    db = setupTestDatabase();
  });

  afterAll(async () => {
    // A platform change hangs off no organisation, so nothing above removes it.
    for (const id of platformChangeIds) {
      await db.delete(feeChanges).where(eq(feeChanges.id, id));
    }
    await teardownTestDatabase();
  });

  /**
   * An organisation's tier and subscriber, a price change that superseded an
   * older one, and the subscriber's move.
   */
  async function priceMove(): Promise<{ organizationId: string }> {
    const [ownerId, memberId] = (await seedTestUsers(db, 2)) as [
      string,
      string,
    ];
    const [org] = await db
      .insert(organizations)
      .values(
        createTestOrganizationInput({ slug: createUniqueSlug('cleanup') })
      )
      .returning({ id: organizations.id });
    const organizationId = org?.id as string;
    const [tier] = await db
      .insert(subscriptionTiers)
      .values(createTestTierInput(organizationId))
      .returning({ id: subscriptionTiers.id });
    const tierId = tier?.id as string;
    const [subscription] = await db
      .insert(subscriptions)
      .values(createTestSubscriptionInput(memberId, organizationId, tierId))
      .returning({
        id: subscriptions.id,
        stripeSubscriptionId: subscriptions.stripeSubscriptionId,
      });
    const now = new Date();
    const change = {
      organizationId,
      kind: 'tier',
      tierId,
      interval: 'month',
      fromAmountCents: 499,
      createdByUserId: ownerId,
    };
    const [newer] = await db
      .insert(priceChanges)
      .values({
        ...change,
        newAmountCents: 699,
        newStripePriceId: 'price_cleanup_newer',
        state: 'done',
        doneAt: now,
      })
      .returning({ id: priceChanges.id });
    await db.insert(priceChanges).values({
      ...change,
      newAmountCents: 599,
      newStripePriceId: 'price_cleanup_older',
      state: 'superseded',
      supersededById: newer?.id,
      supersededAt: now,
    });
    await db.insert(subscriptionPriceMoves).values({
      priceChangeId: newer?.id as string,
      subscriptionId: subscription?.id,
      stripeSubscriptionId: subscription?.stripeSubscriptionId as string,
      organizationId,
      userId: memberId,
    });
    return { organizationId };
  }

  it('cleanupDatabase deletes price moves and price changes before the subscriptions and organisations they RESTRICT', async () => {
    const { organizationId } = await priceMove();

    await expect(cleanupDatabase(db)).resolves.toBeUndefined();

    expect(
      await db
        .select({ id: priceChanges.id })
        .from(priceChanges)
        .where(eq(priceChanges.organizationId, organizationId))
    ).toEqual([]);
    expect(
      await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
    ).toEqual([]);
  });

  it('cleanupDatabaseComplete also deletes a fee notice before the support user who marked it', async () => {
    await priceMove();
    // Support first, as suites seed them. Every user goes in ONE delete, and
    // the marker's RESTRICT is checked row by row: a marker deleted before the
    // person (whose notice cascades) finds the notice still there.
    const [supportId, personId] = (await seedTestUsers(db, 2)) as [
      string,
      string,
    ];
    // A platform rise (no organisation to go with), off already, whose notice
    // support marked told another way.
    const [change] = await db
      .insert(feeChanges)
      .values({
        scope: 'platform',
        kind: 'rise',
        voidedAt: new Date(),
        voidReason: 'cancelled',
      })
      .returning({ id: feeChanges.id });
    const changeId = change?.id as string;
    platformChangeIds.push(changeId);
    await db.insert(feeChangeNotices).values({
      changeId,
      userId: personId,
      kind: 'announce',
      onList: true,
      roles: [{ organizationId: null, as: 'creator' }],
      beforeValues: [],
      afterValues: [],
      state: 'told_another_way',
      toldByUserId: supportId,
      toldAt: new Date(),
      toldNote: 'Phoned',
    });

    await expect(cleanupDatabaseComplete(db)).resolves.toBeUndefined();

    expect(
      await db
        .select({ id: feeChangeNotices.id })
        .from(feeChangeNotices)
        .where(eq(feeChangeNotices.changeId, changeId))
    ).toEqual([]);
  });
});
