/**
 * An owner's copy of a leaving piece, against real Postgres (Codex-a6ofh.6.5,
 * design §7): `getLeavingDownload` and `getLeavingPrint`.
 *
 * Owners are a buyer not under dispute, someone given the piece (a stored
 * `content_purchase` or `grant`), and a buyer or grantee of a course one of
 * whose live stages holds it. Each of them gets a signed link to the original;
 * everyone else, and every piece that is not leaving or does not offer a
 * download, gets the SAME 404.
 *
 * R2 is a fake that records what it was asked to sign and knows which keys
 * it holds; the purchase read is the real `verifyPurchase`.
 *
 * Every row this file writes is deleted in `afterAll`: the database is shared
 * by every suite in the run.
 */

import { randomUUID } from 'node:crypto';
import {
  content,
  courseStages,
  courses,
  entitlements,
  mediaItems,
  organizationMemberships,
  organizations,
  purchases,
  stagePractices,
  subscriptions,
  subscriptionTiers,
  users,
} from '@codex/database/schema';
import { verifyPurchase } from '@codex/purchase';
import { InternalServiceError } from '@codex/service-errors';
import {
  createMockObservability,
  createTestContentInput,
  createTestMediaItemInput,
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  gateContentToTiers,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ContentNotFoundError, R2SigningError } from '../../errors';
import type { AccessRevocation } from '../access-revocation';
import { ContentAccessService } from '../ContentAccessService';

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number): Date => new Date(Date.now() - n * DAY);
const daysFromNow = (n: number): Date => new Date(Date.now() + n * DAY);

/** A piece a creator deleted while people owned it: off sale, 30 days left. */
const LEAVING = {
  status: 'draft',
  publishedAt: daysAgo(60),
  leavesAt: daysFromNow(30),
  leavingByCreator: true,
} as const;

