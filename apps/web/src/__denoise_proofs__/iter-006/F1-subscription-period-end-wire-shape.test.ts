/**
 * Proof test for iter-006 F1 — `types:as-unknown-as` (subscription wire shape).
 *
 * Finding: `apps/web/src/routes/(platform)/account/subscriptions/+page.svelte`
 * passes `sub.currentPeriodEnd as unknown as string` to `formatDate(...)` at
 * lines 298 and 310. The static type `UserOrgSubscription extends Subscription`
 * (Drizzle row, where `currentPeriodEnd: Date`) does not match the JSON wire
 * shape (`currentPeriodEnd: string`). The cast bridges the gap by going
 * through `unknown` — bypassing the type system entirely.
 *
 * Catalogue row: §6 row 3 (type-equality test). The fix is to declare a
 * wire-shape type (e.g. `UserOrgSubscriptionWire = Replace<Subscription,
 * { currentPeriodEnd: string; createdAt: string; ... }>`) and ascribe the
 * server load's return type with that shape — eliminating both casts.
 *
 * After fix: this test (un-skipped) compiles cleanly because the type narrows
 * `currentPeriodEnd` to `string` directly. Before fix: the assertion fails
 * because `currentPeriodEnd` resolves to `Date` (the Drizzle column type).
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { UserOrgSubscription } from '../../lib/types';

describe.skip('iter-006 F1 — UserOrgSubscription.currentPeriodEnd wire shape', () => {
  it('currentPeriodEnd should be `string` over the wire (not Date)', () => {
    // Before fix: Subscription.currentPeriodEnd is `Date` from Drizzle's
    // timestamp column. The runtime value is `string` because JSON serialises
    // Date → ISO string. This assertion FAILS pre-fix and PASSES once the
    // wire shape replaces the inherited Date with string.
    expectTypeOf<
      UserOrgSubscription['currentPeriodEnd']
    >().toEqualTypeOf<string>();
  });

  it('createdAt should also be `string` over the wire (consistency check)', () => {
    expectTypeOf<UserOrgSubscription['createdAt']>().toEqualTypeOf<string>();
  });
});
