import type { dbWs as DbClient } from '../../src';
import { schema } from '../../src';
import { ORGS, TIERS } from './constants';

const now = new Date();

/**
 * Seed subscription tiers for each org. Must run BEFORE content so that
 * content rows can reference `minimumTierId` via FK at insert time without
 * relying on a post-hoc update pass.
 *
 * Stripe Product/Price linkage is handled later in `seedCommerce()` when
 * `STRIPE_SECRET_KEY` is available — this function only populates the
 * local DB columns.
 */
export async function seedTiers(db: typeof DbClient) {
  await db.insert(schema.subscriptionTiers).values([
    {
      id: TIERS.alphaStandard.id,
      organizationId: ORGS.alpha.id,
      name: TIERS.alphaStandard.name,
      description: TIERS.alphaStandard.description,
      sortOrder: TIERS.alphaStandard.sortOrder,
      priceMonthly: TIERS.alphaStandard.priceMonthly,
      priceAnnual: TIERS.alphaStandard.priceAnnual,
      isActive: true,
      isRecommended: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: TIERS.alphaPro.id,
      organizationId: ORGS.alpha.id,
      name: TIERS.alphaPro.name,
      description: TIERS.alphaPro.description,
      sortOrder: TIERS.alphaPro.sortOrder,
      priceMonthly: TIERS.alphaPro.priceMonthly,
      priceAnnual: TIERS.alphaPro.priceAnnual,
      isActive: true,
      isRecommended: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: TIERS.betaStandard.id,
      organizationId: ORGS.beta.id,
      name: TIERS.betaStandard.name,
      description: TIERS.betaStandard.description,
      sortOrder: TIERS.betaStandard.sortOrder,
      priceMonthly: TIERS.betaStandard.priceMonthly,
      priceAnnual: TIERS.betaStandard.priceAnnual,
      isActive: true,
      isRecommended: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: TIERS.bonesSoulPath.id,
      organizationId: ORGS.bones.id,
      name: TIERS.bonesSoulPath.name,
      description: TIERS.bonesSoulPath.description,
      sortOrder: TIERS.bonesSoulPath.sortOrder,
      priceMonthly: TIERS.bonesSoulPath.priceMonthly,
      priceAnnual: TIERS.bonesSoulPath.priceAnnual,
      isActive: true,
      isRecommended: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  console.log('  Seeded 4 subscription tiers');
}
