/**
 * `creator-connect-needed` goes for the FIRST waiting sale of an episode only
 * (Codex-2hxff.34, Q5; batch B design §5.3; mock-b-studio emails.html M4).
 *
 * Before, every one-off sale made while a creator had no payable Connect
 * account emailed them. Now the email is claimed on `money_notices` under the
 * creator's oldest waiting payout row: the first sale of an episode sends,
 * later ones don't (the monthly `payouts-waiting` reminder takes over), and
 * once the money drains the next waiting row starts a new episode. Two sales
 * at the same moment pick the same oldest row, so only one email goes. The
 * greeting is the creator's name, else "there", never their address.
 *
 * Real DB, mocked Stripe. Every row hangs off this file's own users and
 * organisation and is deleted in afterAll: payout rows feed global drains.
 */

import { randomUUID } from 'node:crypto';
import {
  content,
  contentAccess,
  emailTemplates,
  entitlements,
  moneyNotices,
  organizations,
  payouts,
  purchases,
  stripeConnectAccounts,
  users,
} from '@codex/database/schema';
import {
  createMockStripe,
  createTestContentInput,
  createTestMoneyDeps,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq, inArray } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';
import type { FeeConfigService } from '../services/fee-config-service';
import {
  type PurchaseMailer,
  PurchaseService,
} from '../services/purchase-service';

const PRICE = 1000;
/** No organisation slice, so the creator's slice is the only one waiting. */
const FEES = {
  platformFeePercent: 1000,
  orgFeePercent: 0,
  minPlatformFeeCents: 0,
  minTransferCents: 0,
};

const uid = () => randomUUID().slice(0, 8);

