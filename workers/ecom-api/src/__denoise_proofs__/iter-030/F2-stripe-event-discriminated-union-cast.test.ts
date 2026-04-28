/**
 * Denoise iter-030 F2 — `event.data.object as Stripe.X` 18-site cluster
 * inside `switch (event.type)` blocks.
 *
 * Fingerprint: types:as-cast-without-guard (R15 ambiguous — proposes
 *   new R15 carve-out reason code `stripe-event-discriminated-union`)
 * Severity: minor (today: every site is GUARDED by the surrounding
 *   `switch (event.type) { case STRIPE_EVENTS.X: ... }` block AND the
 *   incoming event has been HMAC-verified by `verifyStripeSignature`
 *   middleware before reaching the handler — so the runtime guarantees
 *   that `event.data.object` IS the cast type. The R15 violation is
 *   bookkeeping: each cast lacks the inline `// reason: <code>`
 *   comment R15 §1 mandates for permitted exceptions. Today's choices
 *   are: (a) add 18 inline reason comments, or (b) widen R15 with a
 *   5th carve-out reason code — `stripe-event-discriminated-union` —
 *   covering this pattern, with a verification recipe that asserts
 *   each cast site sits inside a `switch (event.type) { case ... }`
 *   block whose case literal matches the Stripe event family.)
 *
 * Site inventory (18 casts across 4 files, all in `switch (event.type)`):
 *
 *   workers/ecom-api/src/handlers/checkout.ts
 *     :54   event.data.object as Stripe.Checkout.Session
 *
 *   workers/ecom-api/src/handlers/payment-webhook.ts
 *     :144  event.data.object as Stripe.Charge          (charge.refunded)
 *     :199  event.data.object as Stripe.Dispute         (charge.dispute.*)
 *
 *   workers/ecom-api/src/handlers/connect-webhook.ts
 *     :38   event.data.object as Stripe.Account         (account.updated)
 *
 *   workers/ecom-api/src/handlers/subscription-webhook.ts
 *     :306  event.data.object as Stripe.Checkout.Session  (CHECKOUT_COMPLETED)
 *     :342  event.data.object as Stripe.Subscription      (SUBSCRIPTION_CREATED)
 *     :390  event.data.object as Stripe.Subscription      (SUBSCRIPTION_UPDATED)
 *     :412  event.data.object as Stripe.Subscription      (SUBSCRIPTION_UPDATED)
 *     :436  event.data.object as Stripe.Subscription      (SUBSCRIPTION_DELETED)
 *     :459  event.data.object as Stripe.Invoice           (INVOICE_PAYMENT_SUCCEEDED)
 *     :486  event.data.object as Stripe.Subscription      (further sub event)
 *     :512  event.data.object as Stripe.Product           (PRODUCT_UPDATED)
 *     :535  event.data.object as Stripe.Price             (PRICE_CREATED)
 *     :558  event.data.object as Stripe.Price             (PRICE_UPDATED)
 *     :571  event.data.object as Stripe.Invoice           (further invoice event)
 *
 * Description:
 *
 *   Stripe's TypeScript SDK types `event.data.object` as
 *   `Stripe.Event.Data.Object` — a union of every possible
 *   resource shape. The webhook handler dispatches via
 *   `switch (event.type)`, and inside each `case` arm the
 *   actual shape IS deterministically narrower (`event.type ===
 *   'customer.subscription.created'` ⇒ `event.data.object`
 *   IS `Stripe.Subscription`). The Stripe SDK does NOT
 *   expose this discrimination at the type level — it can't,
 *   because `event.type` and `event.data.object` are
 *   declared independently on `Stripe.Event`.
 *
 *   So every Stripe webhook handler in the world that uses
 *   the official SDK ends up with this exact cast pattern.
 *   It IS narrowing, it IS runtime-safe (because of the
 *   surrounding switch), and it IS the canonical idiom.
 *
 *   R15 promoted iter-029 with 4 reason codes covering
 *   Drizzle bridges, framework defaults, Proxy targets, and
 *   type-test scaffolding. This pattern doesn't fit any of
 *   them. Two ways forward:
 *
 *   Option A (mechanical):
 *     Add `// reason: stripe-event-discriminated-union` on
 *     each of the 18 cast lines. Mechanical, clear, but
 *     creates a new reason code de-facto without a SKILL.md
 *     update — the audit will catch it on next cycle.
 *
 *   Option B (rule-level, RECOMMENDED):
 *     Promote a 5th R15 reason code with a verification
 *     recipe:
 *       reason: stripe-event-discriminated-union
 *       Permitted when the cast target is a Stripe SDK
 *       resource type AND the cast site is inside a
 *       `switch (event.type)` block whose case literal
 *       maps to the cast target via the
 *       Stripe.Event.Type ↔ Stripe.Event.Data.Object
 *       discriminator. Verified by a static-analysis test
 *       that walks each `event.data.object as Stripe.<X>`
 *       cast and asserts the surrounding 30-line lookback
 *       contains a matching `case STRIPE_EVENTS.<Y>` whose
 *       Y resolves to a Stripe event type that produces
 *       `Stripe.<X>` per the SDK's documented mapping.
 *
 *   Suggested next-cycle action: dispatcher decides between
 *   Option A and Option B. If B, the mechanical inline
 *   comments still need to land for compatibility with
 *   R15's existing recipe (which lists 4 reason codes).
 *
 *   Note: in the LONG run, the canonical fix would be to
 *   adopt a discriminated-union helper (e.g., a tiny
 *   `narrowStripeEvent(event)` switch that returns
 *   `{ type: 'subscription.created', data: Stripe.Subscription }`
 *   so the cast happens once at the boundary). That's a
 *   refactor, not a skill-rule decision; defer to a service-
 *   layer denoise cycle.
 *
 * Proof shape: Catalogue row 11 (snapshot the route map / structural
 *   grep). Two assertions:
 *   (a) Site-count guard: scan `workers/ecom-api/src/handlers/**`
 *       for `event\.data\.object as Stripe\.` and assert the
 *       count matches the 18-site inventory above. If it
 *       drifts, either a new handler was added (file as
 *       new finding next cycle) or a cast was removed
 *       (positive — verify Option A or B was applied).
 *   (b) Switch-context guard: for each cast site, the previous
 *       30 lines MUST contain `switch (event.type)` AND a
 *       `case STRIPE_EVENTS.` literal. If a cast site is
 *       OUTSIDE a switch block, that's a different finding
 *       (genuine R15 violation, not a discriminated-union
 *       narrowing).
 */
import { describe, it } from 'vitest';

describe.skip('iter-030 F2 — Stripe event.data.object cast cluster (R15)', () => {
  it('site-count guard: 18 sites match inventory', () => {
    // After fix (whether Option A or B):
    //   import { execSync } from 'node:child_process';
    //   const hits = execSync(
    //     "grep -rEn 'event\\.data\\.object as Stripe\\.' " +
    //       "workers/ecom-api/src/handlers --include=*.ts " +
    //       "| grep -v __tests__ | wc -l",
    //     { encoding: 'utf-8' }
    //   ).trim();
    //   expect(Number(hits)).toBe(18);
    //   // OR: if Option B promotes the carve-out, this proof
    //   // shifts to "every site has // reason:
    //   // stripe-event-discriminated-union within 1 line"
  });

  it('switch-context guard: every cast sits inside switch (event.type)', () => {
    // After fix:
    //   For each grep hit (file:line), read 30 lines back and
    //   assert the substring 'switch (event.type)' appears AND
    //   a 'case STRIPE_EVENTS.' literal also appears in that
    //   window. Any miss is a genuine R15 violation worth its
    //   own finding next cycle.
  });
});
