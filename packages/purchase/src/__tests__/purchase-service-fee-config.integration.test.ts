/**
 * PurchaseService × FeeConfigService integration tests (Codex-m644n PR #182).
 *
 * Exercises the call-site contract:
 *   completePurchase() — when given a FeeConfigService, resolves fees via
 *   getFeesForCreator(orgId, creatorId, 'one_off'), applies the min-platform
 *   floor when the percentage is under it, and stores the resulting split.
 *
 * Uses the shared Neon test DB (real schema), seeded by `setupTestDatabase()`.
 * No real Stripe calls — Stripe is mocked the same way the parent suite does.
 *
 * NOTE: We intentionally do NOT mutate any of the new fee_config_* tables in
 * this file. The FeeConfigService is mocked at the method level so we control
 * the resolved FeeConfig returned to PurchaseService without depending on the
 * order of FeeConfigService.upsert*() integration tests.
 */

import { ContentService, MediaItemService } from '@codex/content';
import { organizations } from '@codex/database/schema';
import {
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import type Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FeeConfigService } from '../services/fee-config-service';
import { PurchaseService } from '../services/purchase-service';

interface FeeConfigShape {
  platformFeePercent: number;
  orgFeePercent: number;
  minPlatformFeeCents: number;
  minTransferCents: number;
}

function makeFeeConfigStub(fees: FeeConfigShape) {
  return {
    getFeesForCreator: vi.fn(async () => fees),
    getFeesForOrg: vi.fn(async () => fees),
    getFeesPlatform: vi.fn(async () => fees),
  } as unknown as FeeConfigService;
}

