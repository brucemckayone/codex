/**
 * ContentService.get carries `holderCount` (Codex-a6ofh.6, owner 2026-11-20):
 * the editor's Delete says how many people own the piece, the count the
 * studio list's rows carry (`holderCountsOf`), so the two can't disagree.
 *
 * Database: a real Postgres (the throwaway lane database locally, the CI
 * branch in CI). Every row it makes is its own, and deleted in afterAll.
 */

import { randomUUID } from 'node:crypto';
import {
  content,
  entitlements,
  purchases,
  users,
} from '@codex/database/schema';
import {
  createTestContentInput,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContentService } from '../content-service';

describe('ContentService.get: holderCount', () => {
  let db: Database;
  let service: ContentService;
  let creatorId: string;
  let buyerId: string;
  let otherBuyerId: string;
  let erasedId: string;
  const contentIds: string[] = [];
  const purchaseIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new ContentService({ db, environment: 'test' });
    [creatorId, buyerId, otherBuyerId, erasedId] = await seedTestUsers(db, 4);
  });

  afterAll(async () => {
    if (purchaseIds.length > 0) {
      await db.delete(purchases).where(inArray(purchases.id, purchaseIds));
    }
    if (contentIds.length > 0) {
      await db
        .delete(entitlements)
        .where(inArray(entitlements.contentId, contentIds));
      await db.delete(content).where(inArray(content.id, contentIds));
    }
    await teardownTestDatabase();
  });

  async function piece() {
    const row = takeFirst(
      await db
        .insert(content)
        .values(
          createTestContentInput(creatorId, {
            contentType: 'written',
            title: `Held ${randomUUID().slice(0, 8)}`,
            status: 'published',
            publishedAt: new Date(),
          })
        )
        .returning()
    );
    contentIds.push(row.id);
    return row;
  }

  async function bought(contentId: string, customerId: string) {
    const row = takeFirst(
      await db
        .insert(purchases)
        .values({
          customerId,
          contentId,
          amountPaidCents: 900,
          currency: 'gbp',
          platformFeeCents: 0,
          organizationFeeCents: 0,
          creatorPayoutCents: 900,
          stripePaymentIntentId: `pi_${randomUUID()}`,
          status: 'completed',
          purchasedAt: new Date(),
        })
        .returning({ id: purchases.id })
    );
    purchaseIds.push(row.id);
  }

  it('is 0 for a piece nobody holds', async () => {
    const row = await piece();

    const read = await service.get(row.id, creatorId);

    expect(read?.holderCount).toBe(0);
  });

  it('counts each person once, bought or given, and leaves out an erased account', async () => {
    const row = await piece();
    await bought(row.id, buyerId);
    // Given it too: still one person.
    await db
      .insert(entitlements)
      .values({ userId: buyerId, contentId: row.id, source: 'grant' });
    await db
      .insert(entitlements)
      .values({ userId: otherBuyerId, contentId: row.id, source: 'grant' });
    await bought(row.id, erasedId);
    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, erasedId));

    const read = await service.get(row.id, creatorId);

    expect(read?.holderCount).toBe(2);
  });
});
