import type { dbWs as DbClient } from '../../src';
import { schema } from '../../src';
import {
  CONTENT,
  CONTENT_ACCESS,
  ORGS,
  PLATFORM_FEE,
  PURCHASES,
  USERS,
} from './constants';

const now = new Date();
const purchasedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3 days ago

export async function seedCommerce(db: typeof DbClient) {
  // Platform fee config: 10% (1000 basis points)
  await db.insert(schema.platformFeeConfig).values({
    id: PLATFORM_FEE.id,
    platformFeePercentage: PLATFORM_FEE.platformFeePercentage,
    effectiveFrom: new Date('2025-01-01'),
    createdAt: now,
    updatedAt: now,
  });

  // Purchases — revenue split must satisfy CHECK: amount = platform + org + creator
  // Using 10% platform fee, 0% org fee (direct creator orgs)
  const sveltePriceCents = 1999;
  const sveltePlatformFee = Math.round(sveltePriceCents * 0.1);
  const svelteCreatorPayout = sveltePriceCents - sveltePlatformFee;

  const honoPriceCents = 2999;
  const honoPlatformFee = Math.round(honoPriceCents * 0.1);
  const honoCreatorPayout = honoPriceCents - honoPlatformFee;

  // Admin also buys Advanced Svelte (cross-org purchase)
  const adminSveltePlatformFee = Math.round(sveltePriceCents * 0.1);
  const adminSvelteCreatorPayout = sveltePriceCents - adminSveltePlatformFee;

  await db.insert(schema.purchases).values([
    {
      id: PURCHASES.viewerSvelte.id,
      customerId: USERS.viewer.id,
      contentId: CONTENT.advancedSvelte.id,
      organizationId: ORGS.alpha.id,
      amountPaidCents: sveltePriceCents,
      currency: 'gbp',
      platformFeeCents: sveltePlatformFee,
      organizationFeeCents: 0,
      creatorPayoutCents: svelteCreatorPayout,
      stripePaymentIntentId: 'pi_seed_svelte_purchase_001',
      status: 'completed',
      purchasedAt,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: PURCHASES.viewerHono.id,
      customerId: USERS.viewer.id,
      contentId: CONTENT.honoApis.id,
      organizationId: ORGS.beta.id,
      amountPaidCents: honoPriceCents,
      currency: 'gbp',
      platformFeeCents: honoPlatformFee,
      organizationFeeCents: 0,
      creatorPayoutCents: honoCreatorPayout,
      stripePaymentIntentId: 'pi_seed_hono_purchase_001',
      status: 'completed',
      purchasedAt,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: PURCHASES.adminSvelte.id,
      customerId: USERS.admin.id,
      contentId: CONTENT.advancedSvelte.id,
      organizationId: ORGS.alpha.id,
      amountPaidCents: sveltePriceCents,
      currency: 'gbp',
      platformFeeCents: adminSveltePlatformFee,
      organizationFeeCents: 0,
      creatorPayoutCents: adminSvelteCreatorPayout,
      stripePaymentIntentId: 'pi_seed_svelte_purchase_002',
      status: 'completed',
      purchasedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    },
  ]);

  // Content access records
  await db.insert(schema.contentAccess).values([
    {
      id: CONTENT_ACCESS.viewerIntroTs.id,
      userId: USERS.viewer.id,
      contentId: CONTENT.introTs.id,
      organizationId: ORGS.alpha.id,
      accessType: 'complimentary',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: CONTENT_ACCESS.viewerSvelte.id,
      userId: USERS.viewer.id,
      contentId: CONTENT.advancedSvelte.id,
      organizationId: ORGS.alpha.id,
      accessType: 'purchased',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: CONTENT_ACCESS.viewerHono.id,
      userId: USERS.viewer.id,
      contentId: CONTENT.honoApis.id,
      organizationId: ORGS.beta.id,
      accessType: 'purchased',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: CONTENT_ACCESS.adminSvelte.id,
      userId: USERS.admin.id,
      contentId: CONTENT.advancedSvelte.id,
      organizationId: ORGS.alpha.id,
      accessType: 'purchased',
      createdAt: now,
      updatedAt: now,
    },
  ]);

  console.log(
    '  Seeded platform fee, 3 purchases, and 4 content access records'
  );
}