describe('creator-connect-needed: the first waiting sale only (Codex-2hxff.34)', () => {
  let db: Database;
  let buyerId: string;
  let orgId: string;
  const creatorIds: string[] = [];
  const contentIds: string[] = [];

  const feeConfig = {
    getFeesForCreator: vi.fn(async () => FEES),
    getFeesForOrg: vi.fn(async () => FEES),
    getFeesPlatform: vi.fn(async () => FEES),
  } as unknown as FeeConfigService;

  function service(
    mailer: Mock<PurchaseMailer>,
    templateExists?: () => Promise<boolean>
  ): PurchaseService {
    return new PurchaseService(
      {
        db,
        environment: 'test',
        ...createTestMoneyDeps(),
        feeConfig,
        mailer,
        templateExists,
      },
      createMockStripe()
    );
  }

  beforeAll(async () => {
    db = setupTestDatabase();
    // The seed's own global template, as an environment the seed has run on
    // has it: the service checks it before claiming. Left in place (other
    // files rely on it the same way); a re-insert is a no-op.
    await db
      .insert(emailTemplates)
      .values({
        name: 'creator-connect-needed',
        scope: 'global',
        subject: 'Money is waiting',
        htmlBody: '<p>{{creatorName}}</p>',
        textBody: '{{creatorName}}',
        status: 'active',
      })
      .onConflictDoNothing();
    [buyerId] = (await seedTestUsers(db, 1)) as [string];
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values({
          name: 'First Sale Org',
          slug: createUniqueSlug('first-sale'),
        })
        .returning()
    ).id;
  });

  afterAll(async () => {
    const purchaseIds = (
      await db
        .select({ id: purchases.id })
        .from(purchases)
        .where(eq(purchases.customerId, buyerId))
    ).map((row) => row.id);
    if (purchaseIds.length > 0) {
      await db.delete(payouts).where(inArray(payouts.purchaseId, purchaseIds));
    }
    if (creatorIds.length > 0) {
      await db
        .delete(moneyNotices)
        .where(inArray(moneyNotices.userId, creatorIds));
      await db
        .delete(stripeConnectAccounts)
        .where(inArray(stripeConnectAccounts.userId, creatorIds));
    }
    await db.delete(entitlements).where(eq(entitlements.userId, buyerId));
    await db.delete(contentAccess).where(eq(contentAccess.userId, buyerId));
    await db.delete(purchases).where(eq(purchases.customerId, buyerId));
    if (contentIds.length > 0) {
      await db.delete(content).where(inArray(content.id, contentIds));
    }
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await db.delete(users).where(inArray(users.id, [...creatorIds, buyerId]));
    await teardownTestDatabase();
  });

  /** A creator with no Connect account, so every sale of theirs waits. */
  async function creator(name: string): Promise<string> {
    const [id] = await seedTestUsers(db, 1);
    creatorIds.push(id);
    await db.update(users).set({ name }).where(eq(users.id, id));
    return id;
  }

  async function sell(
    creatorId: string,
    mailer: Mock<PurchaseMailer>,
    templateExists?: () => Promise<boolean>
  ) {
    const item = takeFirst(
      await db
        .insert(content)
        .values(
          createTestContentInput(creatorId, {
            organizationId: orgId,
            contentType: 'written',
            slug: createUniqueSlug('first-sale-content'),
          })
        )
        .returning()
    );
    contentIds.push(item.id);
    const chargeId = `ch_first_sale_${uid()}`;
    await service(mailer, templateExists).completePurchase(
      `pi_first_sale_${uid()}`,
      {
        contentId: item.id,
        customerId: buyerId,
        organizationId: orgId,
        amountPaidCents: PRICE,
        currency: 'gbp',
        stripeChargeId: chargeId,
      }
    );
    const [slice] = await db
      .select()
      .from(payouts)
      .where(
        and(
          eq(payouts.stripeChargeId, chargeId),
          eq(payouts.payoutType, 'creator_payout')
        )
      );
    if (!slice) throw new Error('creator slice not recorded');
    expect(slice.status).toBe('pending');
    expect(slice.reason).toBe('connect_not_ready');
    return slice;
  }

  const noticesOf = (userId: string) =>
    db
      .select()
      .from(moneyNotices)
      .where(
        and(
          eq(moneyNotices.userId, userId),
          eq(moneyNotices.kind, 'connect_needed_first')
        )
      );

  it('the first waiting sale emails, greeting by name; the next sale does not', async () => {
    const creatorId = await creator('Jonah Reyes');
    const mailer = vi.fn<PurchaseMailer>();

    const first = await sell(creatorId, mailer);
    await sell(creatorId, mailer);

    expect(mailer).toHaveBeenCalledOnce();
    const [params] = mailer.mock.calls[0]!;
    expect(params.templateName).toBe('creator-connect-needed');
    expect(params.userId).toBe(creatorId);
    expect(params.data.creatorName).toBe('Jonah Reyes');
    expect(params.data.amountFormatted).toBe('£9.00');
    // Earnings is on the creators subdomain: the bare domain's
    // /studio/earnings is a 404. 'test' routes like local development.
    expect(params.data.dashboardUrl).toBe(
      'http://creators.lvh.me:3000/studio/earnings'
    );
    const notices = await noticesOf(creatorId);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.periodKey).toBe(`episode:${first.id}`);
    expect(notices[0]?.amountCents).toBe(900);
    expect(notices[0]?.sentAt).not.toBeNull();
  });

  it('greets "there" when the creator has no name, never their email address', async () => {
    const creatorId = await creator('   ');
    const mailer = vi.fn<PurchaseMailer>();

    await sell(creatorId, mailer);

    expect(mailer).toHaveBeenCalledOnce();
    const [params] = mailer.mock.calls[0]!;
    expect(params.data.creatorName).toBe('there');
    expect(params.data.creatorName).not.toContain('@');
  });

  it('two sales at the same moment send one email', async () => {
    const creatorId = await creator('Maya Okafor');
    const mailer = vi.fn<PurchaseMailer>();

    await Promise.all([sell(creatorId, mailer), sell(creatorId, mailer)]);

    expect(mailer).toHaveBeenCalledOnce();
    expect(await noticesOf(creatorId)).toHaveLength(1);
  });

  it('once the waiting money drains, the next waiting sale starts a new episode and emails again', async () => {
    const creatorId = await creator('Tom Ellison');
    const mailer = vi.fn<PurchaseMailer>();

    const first = await sell(creatorId, mailer);
    // As the drain leaves it once paid: no longer waiting.
    await db
      .update(payouts)
      .set({
        status: 'paid',
        reason: null,
        stripeTransferId: `tr_first_sale_${uid()}`,
        resolvedAt: new Date(),
      })
      .where(eq(payouts.id, first.id));
    const second = await sell(creatorId, mailer);

    expect(mailer).toHaveBeenCalledTimes(2);
    expect((await noticesOf(creatorId)).map((n) => n.periodKey).sort()).toEqual(
      [`episode:${first.id}`, `episode:${second.id}`].sort()
    );
  });

  it('a missing template claims nothing, so the episode is not burned (LOW-4)', async () => {
    const creatorId = await creator('Ella Wright');
    const mailer = vi.fn<PurchaseMailer>();

    await sell(creatorId, mailer, async () => false);
    expect(mailer).not.toHaveBeenCalled();
    expect(await noticesOf(creatorId)).toEqual([]);

    // Once the seed has run, the same episode's next sale still emails.
    await sell(creatorId, mailer);
    expect(mailer).toHaveBeenCalledOnce();
  });
});