describe('the leaving download and print view (Codex-a6ofh.6.5)', () => {
  let db: Database;
  let svc: ContentAccessService;
  let revokedSvc: ContentAccessService;
  let logs: ReturnType<typeof createMockObservability>['logs'];

  const signer = {
    generateSignedUrl: vi.fn(
      async (key: string, _expiry: number, _disposition?: string) =>
        `https://r2.test/${key}?X-Amz-Signature=stub`
    ),
    getObjectText: vi.fn(async () => null),
    objectExists: vi.fn(async (key: string) => stored.has(key)),
  };
  const stored = new Set<string>();
  // The real purchase read, watched: the owner reads' first arm.
  const purchaseRead = {
    verifyPurchase: vi.fn((contentId: string, customerId: string) =>
      verifyPurchase(db, contentId, customerId)
    ),
  };

  let orgId: string;
  const u: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const slugs: Record<string, string> = {};
  const r2Keys: Record<string, string> = {};
  const userIds: string[] = [];
  const contentIds: string[] = [];
  const mediaIds: string[] = [];
  const purchaseIds: string[] = [];
  const entitlementIds: string[] = [];
  let courseId: string;
  let tierId: string;

  async function media(
    key: string,
    overrides: Parameters<typeof createTestMediaItemInput>[1] = {}
  ): Promise<string> {
    const [row] = await db
      .insert(mediaItems)
      .values(
        createTestMediaItemInput(u.creator ?? '', {
          status: 'ready',
          fileSizeBytes: 1_500_000_000,
          ...overrides,
        })
      )
      .returning({ id: mediaItems.id, r2Key: mediaItems.r2Key });
    if (!row) throw new Error(`failed to seed media for ${key}`);
    mediaIds.push(row.id);
    r2Keys[key] = row.r2Key;
    return row.id;
  }

  async function piece(
    key: string,
    overrides: Parameters<typeof createTestContentInput>[1]
  ): Promise<string> {
    const [row] = await db
      .insert(content)
      .values(
        createTestContentInput(u.creator ?? '', {
          organizationId: orgId,
          isFree: false,
          isPurchasable: true,
          priceCents: 900,
          ...LEAVING,
          ...overrides,
        })
      )
      .returning({ id: content.id, slug: content.slug });
    if (!row) throw new Error(`failed to seed ${key}`);
    contentIds.push(row.id);
    ids[key] = row.id;
    slugs[key] = row.slug;
    return row.id;
  }

  /** A leaving video, its original in R2 unless `stored: false`. */
  async function video(
    key: string,
    overrides: Parameters<typeof createTestContentInput>[1] = {},
    mediaOverrides: Parameters<typeof createTestMediaItemInput>[1] = {},
    inR2 = true
  ): Promise<string> {
    const mediaItemId = await media(key, mediaOverrides);
    if (inR2) stored.add(r2Keys[key] ?? '');
    return piece(key, { contentType: 'video', mediaItemId, ...overrides });
  }

  async function buy(
    userId: string,
    contentId: string,
    disputedAt: Date | null = null
  ): Promise<string> {
    const [row] = await db
      .insert(purchases)
      .values({
        customerId: userId,
        contentId,
        organizationId: orgId,
        amountPaidCents: 900,
        currency: 'gbp',
        platformFeeCents: 0,
        organizationFeeCents: 0,
        creatorPayoutCents: 900,
        stripePaymentIntentId: `pi_${randomUUID()}`,
        status: 'completed',
        purchasedAt: daysAgo(40),
        createdAt: daysAgo(40),
        disputedAt,
      })
      .returning({ id: purchases.id });
    if (!row) throw new Error('failed to seed purchase');
    purchaseIds.push(row.id);
    return row.id;
  }

  async function entitle(
    values: Omit<typeof entitlements.$inferInsert, 'organizationId'>
  ): Promise<void> {
    const [row] = await db
      .insert(entitlements)
      .values({ organizationId: orgId, ...values })
      .returning({ id: entitlements.id });
    if (!row) throw new Error('failed to seed entitlement');
    entitlementIds.push(row.id);
  }

  beforeAll(async () => {
    db = setupTestDatabase();
    const names = [
      'creator',
      'buyer',
      'giftee',
      'grantee',
      'courseBuyer',
      'courseGrantee',
      'stranger',
      'disputer',
      'courseSubscriber',
      'tierSubscriber',
      'revokedGrantee',
      'expiredGrantee',
      'courseDisputer',
      'expiredCourseGrantee',
    ];
    const seeded = await seedTestUsers(db, names.length);
    names.forEach((name, i) => {
      const id = seeded[i];
      if (!id) throw new Error('failed to seed test users');
      u[name] = id;
      userIds.push(id);
    });

    const [org] = await db
      .insert(organizations)
      .values({ name: 'Leaving org', slug: createUniqueSlug('leaving') })
      .returning({ id: organizations.id });
    if (!org) throw new Error('failed to create org');
    orgId = org.id;
    // The creator is staff here: their team role plays the piece, and still
    // makes them no owner of it.
    await db.insert(organizationMemberships).values({
      userId: u.creator ?? '',
      organizationId: orgId,
      role: 'owner',
      status: 'active',
    });

    const mocked = createMockObservability();
    logs = mocked.logs;
    svc = new ContentAccessService({
      db,
      environment: 'test',
      r2: signer,
      purchaseService: purchaseRead,
    });
    // Test-only reach-in, as the sibling suites: capture the service's logs.
    (svc as unknown as { obs: typeof mocked.obs }).obs = mocked.obs;
    revokedSvc = new ContentAccessService({
      db,
      environment: 'test',
      r2: signer,
      purchaseService: purchaseRead,
      revocation: {
        isRevoked: async (userId: string) =>
          userId === u.buyer ? { reason: 'refund' } : null,
      } as unknown as AccessRevocation,
    });

    // Pieces.
    const leavingVideo = await video(
      'leavingVideo',
      {},
      {
        r2Key: `${u.creator}/originals/${randomUUID()}/session.MP4`,
      }
    );
    await video('noSize', {}, { fileSizeBytes: null });
    const notLeaving = await video('notLeaving', {
      status: 'published',
      leavesAt: null,
      leavingByCreator: false,
    });
    const settingOff = await video('settingOff', { ownersCanDownload: false });
    await video('otherPiece');
    const deleted = await video('deleted', { deletedAt: daysAgo(1) });
    const deletedMedia = await video(
      'deletedMedia',
      {},
      { deletedAt: daysAgo(1) }
    );
    const missingObject = await video('missingObject', {}, {}, false);
    const article = await piece('article', {
      contentType: 'written',
      contentBody: 'The whole essay.',
    });
    const articleOff = await piece('articleOff', {
      contentType: 'written',
      ownersCanDownload: false,
    });
    const personalArticle = await piece('personalArticle', {
      organizationId: null,
      contentType: 'written',
      contentBody: 'A personal essay.',
    });
    const tierPiece = await video('tierPiece', { isTierGated: true });

    // Owners of the leaving video, each one way.
    await buy(u.buyer ?? '', leavingVideo);
    await entitle({
      userId: u.giftee ?? '',
      contentId: leavingVideo,
      source: 'content_purchase',
    });
    await entitle({
      userId: u.grantee ?? '',
      contentId: leavingVideo,
      source: 'grant',
      grantedByUserId: u.creator,
    });
    // The buyer owns every other piece too, so each 404 below is the piece's.
    for (const id of [
      notLeaving,
      settingOff,
      deleted,
      deletedMedia,
      missingObject,
      article,
      articleOff,
      personalArticle,
    ]) {
      await buy(u.buyer ?? '', id);
    }
    await buy(u.buyer ?? '', ids.noSize ?? '');

    // A disputing buyer: the chargeback revoked the grant its purchase wrote.
    const disputed = await buy(u.disputer ?? '', leavingVideo, daysAgo(2));
    await entitle({
      userId: u.disputer ?? '',
      contentId: leavingVideo,
      source: 'content_purchase',
      sourceRef: disputed,
      revokedAt: daysAgo(2),
    });
    // A grant revoked, and one that expired.
    await entitle({
      userId: u.revokedGrantee ?? '',
      contentId: leavingVideo,
      source: 'grant',
      revokedAt: daysAgo(3),
    });
    await entitle({
      userId: u.expiredGrantee ?? '',
      contentId: leavingVideo,
      source: 'grant',
      expiresAt: daysAgo(1),
    });

    // A course whose live stage holds the leaving video.
    const [course] = await db
      .insert(courses)
      .values({
        organizationId: orgId,
        creatorId: u.creator ?? '',
        slug: createUniqueSlug('leaving-course'),
        title: 'Leaving course',
        status: 'published',
      })
      .returning({ id: courses.id });
    if (!course) throw new Error('failed to seed course');
    courseId = course.id;
    const [stage] = await db
      .insert(courseStages)
      .values({ courseId, name: 'Stage One', sortOrder: 1 })
      .returning({ id: courseStages.id });
    if (!stage) throw new Error('failed to seed stage');
    await db
      .insert(stagePractices)
      .values({ stageId: stage.id, contentId: leavingVideo, sortOrder: 0 });
    // A deleted stage that held the other piece: the course no longer does.
    const [deletedStage] = await db
      .insert(courseStages)
      .values({
        courseId,
        name: 'Stage Two',
        sortOrder: 2,
        deletedAt: daysAgo(1),
      })
      .returning({ id: courseStages.id });
    if (!deletedStage) throw new Error('failed to seed deleted stage');
    await db.insert(stagePractices).values({
      stageId: deletedStage.id,
      contentId: ids.otherPiece ?? '',
      sortOrder: 0,
    });
    await entitle({
      userId: u.courseBuyer ?? '',
      courseId,
      source: 'course_purchase',
    });
    await entitle({
      userId: u.courseGrantee ?? '',
      courseId,
      source: 'grant',
      grantedByUserId: u.creator,
    });
    await entitle({
      userId: u.courseSubscriber ?? '',
      courseId,
      source: 'course_subscription',
    });
    // A course buyer under dispute (the chargeback revoked the grant), and a
    // course grant that expired.
    await entitle({
      userId: u.courseDisputer ?? '',
      courseId,
      source: 'course_purchase',
      revokedAt: daysAgo(2),
    });
    await entitle({
      userId: u.expiredCourseGrantee ?? '',
      courseId,
      source: 'grant',
      expiresAt: daysAgo(1),
    });

    // A tier subscriber of a tier-gated leaving piece.
    const [tier] = await db
      .insert(subscriptionTiers)
      .values(createTestTierInput(orgId, { sortOrder: 1 }))
      .returning({ id: subscriptionTiers.id });
    if (!tier) throw new Error('failed to create tier');
    tierId = tier.id;
    await gateContentToTiers(db, {
      contentId: tierPiece,
      organizationId: orgId,
      tierIds: [tierId],
    });
    await db.insert(subscriptions).values(
      createTestSubscriptionInput(u.tierSubscriber ?? '', orgId, tierId, {
        currentPeriodStart: daysAgo(5),
        currentPeriodEnd: daysFromNow(25),
      })
    );
  });

  afterAll(async () => {
    if (db && orgId) {
      if (entitlementIds.length > 0) {
        await db
          .delete(entitlements)
          .where(inArray(entitlements.id, entitlementIds));
      }
      if (purchaseIds.length > 0) {
        await db.delete(purchases).where(inArray(purchases.id, purchaseIds));
      }
      if (courseId) {
        await db.delete(courses).where(inArray(courses.id, [courseId]));
      }
      await db
        .delete(subscriptions)
        .where(inArray(subscriptions.organizationId, [orgId]));
      if (contentIds.length > 0) {
        await db.delete(content).where(inArray(content.id, contentIds));
      }
      if (tierId) {
        await db
          .delete(subscriptionTiers)
          .where(inArray(subscriptionTiers.id, [tierId]));
      }
      if (mediaIds.length > 0) {
        await db.delete(mediaItems).where(inArray(mediaItems.id, mediaIds));
      }
      await db
        .delete(organizationMemberships)
        .where(inArray(organizationMemberships.organizationId, [orgId]));
      await db.delete(organizations).where(inArray(organizations.id, [orgId]));
      if (userIds.length > 0) {
        await db.delete(users).where(inArray(users.id, userIds));
      }
    }
    await teardownTestDatabase();
  });

  describe('the download', () => {
    it('gives a buyer a 15-minute link to the original, saved as the slug', async () => {
      signer.generateSignedUrl.mockClear();
      const before = Date.now();
      const download = await svc.getLeavingDownload(
        u.buyer ?? '',
        ids.leavingVideo ?? ''
      );

      // The extension is the original's, from its key, in lower case.
      const filename = `${slugs.leavingVideo}.mp4`;
      expect(download).toEqual({
        url: `https://r2.test/${r2Keys.leavingVideo}?X-Amz-Signature=stub`,
        filename,
        sizeBytes: 1_500_000_000,
        expiresAt: expect.any(String),
      });
      expect(signer.generateSignedUrl).toHaveBeenCalledWith(
        r2Keys.leavingVideo,
        900,
        `attachment;filename="${filename}"`
      );
      const expiresAt = Date.parse(download.expiresAt);
      expect(expiresAt).toBeGreaterThanOrEqual(before + 900_000);
      expect(expiresAt).toBeLessThanOrEqual(Date.now() + 900_000);
    });

    it.each([
      ['given it (a stored content purchase)', 'giftee'],
      ['granted it', 'grantee'],
      ['who bought a course that holds it', 'courseBuyer'],
      ['granted a course that holds it', 'courseGrantee'],
    ])('gives an owner %s the link too', async (_label, who) => {
      const download = await svc.getLeavingDownload(
        u[who] ?? '',
        ids.leavingVideo ?? ''
      );
      expect(download.url).toBe(
        `https://r2.test/${r2Keys.leavingVideo}?X-Amz-Signature=stub`
      );
      expect(download.filename).toBe(`${slugs.leavingVideo}.mp4`);
    });

    it('still downloads an original with no recorded size, without one', async () => {
      const download = await svc.getLeavingDownload(
        u.buyer ?? '',
        ids.noSize ?? ''
      );
      expect(download.sizeBytes).toBeNull();
      expect(download.url).toContain(r2Keys.noSize);
    });

    it.each([
      ['a stranger', 'stranger', 'leavingVideo'],
      ['a piece that is not leaving', 'buyer', 'notLeaving'],
      ['a piece whose creator turned downloads off', 'buyer', 'settingOff'],
      ['another leaving piece the buyer never bought', 'buyer', 'otherPiece'],
      [
        'its creator, a team member who never bought it',
        'creator',
        'leavingVideo',
      ],
      ['a deleted piece', 'buyer', 'deleted'],
      ['a buyer whose purchase is under dispute', 'disputer', 'leavingVideo'],
      ['a course subscriber', 'courseSubscriber', 'leavingVideo'],
      ['a course buyer under dispute', 'courseDisputer', 'leavingVideo'],
      ['an expired course grant', 'expiredCourseGrantee', 'leavingVideo'],
      [
        'a piece only a deleted stage of their course held',
        'courseBuyer',
        'otherPiece',
      ],
      ['a tier subscriber', 'tierSubscriber', 'tierPiece'],
      ['a revoked grant', 'revokedGrantee', 'leavingVideo'],
      ['an expired grant', 'expiredGrantee', 'leavingVideo'],
      ['an article, which prints instead', 'buyer', 'article'],
      ['a piece whose media was deleted', 'buyer', 'deletedMedia'],
      ['an original missing from R2', 'buyer', 'missingObject'],
    ])('is the one 404 for %s', async (_label, who, key) => {
      const contentId = ids[key] ?? '';
      const err = await svc
        .getLeavingDownload(u[who] ?? '', contentId)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ContentNotFoundError);
      expect(err).toMatchObject({
        statusCode: 404,
        message: 'Content not found',
        context: { contentId, code: 'CONTENT_NOT_FOUND' },
      });
    });

    it('warns when the original is missing from R2, naming no one', async () => {
      await svc
        .getLeavingDownload(u.buyer ?? '', ids.missingObject ?? '')
        .catch(() => undefined);
      const warning = logs.find(
        (l) =>
          l.level === 'warn' &&
          l.message === 'Leaving download: the original is missing from R2'
      );
      expect(warning?.data).toEqual({
        contentId: ids.missingObject,
        mediaItemId: expect.any(String),
      });
    });

    it('answers an R2 outage on the HEAD as a 500, never the refusal’s 404', async () => {
      signer.objectExists.mockRejectedValueOnce(new Error('R2 unreachable'));
      const err = await svc
        .getLeavingDownload(u.buyer ?? '', ids.leavingVideo ?? '')
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(InternalServiceError);
      expect(err).not.toBeInstanceOf(ContentNotFoundError);
      expect(err).toMatchObject({ statusCode: 500 });
      const line = logs.find(
        (l) =>
          l.level === 'error' &&
          l.message === 'Leaving download: R2 HEAD failed'
      );
      expect(line?.data).toEqual({
        contentId: ids.leavingVideo,
        mediaItemId: expect.any(String),
        errorMessage: 'R2 unreachable',
      });
    });

    it('logs the status a failed HEAD’s ServiceError carries', async () => {
      signer.objectExists.mockRejectedValueOnce(
        new InternalServiceError('dev-cdn HEAD failed', { status: 503 })
      );
      await svc
        .getLeavingDownload(u.buyer ?? '', ids.leavingVideo ?? '')
        .catch(() => undefined);
      const line = logs
        .filter(
          (l) =>
            l.level === 'error' &&
            l.message === 'Leaving download: R2 HEAD failed'
        )
        .at(-1);
      expect(line?.data).toMatchObject({
        contentId: ids.leavingVideo,
        errorMessage: 'dev-cdn HEAD failed',
        status: 503,
      });
    });

    it('answers a signing failure as an R2SigningError, logged with its ids', async () => {
      signer.generateSignedUrl.mockRejectedValueOnce(new Error('clock skew'));
      const err = await svc
        .getLeavingDownload(u.buyer ?? '', ids.leavingVideo ?? '')
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(R2SigningError);
      const line = logs.find(
        (l) =>
          l.level === 'error' &&
          l.message === 'Leaving download: signing failed'
      );
      expect(line?.data).toEqual({
        contentId: ids.leavingVideo,
        mediaItemId: expect.any(String),
        errorMessage: 'clock skew',
      });
    });

    it('runs the owner reads for every row it finds, offering or not, and none for a row it does not', async () => {
      purchaseRead.verifyPurchase.mockClear();
      await svc
        .getLeavingDownload(u.stranger ?? '', ids.notLeaving ?? '')
        .catch(() => undefined);
      expect(purchaseRead.verifyPurchase).toHaveBeenCalledWith(
        ids.notLeaving,
        u.stranger
      );

      purchaseRead.verifyPurchase.mockClear();
      await svc
        .getLeavingDownload(u.stranger ?? '', ids.deleted ?? '')
        .catch(() => undefined);
      expect(purchaseRead.verifyPurchase).not.toHaveBeenCalled();
    });

    it('is the one 404 for a buyer the KV block list has revoked', async () => {
      await expect(
        revokedSvc.getLeavingDownload(u.buyer ?? '', ids.leavingVideo ?? '')
      ).rejects.toThrow(ContentNotFoundError);
      // Another owner in the same org is not blocked.
      await expect(
        revokedSvc.getLeavingDownload(u.giftee ?? '', ids.leavingVideo ?? '')
      ).resolves.toMatchObject({ filename: `${slugs.leavingVideo}.mp4` });
    });
  });

  describe('the print view', () => {
    it('gives an owner a leaving article by its org key', async () => {
      const print = await svc.getLeavingPrint(u.buyer ?? '', {
        orgId,
        slug: slugs.article ?? '',
      });
      expect(print).toEqual({
        contentId: ids.article,
        title: expect.any(String),
        creatorName: expect.any(String),
        body: { contentBody: 'The whole essay.', contentBodyJson: null },
      });
    });

    it('gives an owner a personal article by its creator, and never by an org', async () => {
      const print = await svc.getLeavingPrint(u.buyer ?? '', {
        creatorId: u.creator ?? '',
        slug: slugs.personalArticle ?? '',
      });
      expect(print.body.contentBody).toBe('A personal essay.');

      await expect(
        svc.getLeavingPrint(u.buyer ?? '', {
          orgId,
          slug: slugs.personalArticle ?? '',
        })
      ).rejects.toThrow(ContentNotFoundError);
    });

    it.each([
      ['a stranger', 'stranger', 'article'],
      ['an article whose creator turned downloads off', 'buyer', 'articleOff'],
      ['a video, which downloads instead', 'buyer', 'leavingVideo'],
      ['a piece that is not leaving', 'buyer', 'notLeaving'],
    ])('is the one 404 for %s', async (_label, who, key) => {
      const slug = slugs[key] ?? '';
      const err = await svc
        .getLeavingPrint(u[who] ?? '', { orgId, slug })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ContentNotFoundError);
      expect(err).toMatchObject({
        statusCode: 404,
        context: { contentId: slug },
      });
    });

    it('logs the key it was sent when no row matches, and never who sent it', async () => {
      await svc
        .getLeavingPrint(u.stranger ?? '', { orgId, slug: 'no-such-piece' })
        .catch(() => undefined);
      await svc
        .getLeavingPrint(u.stranger ?? '', {
          creatorId: u.creator ?? '',
          slug: 'no-such-essay',
        })
        .catch(() => undefined);
      const lines = logs
        .filter(
          (l) =>
            l.message === 'Leaving download refused' &&
            (l.data as { reason?: string }).reason === 'not-found'
        )
        .slice(-2)
        .map((l) => l.data);
      expect(lines).toEqual([
        {
          contentId: null,
          reason: 'not-found',
          slug: 'no-such-piece',
          orgId,
        },
        {
          contentId: null,
          reason: 'not-found',
          slug: 'no-such-essay',
          creatorId: u.creator,
        },
      ]);
    });

    it('is the one 404 for a buyer the KV block list has revoked', async () => {
      await expect(
        revokedSvc.getLeavingPrint(u.buyer ?? '', {
          orgId,
          slug: slugs.article ?? '',
        })
      ).rejects.toThrow(ContentNotFoundError);
    });
  });
});