describe('PurchaseService × FeeConfigService integration', () => {
  let db: Database;
  let contentService: ContentService;
  let mediaService: MediaItemService;
  let mockStripe: Stripe;
  let creatorId: string;
  let customerId: string;
  let organizationId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    const config = { db, environment: 'test' };

    contentService = new ContentService(config);
    mediaService = new MediaItemService(config);

    mockStripe = {
      checkout: { sessions: { create: vi.fn(), retrieve: vi.fn() } },
      paymentIntents: { retrieve: vi.fn() },
      customers: { list: vi.fn(), create: vi.fn() },
      billingPortal: { sessions: { create: vi.fn() } },
    } as unknown as Stripe;

    const userIds = await seedTestUsers(db, 2);
    [creatorId, customerId] = userIds;

    const [org] = await db
      .insert(organizations)
      .values({
        name: 'Fee Config Test Org',
        slug: createUniqueSlug('fee-config-test-org'),
        ownerId: creatorId,
      })
      .returning();
    if (!org) throw new Error('Failed to create test organization');
    organizationId = org.id;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  /** Create a published priced content owned by `creatorId`. */
  async function makePaidContent(priceCents: number, label: string) {
    const media = await mediaService.create(
      {
        title: `${label} media`,
        mediaType: 'video',
        mimeType: 'video/mp4',
        fileSizeBytes: 1024,
      },
      creatorId
    );
    await mediaService.markAsReady(
      media.id,
      {
        hlsMasterPlaylistKey: `hls/${createUniqueSlug(label)}/master.m3u8`,
        thumbnailKey: `thumbnails/${createUniqueSlug(label)}.jpg`,
        durationSeconds: 60,
      },
      creatorId
    );
    const content = await contentService.create(
      {
        organizationId,
        title: label,
        slug: createUniqueSlug(label),
        contentType: 'video',
        mediaItemId: media.id,
        visibility: 'purchased_only',
        accessType: 'paid',
        priceCents,
      },
      creatorId
    );
    await contentService.publish(content.id, creatorId);
    return content;
  }

  it('one-off purchase applies the per-creator platformFeePercent override', async () => {
    // 12% platform, 0% org → creator gets 88%.
    const feeConfig = makeFeeConfigStub({
      platformFeePercent: 1200,
      orgFeePercent: 0,
      minPlatformFeeCents: 0,
      minTransferCents: 0,
    });
    const svc = new PurchaseService(
      { db, environment: 'test', feeConfig },
      mockStripe
    );

    const content = await makePaidContent(2000, 'fee-override');
    const piId = `pi_fee_override_${Date.now()}`;

    const purchase = await svc.completePurchase(piId, {
      customerId,
      contentId: content.id,
      organizationId,
      amountPaidCents: 2000,
      currency: 'gbp',
    });

    // FeeConfigService MUST have been consulted with (orgId, creatorId, 'one_off').
    expect(feeConfig.getFeesForCreator).toHaveBeenCalledWith(
      organizationId,
      creatorId,
      'one_off'
    );

    // 12% of 2000 = 240. Org gets 0. Creator gets 1760.
    expect(purchase.platformFeeCents).toBe(240);
    expect(purchase.organizationFeeCents).toBe(0);
    expect(purchase.creatorPayoutCents).toBe(1760);
    expect(
      purchase.platformFeeCents +
        purchase.organizationFeeCents +
        purchase.creatorPayoutCents
    ).toBe(2000);
  });

  it('min-platform-fee floor wins when percentage gives a smaller cut (creator reduction first)', async () => {
    // Gross 50p, 10% percent → 5p platform naive. Floor=30 → platform takes 30,
    // creator pool absorbs the shortfall first then org.
    const feeConfig = makeFeeConfigStub({
      platformFeePercent: 1000,
      orgFeePercent: 0,
      minPlatformFeeCents: 30,
      minTransferCents: 0,
    });
    const svc = new PurchaseService(
      { db, environment: 'test', feeConfig },
      mockStripe
    );

    const content = await makePaidContent(50, 'fee-floor');
    const piId = `pi_fee_floor_${Date.now()}`;

    const purchase = await svc.completePurchase(piId, {
      customerId,
      contentId: content.id,
      organizationId,
      amountPaidCents: 50,
      currency: 'gbp',
    });

    expect(purchase.platformFeeCents).toBe(30);
    // Sum invariant must hold (DB CHECK).
    expect(
      purchase.platformFeeCents +
        purchase.organizationFeeCents +
        purchase.creatorPayoutCents
    ).toBe(50);
    // Creator absorbs first; org was already 0.
    expect(purchase.organizationFeeCents).toBe(0);
    expect(purchase.creatorPayoutCents).toBe(20);
  });

  it('floor clamps at amountPaidCents — platform never takes more than gross', async () => {
    // Floor=200 but gross is only 50. Platform takes 50, everything else = 0.
    const feeConfig = makeFeeConfigStub({
      platformFeePercent: 1000,
      orgFeePercent: 0,
      minPlatformFeeCents: 200,
      minTransferCents: 0,
    });
    const svc = new PurchaseService(
      { db, environment: 'test', feeConfig },
      mockStripe
    );

    const content = await makePaidContent(50, 'fee-floor-clamp');
    const piId = `pi_fee_floor_clamp_${Date.now()}`;

    const purchase = await svc.completePurchase(piId, {
      customerId,
      contentId: content.id,
      organizationId,
      amountPaidCents: 50,
      currency: 'gbp',
    });

    expect(purchase.platformFeeCents).toBe(50);
    expect(purchase.organizationFeeCents).toBe(0);
    expect(purchase.creatorPayoutCents).toBe(0);
  });

  it('without feeConfig injected, falls back to legacy DEFAULT_* constants (regression guard)', async () => {
    const svc = new PurchaseService({ db, environment: 'test' }, mockStripe);
    // Default 10% platform / 10% org of post-platform / 81% creator of gross
    // (post-h69cg). On gross=1000:
    //   platform = ceil(1000 * 10%)    = 100
    //   org      = ceil(900 * 10%)     = 90
    //   creator  = 1000 - 100 - 90     = 810
    const content = await makePaidContent(1000, 'fee-fallback');
    const piId = `pi_fee_fallback_${Date.now()}`;
    const purchase = await svc.completePurchase(piId, {
      customerId,
      contentId: content.id,
      organizationId,
      amountPaidCents: 1000,
      currency: 'gbp',
    });
    expect(purchase.platformFeeCents).toBe(100);
    expect(purchase.organizationFeeCents).toBe(90);
    expect(purchase.creatorPayoutCents).toBe(810);
  });
});
