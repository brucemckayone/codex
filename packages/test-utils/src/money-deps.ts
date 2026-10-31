/**
 * The money dependencies a test builds PurchaseService, SubscriptionService
 * and CourseSubscriptionService with (Codex-2hxff.55).
 *
 * Fee configuration and the money mailers are REQUIRED on those services
 * (docs/payments/architecture.md rule A4): they no longer fall back to code
 * constants when built without them. Spread this into the config:
 *
 *   new SubscriptionService({ db, environment: 'test', ...createTestMoneyDeps() }, stripe);
 *
 * A test that asserts on a mailer, or needs other fees, overrides that slot
 * after the spread.
 */

import { FEES } from '@codex/constants';
import type { DatabaseWs } from '@codex/database';
import { feeChanges, feeConfigVersions } from '@codex/database/schema';

/** `FeeContext` from `@codex/purchase`, which test-utils cannot depend on. */
export type TestFeeContext = 'subscription' | 'one_off';

/** `FeeConfig` from `@codex/purchase`. */
export interface TestFeeConfig {
  platformFeePercent: number;
  orgFeePercent: number;
  minPlatformFeeCents: number;
  minTransferCents: number;
}

/**
 * FeeConfigService's read side (`FeeResolver` in `@codex/purchase`) with no
 * database: every organisation and creator resolves to the code defaults for
 * the context, which is what FeeConfigService returns when no fee version
 * exists. `overrides` pins fields on every answer. The sale's time (`at`,
 * Codex-2hxff.33) is accepted and, with no versions, changes nothing.
 */
export function createTestFeeConfig(overrides: Partial<TestFeeConfig> = {}) {
  const resolve = (ctx: TestFeeContext): TestFeeConfig => ({
    platformFeePercent: FEES.PLATFORM_PERCENT,
    orgFeePercent:
      ctx === 'subscription' ? FEES.SUBSCRIPTION_ORG_PERCENT : FEES.ORG_PERCENT,
    minPlatformFeeCents: FEES.MIN_PLATFORM_FEE_CENTS,
    minTransferCents: 0,
    ...overrides,
  });
  return {
    getFeesForCreator: async (
      _orgId: string,
      _creatorId: string,
      ctx: TestFeeContext,
      _at?: Date
    ) => resolve(ctx),
    getFeesForOrg: async (_orgId: string, ctx: TestFeeContext, _at?: Date) =>
      resolve(ctx),
    getFeesPlatform: async (ctx: TestFeeContext, _at?: Date) => resolve(ctx),
  };
}

/**
 * Every money dependency, for spreading into a service's config:
 *
 * - `feeConfig`: `createTestFeeConfig(fees)`;
 * - `mailer`: the price-change notice, which notifications-api accepts, so a
 *   price move goes ahead (owner decision D-P3). PurchaseService's own
 *   `mailer` (fire-and-forget) ignores the answer;
 * - `payoutMailer` (SubscriptionService) and `offSaleMailer`
 *   (CourseSubscriptionService): fire-and-forget, they do nothing.
 *
 * A service ignores the slots it does not declare. The mailers are plain
 * functions, so this loads outside vitest too (the e2e fixtures); a test that
 * asserts on one passes its own `vi.fn` after the spread.
 */
export function createTestMoneyDeps(
  options: { fees?: Partial<TestFeeConfig> } = {}
) {
  return {
    feeConfig: createTestFeeConfig(options.fees),
    mailer: async (_params: unknown) => ({ accepted: true as const }),
    payoutMailer: (_params: unknown) => {},
    offSaleMailer: (_params: unknown) => {},
  };
}

/** One level's own fee values, as `fee_config_versions` stores them. */
export interface TestFeeLevelValues {
  platformFeePercent?: number | null;
  oneOffOrgFeePercent?: number | null;
  subscriptionOrgFeePercent?: number | null;
  orgFeePercent?: number | null;
  minPlatformFeeCents?: number | null;
  minTransferCents?: number | null;
  notes?: string | null;
}

export type TestFeeLevel =
  | { scope: 'platform' }
  | { scope: 'org'; organizationId: string }
  | { scope: 'creator'; organizationId: string; creatorId: string };

/**
 * Put a level's fees in force as a dated cut (Codex-2hxff.33), the way
 * migration 0123's backfill does: no classification, no notice. A test
 * starts from a known state with it; a test of the write itself goes through
 * FeeConfigService. Defaults to the epoch, so it is in force for every `at`.
 * A platform level needs every value but `orgFeePercent` (its CHECK); the
 * code constants fill what is left out.
 *
 * Returns the change id. Deleting it cascades to its version and notices;
 * an organisation's cascade with the organisation.
 */
export async function seedFeeLevel(
  db: DatabaseWs,
  level: TestFeeLevel,
  values: TestFeeLevelValues,
  effectiveFrom: Date = new Date(0)
): Promise<string> {
  const platform = level.scope === 'platform';
  const [change] = await db
    .insert(feeChanges)
    .values({
      scope: level.scope,
      organizationId: platform ? null : level.organizationId,
      creatorId: level.scope === 'creator' ? level.creatorId : null,
      kind: 'cut',
      effectiveFrom,
    })
    .returning({ id: feeChanges.id });
  if (!change) throw new Error('seedFeeLevel: no change row');
  await db.insert(feeConfigVersions).values({
    changeId: change.id,
    scope: level.scope,
    platformFeePercent:
      values.platformFeePercent ?? (platform ? FEES.PLATFORM_PERCENT : null),
    oneOffOrgFeePercent: platform
      ? (values.oneOffOrgFeePercent ?? FEES.ORG_PERCENT)
      : null,
    subscriptionOrgFeePercent: platform
      ? (values.subscriptionOrgFeePercent ?? FEES.SUBSCRIPTION_ORG_PERCENT)
      : null,
    orgFeePercent: platform ? null : (values.orgFeePercent ?? null),
    minPlatformFeeCents:
      values.minPlatformFeeCents ??
      (platform ? FEES.MIN_PLATFORM_FEE_CENTS : null),
    minTransferCents: values.minTransferCents ?? (platform ? 0 : null),
    notes: level.scope === 'creator' ? (values.notes ?? null) : null,
  });
  return change.id;
}
