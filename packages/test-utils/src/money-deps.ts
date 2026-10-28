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
 * the context, which is what FeeConfigService returns when no fee row exists.
 * `overrides` pins fields on every answer.
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
      ctx: TestFeeContext
    ) => resolve(ctx),
    getFeesForOrg: async (_orgId: string, ctx: TestFeeContext) => resolve(ctx),
    getFeesPlatform: async (ctx: TestFeeContext) => resolve(ctx),
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
