# Subscriptions

Recurring payments: **organisation tiers** (membership of an organisation) and
**course subscription plans** (access to one course). How each invoice is
divided is in [fees-and-splits.md](fees-and-splits.md).

A **gap** marker means the code does not behave this way yet; see
[status.md](status.md).

---

## Organisation tiers

A tier is an organisation's membership level, with a monthly and an annual price.

- Each tier has one Stripe Product and two Prices (monthly and annual) on the
  **platform** account, created by Studio.
- Prices are in pence: at least £1.00 and at most £100,000.
- **A tier includes exactly the items ticked for it** (Codex-2hxff.91, below).
  There is no hierarchy: a dearer tier does not include a cheaper one's items.
  `sortOrder` is the display order, unique within an organisation.
- Creating a tier requires the organisation owner's payouts to be set up (a
  payable Connect account). It can copy another live tier's items
  ("Include everything from…", `copyAccessFromTierId`).
- A tier with subscribers who have not cancelled cannot be deleted. Deleting
  is a soft delete that also archives the Stripe Product, and removes the tier
  from every item. Items in no other tier need a choice; see below.
- **Reordering tiers** changes only the display order. It no longer changes
  what anyone can see, because access is the ticked set, not the order.

Tiers are managed through organisation-api (`/api/organizations/:id/tiers*`,
`TierService`).

### What a tier includes (plan access)

A film is "subscribers only" (or a paid film "also included in tiers") when
its **tier switch** (`content.is_tier_gated`) is on. The tiers that open it are
its ticks in `content_tier_access` (composite FKs pin the item and the tier to
the row's organisation). Courses use `course_tier_access` the same way.

- **A film behind the switch with no tier ticked is CLOSED, never free.** No
  subscriber reaches it; a buyer, a support grant, a course that includes it
  and the team still do. Without a price it is hidden from public lists (its own
  page still loads); with one it is on sale like any paid item (owner U11).
- **Publishing** subscriber content needs at least one tier ticked
  (`TierRequiredToPublishError`, code `TIER_REQUIRED_TO_PUBLISH`, owner U2).
  Saving it with none is allowed. A paid item may publish with no tier.
- **The access decision and the library read the same ticks** (one
  subscription read with an `IN` over the item's ticks), so the shelf never
  lists what the player would refuse.
- **Where ticks are written** — three writers, one file each:
  - the content editor (`POST/PATCH /api/content`, `includedInTierIds`, a total
    set; absent = leave the ticks alone);
  - the tier checklist (`POST /api/organizations/:id/tiers/:tierId/items`, an
    idempotent delta of at most 200 changes; `PlanAccessService`);
  - `TierService` (create with copy, delete with reassignment).

  A course's ticks are also replaced whole by the course panel
  (`CourseAccessService.setTierAccess`, through ecom-api).
- **One lock order for every writer** (the `tier-service.ts` file header):
  tier rows by id first (FOR UPDATE to delete, FOR NO KEY UPDATE to reorder or
  move the recommended flag, FOR SHARE to tick), then the films and courses by
  id (FOR NO KEY UPDATE), then the ticks. So two writers never deadlock: the
  second waits, then reads the first's commit (a deleted tier is refused, an
  item that became only-here is counted).
- **Deleting a tier** whose items are in no other tier needs
  `?onlyHere=keep` (they stay in no tier: subscribers-only films become closed,
  paid films stay for sale, courses are in no tier) or
  `?onlyHere=move&moveTo=<ids>` (they are added to those tiers first). Without
  a choice the delete is refused (`TierHasOnlyItemsError`, 409, code
  `TIER_HAS_ONLY_ITEMS`, with the film and course counts) and nothing changes.
  `GET …/tiers/:tierId/delete-impact` previews it.
- **No payouts check on a copy or a move** (owner U7): the items are already in
  a tier. Adding a PUBLISHED item from the checklist checks its creator's
  payouts, as the editor does.
- `GET …/tiers/access-summary` gives each tier's film and course counts, and
  for each active tier the items a cheaper active tier has and it lacks.
  `GET …/tiers/:tierId/items` is the checklist page. Both are Studio-only and
  never cached.
- **Phase 1-2 compatibility.** The old column `content.included_in_tier_id`
  (drizzle `legacyIncludedInTierId`) is dual-written with the lowest ticked
  tier, and kept for a closed item. Every content read still carries it as
  `includedInTierId`, and the old single-tier input is accepted and expanded to
  "that tier and every dearer one" (an unchanged resend leaves the ticks
  alone). Removed in the cleanup release.
- **An organisation's hard delete** removes its items' ticks
  (`trigger_sweep_tier_access_on_org_change`); without that trigger the delete
  would fail on the composite FK. The items keep their switch, so they stay
  denied, never free.

## Course subscription plans

A course can have one live plan with a monthly and an annual price.

- Each plan has its own Stripe Product and two Prices on the platform account.
- Prices are at least £1.00, as for tiers.
- Creating a plan requires the organisation owner's payouts to be set up.
- Studio routes: `PUT` / `DELETE /studio/courses/:courseId/subscription-plan`.
  Deactivating keeps the row and archives the Product.
- A course can also be included in chosen tiers (`PUT
  /studio/courses/:courseId/tier-access`, an exact set of tiers). Subscribers to
  those tiers get the course.

---

## Subscribing

| Route | Product | Policy |
|---|---|---|
| `POST /subscriptions/checkout` | Organisation tier (monthly or annual) | `auth: 'required'`, rate limit `strict` |
| `POST /checkout/course-subscription` | Course plan | `auth: 'required'`, rate limit `strict` |

Before a Checkout Session is created:

- the tier (or plan) must be active and belong to the organisation;
- the buyer must not already have a live subscription to that organisation (or
  course): `active`, `past_due` or `cancelling`;
- the organisation owner's payouts must be set up — for course plans too.

The session uses `mode: 'subscription'`, the buyer's single Stripe Customer and
the tier's Price for the chosen interval. Metadata on the session and on
`subscription_data` carries `codex_user_id`, `codex_organization_id`,
`codex_tier_id`, `codex_billing_interval` (or `type: 'course_subscription'` with
the course and plan ids) and `codex_env`. There are
no trials. No `application_fee_percent` or `transfer_data` is passed.

**One live subscription per buyer per organisation** (and per course plan) is
enforced twice: at checkout, and again when the subscription is recorded.

- **At checkout**, as for purchases: one open payment page per buyer per
  organisation or course plan. A second tab gets the same page; another tier or
  billing interval replaces it; a page expires after 30 minutes.
- **If a second Stripe subscription completes anyway** (two pages paid before
  either subscription existed), the first one recorded stays (owner decision
  2026-10-22, "Keep the first"). The newcomer is recorded as a duplicate
  (`duplicate_of_subscription_id`, or `duplicate_of_course_subscription_id`),
  `cancelled`, and grants, pays and emails nothing. It is cancelled at Stripe at
  once, without proration, and every payment it took is refunded in full.
- **The buyer gets one email**, the refund's: "You were already subscribed to
  {org}. We cancelled the second subscription and refunded it.", plus "You can
  switch to {tier} with Change plan." when the tiers differ. There is no
  "subscription cancelled" email and no streaming block for it.
- A refund Stripe refuses leaves `duplicate_settled_at` NULL, and the event is
  retried. What never settles is held for support:
  `duplicate_of_subscription_id IS NOT NULL AND duplicate_settled_at IS NULL`
  (likewise on `course_subscriptions`).

### Recording the subscription

Stripe sends `checkout.session.completed` (subscription mode) to
`/webhooks/stripe/subscription`.

- **Organisation tier:** a `subscriptions` row is written with the status Stripe
  reports (not assumed active). The buyer becomes a `subscriber` member (an
  existing owner, admin, creator or `member` role is kept, owner decision
  2026-10-22) and a follower. A welcome email is sent and the buyer's library and subscription
  caches are bumped.
- **Course plan:** a `course_subscriptions` row and a `course_subscription`
  entitlement that expires at the end of the paid period.

The success page waits for our row before confirming
([purchases.md](purchases.md#after-payment)). For a duplicate it confirms
nothing: it names the subscription the user keeps and says the second one is
cancelled and refunded, with Change plan when the tiers differ (Codex-o4jvw).

---

## Lifecycle and access

| Our status | Stripe status | Access |
|---|---|---|
| `active` | `active` | Yes, until the end of the paid period |
| `cancelling` | `active` with `cancel_at_period_end` | Yes, until the end of the paid period |
| `past_due` | `past_due` | **Yes, while Stripe retries the payment** |
| `paused` | `paused` | No |
| `cancelled` | `canceled` (or `unpaid`, which the status mapper turns into `cancelled`) | No |
| `incomplete` | `incomplete` | No |

Our row always follows Stripe's status, in Stripe's order. A late or replayed
event never brings back a subscription that has ended:

- **Deletion leaves a tombstone** (`ended_at`), written even when the deletion
  arrives before the subscription was recorded. No later event changes an ended
  row or its access. A late invoice for a real charge is still paid out.
- **Ending is per subscription.** The membership change, the streaming block
  and the "subscription cancelled" email follow only the first end of the
  buyer's current subscription. A course plan's grant is revoked by its own
  subscription, so ending an old one never touches a new one.
- **`unpaid`, then paid, is not an end.** Paying the open invoice restores
  access, for tiers and course plans alike (owner decision 2026-10-22, "Yes,
  like tiers").
- **The recorded amount is the subscription's price**, never a one-off
  proration invoice; transfers still use each invoice's own amount.

| Event | Effect |
|---|---|
| `checkout.session.completed` | Record the subscription (above) |
| `invoice.payment_succeeded` | Update the period and status; split and pay out the invoice; renewal email on a cycle renewal; clear any streaming block |
| `invoice.payment_failed` | `past_due` (only from `active`: a failed first payment stays `incomplete`); payment-failed email with the next retry date, except after Stripe's last retry (see [failed payments](#failed-payments)); **access continues**, no streaming block. A course subscription goes to its own handler, which sends the same email |
| `customer.subscription.updated` | Mirror status, tier, interval, period, price and any [waiting tier move](#changing-tier). Then a due price change is swapped in, and a waiting move whose renewal has come is landed. Stripe `canceled` withdraws access at once; the end (tombstone, cancelled email) is recorded by deletion, or at once for a course plan, with its cancellation email |
| `customer.subscription.deleted` | `cancelled` with a tombstone (`ended_at`); on the first end of the buyer's current subscription, access ends, the streaming block is written and the cancelled email goes |
| `customer.subscription.paused` / `resumed` | `paused` with access withdrawn / back to the status Stripe reports; never for an ended row |
| `customer.subscription.trial_will_end` | Email only (no trials are configured) |

Every event for a duplicate settles it (cancel and refund, if not done yet) and does nothing else.

`customer.subscription.created` and `invoice.paid` are not used: creation is
driven by `checkout.session.completed`, and payment by `invoice.payment_succeeded`.

### Renewals

On `invoice.payment_succeeded` the charge is found from the invoice, the
currency is checked to be GBP **before** anything is written — a non-GBP
invoice is rejected (and acknowledged, as a permanent error) with the row
untouched — and the invoice is
split and paid out exactly like a sale ([fees-and-splits.md](fees-and-splits.md#organisation-subscription-invoice)).

### Cancelling, reactivating, resuming

| Route | Effect |
|---|---|
| `POST /subscriptions/cancel` | Cancels at the end of the paid period (`cancel_at_period_end`); status `cancelling`; access continues until then. No streaming block is written — the period is paid for. |
| `POST /subscriptions/reactivate` | Undoes a pending cancellation before the period ends |
| `POST /subscriptions/resume` | Resumes a paused subscription without moving the billing date |

There is no immediate cancellation, except that a full refund ends a
subscription (see [refunds](#refunds)).

### Course subscriptions on the account page

Account › Subscriptions lists course subscriptions beside memberships
(`Codex-2hxff.52`).

| Route | Effect |
|---|---|
| `GET /subscriptions/courses/mine` | The caller's live course subscriptions (`active`, `past_due`, `cancelling`, `paused`; not ended, not a duplicate), newest first, paginated |
| `POST /subscriptions/courses/:courseSubscriptionId/cancel` | Cancels at the end of the paid period, as for a membership |
| `POST /subscriptions/courses/:courseSubscriptionId/reactivate` | Undoes it before the period ends |

- Each is scoped to the caller: another user's id, or one the list does not
  show, is `COURSE_SUBSCRIPTION_NOT_FOUND` (404).
- Reactivate is refused with `COURSE_NOT_ON_SALE` (409) when the course is off
  sale or deleted: the off-sale sweep cancelled it. A plan that only stopped
  taking new subscribers can be reactivated (owner decision Q6).
- The Stripe keys include the period and the row's version, so cancel,
  reactivate, cancel inside Stripe's 24 hours is three writes, not a replay.
- Each card shows what it bills (`course_subscriptions.amount_cents`), which
  the course webhooks copy from the item's price on created, updated and paid.
  A row made before that has none, and the card shows no price rather than a
  guess. `packages/database/scripts/backfill-course-subscription-amounts.ts`
  fills them once after the deploy: a dry run by default, bounded
  (`--limit`, `--after`), and a no-op when re-run. It runs in production only
  with the owner's OK.

When a course is taken off sale because its creator was removed, each live
course subscription to it is set to cancel at period end, with Stripe
idempotency key `course_off_sale_cancel_{id}`. Up to 50 are cancelled at once
and the rest by the hourly ecom-api sweep (see
[agreements](agreements.md#what-comes-off-sale)).

---

## Changing tier

`POST /subscriptions/preview-tier-change` shows the cost of a change (Stripe's
invoice preview); `POST /subscriptions/change-tier` makes it. The proration date
is issued by the server with the preview and checked when the change is made:
it must be at most 10 minutes old and inside the current period (owner decision
2026-10-22, "10 min, then review again"). An older one is refused with
`TIER_CHANGE_PREVIEW_EXPIRED` (409), and the subscriber is shown a fresh
preview to confirm.

"Up or down" is judged by price, comparing the two plans on the subscriber's
**current** billing period (owner decision Q1), against what they pay now: the
held amount while a move waits (below). The preview says when the change
happens (`takesEffect`: `now` or `period_end`).

- **Upgrade** (another tier, dearer): takes effect immediately and the
  prorated difference is charged now. If that payment fails, Stripe keeps the
  old tier and the API returns 402 with a plain message — never Stripe's raw
  error text, which is logged with an errorId instead. The idempotency key
  includes the target price and the proration date.
- **Downgrade** (another tier, cheaper): waits for the **end of the paid
  period** (owner decisions P-5 and T1); the subscriber keeps the dearer tier,
  and its access, until then. See [waiting moves](#waiting-moves).
- **Same price** (owner decision Q4): switches now with no proration; nothing
  is charged or credited.
- **The same tier on the other billing period** switches now, as before: a
  credit for the unused time, or a charge.
- **Another tier on the other billing period** switches now when it is not
  cheaper. A cheaper one is two steps (T1), refused with
  `TIER_CHANGE_TWO_STEPS` (422) and `details.firstStep`, the same-period
  change to offer first.

Refused before Stripe is written to, each 409 with `details.code`:

| Code | When |
|---|---|
| `TIER_CHANGE_CANCELLING` | Set to cancel: reactivate first (owner decision Q2) |
| `PENDING_MOVE_KEEP_FIRST` | A move waits, and the change would move money now (a dearer plan), or is to the plan they are on: Keep current plan first (T2) |
| `TIER_CHANGE_INTERVAL_WHILE_MOVING` | A move waits, and the change switches billing period (Q3) |
| `SUBSCRIPTION_DISPUTED` | A chargeback is open ([subscription disputes](subscription-disputes.md)) |

A change made in our UI is the only way to change tier — see
[the billing portal](#billing-portal).

### Waiting moves

A move to a cheaper plan is not a Stripe subscription schedule (owner
decision T1). It is the price-change machinery's immediate path
(`packages/subscription/src/services/tier-move.ts`):

- **The write.** One Stripe update puts the cheaper Price on the item with
  `proration_behavior: 'none'`, so nothing is charged or credited today and
  the renewal bills the cheaper price. `codex_tier_id` stays on the current
  tier, so access does not move early. The metadata records the move
  (`codex_move_tier_id`, `codex_move_at` = the renewal, unix seconds) and the
  hold: the exact Price and amount the period was paid at
  (`codex_hold_price_id`, `codex_hold_amount`), and any pending price change
  on the tier being left, parked (`codex_hold_pending_price_*`). Our row
  mirrors it at once in `pending_tier_id`, `pending_tier_from` and
  `held_amount_cents` (all three or none).
- **Latest wins** (T2). Another cheaper plan replaces the move and keeps the
  first hold, so Keep still puts back what was paid.
- **Keep current plan** (`POST /subscriptions/keep-current-plan`, rate limit
  `strict`): puts the exact held Price back with no proration, so a
  grandfathered subscriber stays grandfathered, clears the move, and makes a
  parked price change live again. After the renewal it lands on, it is
  refused with `MOVE_ALREADY_LANDED` (409). Its Stripe key includes the row's
  version, so Keep, a new move and Keep again inside 24 hours all write.
- **The flip.** The renewal's `customer.subscription.updated` lands it, read
  from the live subscription since events arrive late: once the item's period
  starts on or after `codex_move_at`, `codex_tier_id` becomes the target and
  every move and hold key goes (key `move-apply:{sub}:{tier}:{at}`). A
  past-due or paused subscription flips too; a cancelled one never does, and
  its row drops the move. A stale event that puts the move back on the row is
  mirrored again from Stripe. A transient Stripe failure is retried by Stripe;
  a permanent one is one `tier_move.apply_failed` alert with an errorId, and
  the subscriber keeps the dearer plan at the cheaper price until it is fixed.
- **The backstop.** ecom-api's existing hourly wake flips any move whose
  renewal is more than an hour past (at most 50 a run, oldest first), and
  alerts, once, what it could not flip. No new cron.
- **Ending.** A move survives a cancel until the subscription ends; the
  tombstone drops it.
- **Deleting a tier** that subscribers are waiting to move to is refused
  (`TIER_HAS_SUBSCRIBERS`, with `movingInCount`), as for its subscribers. The
  delete impact Studio reads (`PlanAccessService.getDeleteImpact`) carries
  `movingInCount` and `lastMoveAt`, the last of their dates.
- **A move to a tier deleted anyway.** The delete counts movers before its
  transaction, so a move written in that window gets past it. Such a move is
  never flipped onto the deleted tier: the flip raises `tier_move.apply_failed`
  with reason `target_tier_deleted` and the ids, nothing fails, and the
  member keeps the dearer plan at the cheaper price. The hourly backstop
  alerts each one at most once a day.

**Runbook: moves to a deleted tier.** Support lists them with:

```sql
SELECT s.id, s.stripe_subscription_id, s.organization_id, s.tier_id,
       s.pending_tier_id, s.pending_tier_from, s.held_amount_cents
FROM subscriptions s
LEFT JOIN subscription_tiers t ON t.id = s.pending_tier_id
WHERE s.pending_tier_id IS NOT NULL
  AND s.status <> 'cancelled'
  AND (t.id IS NULL OR t.deleted_at IS NOT NULL);
```

Each member is on `tier_id` and billed the cheaper price. Before the
renewal, Keep current plan undoes the move. After it, Keep is refused
(`MOVE_ALREADY_LANDED`). The member can still pick a live plan no dearer than
the one they kept (a cheaper one waits for the next renewal; one at the same
price switches now). Otherwise support does what Keep does, by hand at
Stripe: put `codex_hold_price_id` back on the item with no proration, and
remove the `codex_move_*` and `codex_hold_*` keys. The next
`customer.subscription.updated` mirrors it onto our row.

**Price changes while a move waits** (Part A rules 1-3,
[price changes](#price-changes)):

- Repricing the tier a member is waiting to move **away** from leaves them
  out. Their row says so (`pending_tier_id` names another tier), and the
  hourly step checks Stripe's `codex_move_tier_id` again before it writes,
  since a move can start after the save (`moving_away`).
- Repricing the tier a member is waiting to move **to** includes them (T6).
  They move at the price they confirmed, then pay the new one from the first
  renewal after the move that is also 30 days after their own email
  (`floor_from` = `pending_tier_from` + 1 second). Theirs is always the
  pending marker, never a swap now. Their account shows it as
  `pendingTierChange.laterPrice`, read from their row (no Stripe read).
- **Keep current plan** on a tier repriced during the wait puts them back on
  the old price with nobody having told them the new one. So Keep adds a
  `due` row for them (`source = 'keep_current_plan'`) to the tier's latest
  change that isn't superseded, if its new Price is the tier's current one,
  re-opening it if it had finished; with no such change, Keep records one of
  its own. A row the step had closed as moving away is re-opened: as `due`,
  or as `notified` (the write only) if they had been told before they left.
  If the parked price change already names the current Price, they were
  told: nothing is added. A live change for another Price is an error alert,
  and nothing is added.
  - The held Price Keep puts back was archived by that re-price, and Stripe
    refuses an archived Price on an item. Keep makes it active again first
    (`ensurePriceActive`: read, and written only if archived) and leaves it
    active. Checkout always uses the tier's current Price and the portal is
    locked, so nobody new can reach it (review C1, F2).
  - Whether the tier was repriced, and the change to hang the row off, are
    read under a share lock on the tier row, which a save takes first
    (F3). A save in flight is waited for, so Keep joins the newest change,
    never an outdated one. Two Keeps on one tier with no change for its Price
    can both write one; the second hits the one-live-change index and runs
    once more, joining the first's.

## Price changes

Owner decisions Q4–Q7, P-6, M1 and M2. They apply to **organisation tiers and
course plans alike**.

- Studio is the only place a price is set.
- New subscribers pay the new price straight away.
- Existing subscribers on **that interval** move to the new price at their
  **first renewal at least 30 days after** they are emailed about the change:
  each person's 30 days count from their own accepted email (M2). Annual
  subscribers move at their annual renewal.
- There is no immediate charge and no proration. Increases and decreases are
  treated the same.
- **Notice first, then move** (owner decision D-P3, 2026-10-27,
  `Codex-2hxff.43`): a subscriber's move is written only once the
  notifications worker has accepted their notice. If it isn't accepted, they
  are not moved, and the hourly step tries again the next hour. After three
  tries they are held for support ([held subscribers](#held-subscribers)).
  "No mailer" cannot happen: the services require one in their types
  (`Codex-2hxff.55`).
- "Not moved" means today's price, **unless** an earlier accepted change is
  still pending on the subscription: that one still lands.
- A price edited in the Stripe Dashboard is logged as drift and is **not**
  applied to any subscriber.

**Recording (the save).** Studio creates a new Stripe Price for the changed
interval and points the tier (or plan) at it; new checkouts use it at once.
In the same transaction (`recordTierPriceChange` / `recordPlanPriceChange`,
`packages/subscription/src/services/pending-price-change.ts`) the save
writes one `price_changes` row per interval that changed, and one
`subscription_price_moves` row per subscriber it reaches: the subscriptions
on that tier (or plan) and interval that are `active`, `cancelling`,
`past_due` or `paused`, not ended and not a duplicate, with the waiting-move
rules [above](#waiting-moves). A recording that fails fails the save, and
the new Prices are archived again, so nobody is lost between the save and
the step. A change with nobody to tell is `done` at once.

- **Latest wins** (owner decision 2026-10-13). A newer save for the same tier
  (or plan) and interval supersedes every older change that isn't already
  superseded. A `running` or `stopped` one becomes `superseded` (with
  `superseded_by_id`); a `done` one stays `done`. Either way, every `due`,
  `notified` and unresolved `held` row of those older changes becomes
  `superseded`: nobody hears about a replaced price, held people leave
  support's list, and a row support retried on an old change is never
  worked. The new change's rows reach the same people, so they are told the
  newest price. Someone already told keeps that move at Stripe until the
  newer one is written. Two saves of one tier at once queue on the tier row,
  so the second always supersedes the first.
- **Lock order.** A `price_changes` row, then its `subscription_price_moves`
  rows. Every write that changes a change's state takes the change row first:
  the save's supersede, Keep's re-open, and the step's stop, restart, re-open
  and finish. The step's claim is its own statement and holds no change lock.
- The record, not the log, is the source of truth: `price_changes.state` is
  `running`, `done`, `stopped` or `superseded`; each person's row is `due`,
  `notified` (told; the Stripe write still to land), `scheduled`, `unchanged`
  (already on the new amount), `skipped`, `held` or `superseded`. A skip
  says why: `moving_away` (they have left the tier since the save, or are
  waiting to leave it), `other_interval` (they changed billing period),
  `no_items`, or `ended` (cancelled, or `ended_at` set). A subscription set
  to cancel at the period end is still moved: if they reactivate, they renew
  at the new price.

**The hourly step** (`runPriceMoveStep`,
`packages/subscription/src/services/price-moves-sweep.ts`, `Codex-2hxff.86`).
ecom-api's existing hourly wake (`0 * * * *`, production) works the rows,
after the waiting-move backstop and before the bank payout. It does nothing
on the 08:00 London run, which the bank payout has to itself. No new cron
and no new Neon wake: it rides the hourly one.

1. **Restart and re-open.** A stopped change support restarted
   (`restart_requested_at` after `stopped_at`) runs again. A `done` change
   with a `due` or `notified` row is re-opened (`running`, `done_at` NULL):
   support's Retry is a row flip only, and Keep current plan can add a row to
   a finished change. Only a tier's (or plan's) newest change with nothing
   else live is re-opened, so the one-live-change index always holds; after
   a newer save, an older change has no such rows anyway.
2. **Claim.** Up to 1,125 rows (`PRICE_MOVES_PER_RUN`), `due` or `notified`,
   whose retry time has come, on running changes, oldest first, in one UPDATE
   under `FOR UPDATE SKIP LOCKED` (`attempts + 1`, `attempted_at`). A row
   tried in the last 20 minutes is never claimed, so overlapping runs never
   work one person twice.
3. **Work.** Batches of 8, one change per batch, 50 ms apart; no batch starts
   after 8 minutes (the cron's wall is 15). Claims not worked go back as they
   were. Per person:
   - our row is read again: ended (`ended`), switched billing
     (`other_interval`), or left or leaving the tier (`moving_away`) is
     skipped;
   - `schedulePriceChange` reads the live subscription, works out the move
     and the renewal that first bills the new price, sends the notice and
     waits for the answer (`sendEmailToWorkerAwaited`, 5 seconds). Only a 2xx
     whose body says `success: true` is accepted; anything else writes
     nothing to the subscription. Every Stripe call gives up after 3 seconds,
     with no retry: the next hour is the retry;
   - at Stripe, a tier's member is leaving if `codex_move_tier_id` names
     another tier, or, with no move waiting, `codex_tier_id` does (an
     upgrade, or Keep from a move onto this tier): `moving_away`;
   - the member can change plan during the email (review C1, F1). So once
     the notice is accepted, Stripe is read again. If the status, the item,
     its Price or any `codex_*` key changed, the move is decided again on
     what is there now, the same way and against the same notice time, and
     nothing is written over their change: someone now leaving is
     `skipped`. No second notice is sent, and the row records `notice_at`
     either way. The 30-day rule is judged against that same notice time,
     never the second read's, so a switch from now to pending (or back)
     still names the first renewal 30 days after the email. A change
     between that read and the write is left to the sync's backstop
     ([At Stripe](#price-changes));
   - a `notified` row retries the write only, with no second email (M1),
     from its own email: the date it was told, or the next renewal if that
     has passed (Q5).
4. **Record.**

   | What happened | The row |
   |---|---|
   | Told and written | `scheduled` (`now` or `pending`), with `notice_at` and the date the email gave (`effective_at`) |
   | Already on the new amount, or skipped | `unchanged` / `skipped`, nobody emailed; told, then found changed (F1): `notice_at` and `effective_at` kept |
   | Notice not accepted | `due` again next hour (`last_error`, e.g. `notice_refused_422`, `notice_unknown_503`); held after 3 tries (`no_address`, `notice_refused`, `notice_skipped`, `notice_unknown`) |
   | Told, then the Stripe write failed | `notified`, the write retried next hour; held after 3 tries as `move_refused` (a 4xx other than 409 or 429) or `move_unknown` |
   | The read, or a same-amount write, failed before any notice | `due` again; held after 3 tries (`read_failed`, `same_amount_write_failed`) |

   `attempts` counts the tries since support's last Retry, which resets it
   to 0. A retried row that ends `scheduled`, `unchanged` or `skipped`
   closes as `retried_ok` (`resolved_at` set).
5. **An unknown outcome is checked before anything is sent again.** A notice
   that got a 5xx or timed out may have gone, and a run may have stopped
   after its email or its Stripe write without recording either, leaving an
   older try's `last_error` on the row. So every row tried before (and a
   retried row whose kept `held_reason` is `notice_unknown`) is looked for
   first in notifications' email log: a row for the template and recipient,
   carrying the row's `priceMoveId`, since a minute before the last try,
   `success` or `pending` (F4). Found, it was told then. Then at Stripe:
   already on the new Price, or marked pending for it, counts as moved.
   Only then is it sent again. notifications-api writes the log row
   `pending` before the provider call and `success` after it, so one left
   `pending` may have been delivered; `failed` (every attempt failed) and
   `skipped` (an opt-out) do not count.
6. **A change stops** when every notice of its first batch in a run was
   refused with a 4xx that will not go away by itself (not 408, 409, 425 or
   429: a missing template, a bad worker secret) and none of its notices was
   ever accepted. It becomes `stopped`, nobody is moved, the claims go back,
   and one alert (with the status and an errorId) says to fix the cause and
   restart. `stopped_reason`, which support's Queue shows and Studio maps:
   `template_missing` (404 or 422), `worker_auth` (401) or `notice_refused`
   (any other).
7. **Alerts are capped.** At most 50 per-person lines a run, one for each row
   that becomes held, whose `alert_error_id` is that line's errorId. The rest
   fold into the run's end alert, whose errorId those rows carry.
8. **Done.** A change is `done` (with `done_at`) when no row is `due` or
   `notified`; held rows don't keep it running. That includes a change
   re-opened for a retried row, once that row is worked.

Budget: about 4 subrequests per person (the Stripe read, the notice, the
read again after it, the Stripe write), so a full run of 1,125 is about
4,500. With the same wake's other sweeps (about 4,000) that is 8,500, under
the paid plan's default 10,000 per invocation. 10,000 subscribers take 9
runs, 9 to 10 hours with the 08:00 gap.

**At Stripe:**

- If their next renewal is already at least 30 days after the email, their
  subscription is switched to the new Price **now** with
  `proration_behavior: 'none'`. A same-interval switch keeps the billing dates
  and charges nothing; the next renewal simply bills the new price.
- Otherwise the new Price is recorded on the Stripe subscription's metadata
  (`codex_pending_price_id`, `codex_pending_price_from` = the email + 30 days,
  or a waiting mover's floor if later). Stripe sends
  `customer.subscription.updated` at every renewal; once the next renewal is
  on or after that date, the switch is made as above. If a newer save has
  archived that Price before the step reached them, it is made active again
  first, and the accepted change still lands (F2).
- **A switch after an early move credits what was paid.** Either way the
  item carries the new Price for the rest of a period paid at the old one.
  An upgrade or a switch of billing period then credits the unused time at
  the OLD price, because Stripe credits the invoiced line: each credit names
  it in `proration_details.credited_items`. It does not use the item's
  current Price. So nothing is put back first, and the change-plan dialog's
  plain preview equals the charge. Proven on test clocks for a rise, a cut,
  two early moves and the pending path (`Codex-2hxff.95`,
  `packages/subscription/scripts/test-clock-paid-price.ts`). This holds on
  the pinned apiVersion: re-run that script before upgrading it.
- Past-due and paused subscribers are only marked pending, and move when they
  are active again. A subscriber already paying the new amount is not emailed.
- The other interval's subscribers are never touched: switching a monthly
  subscription onto an annual Price would reset its cycle and bill a year.
- A newer pending change overwrites an older one (latest wins): one move, to
  the newest price, at the first renewal at least 30 days after the newest
  email.
- A tier change made now clears a pending price change; cancelling and
  reactivating keep it. A [waiting move](#waiting-moves) parks it, and Keep
  current plan restores it.
- The notice (`subscription-tier-price-change`) gives the date of the renewal
  that first bills the new price. The "from" figure is what that subscriber is
  billed today, read off their live Stripe item, not the previous list price
  (`Codex-2hxff.40`).
- A Price created in the Stripe Dashboard is logged as drift
  (`TierService.recordStripePriceDrift`); the tier keeps its own Price and no
  subscriber moves.
- A tier Price edited in the Dashboard (archived, renamed, its metadata
  changed) raises "Codex-managed tier Price edited in Stripe Dashboard"; no
  sync-back. The platform's own Price updates (a re-price's archive and its
  rollback, `ensurePriceActive`) each write a fresh `codex_platform_write`
  metadata value, and the `price.updated` arm skips an event whose
  `previous_attributes.metadata` shows that key changing
  (`isPlatformPriceWrite`). Before this, every Studio re-price raised it.
- **Backstop** (F1). Every Price a tier bills is on that tier's Stripe
  Product, so the subscription sync raises an error alert (ids only, no
  write) when an item's Price is on neither the member's tier's Product nor
  their waiting tier's: a move or a plan change may have been written over.

### Studio progress

Studio's note on a repriced tier, or a course's Offer panel, reads how the
change is going: `GET /api/organizations/:id/tiers/price-changes`
(organization-api) and
`GET /studio/courses/:courseId/subscription-plan/price-changes?organizationId=`
(ecom-api). Both are owner/admin only (`requireOrgManagement`), uncached
(`private`) and one GROUP BY. Each change that is running or stopped, or
finished or replaced in the last 14 days, gives `counts` (`total`;
`emailed`, every accepted notice, a held move failure included;
`scheduled`; `held`, unresolved: "couldn't be moved yet"; `due`; and
`retrying`, the `due` rows already tried: "1 to try again at 16:00"),
`lastRunAt`, `nextRunAt` and `estimatedDoneAt` (`nextPriceMovesRunAfter`
in `@codex/payments`, stepped at 1,125 a run, skipping 08:00 London),
`doneAt`, `supersededById` and `stoppedAt`. The
counts change only on the hour, so the page reads once per visit and has
Check again (the cost rule). The public tier list is not touched.

### Held subscribers

Support's list is the record: `held` rows not yet resolved, in Admin › Queue ›
Price moves, with Retry (a notice never accepted), Retry the move (told;
Stripe refused), Close and Restart (a stopped change). See
[operations](operations.md). An engineer can list them with:

```sql
SELECT m.id, m.held_reason, m.last_error, m.alert_error_id,
       m.subscription_id, m.course_subscription_id, m.stripe_subscription_id,
       m.price_change_id, c.state AS change_state
FROM subscription_price_moves m
JOIN price_changes c ON c.id = m.price_change_id
WHERE m.state = 'held' AND m.resolved_at IS NULL;
```

**Checkouts that straddle a save.** Someone who opened checkout on the old
Price and paid after the change was not a subscriber when the save recorded
who is due, so they have no row: they need a notice and a move, and no
alert names them. To find them:

1. Read the current Price ids and amounts from our database:
   - tiers: `subscription_tiers.stripe_price_monthly_id` /
     `stripe_price_annual_id`, with `price_monthly` / `price_annual`;
   - course plans: the same columns on `course_subscription_plans`.
2. List the subscriptions in Stripe with Search. Tier subscriptions carry
   `codex_tier_id` and course subscriptions `codex_plan_id`:
   - `metadata['codex_tier_id']:'<tier id>' AND -status:'canceled' AND -status:'unpaid' AND -status:'incomplete_expired' AND -status:'incomplete'`
   - `metadata['codex_plan_id']:'<plan id>' AND -status:'canceled' AND -status:'unpaid' AND -status:'incomplete_expired' AND -status:'incomplete'`
3. Keep the ones on the interval (`items.data[0].price.recurring.interval`)
   whose item is not on the current Price, whose `codex_pending_price_id` is
   absent or names another Price, and whose `unit_amount` differs from the
   current price, and that have no `subscription_price_moves` row for the
   change.

The mechanism is this deferred switch, not Stripe subscription schedules (owner
decision 2026-10-13): schedules would have had to take over cancel, reactivate
and tier change. Downgrades at period end use the same machinery, not
schedules (`Codex-2hxff.16`, [waiting moves](#waiting-moves)).

## Failed payments

Owner decision P-3, "After retries fail".

- A failed renewal makes the subscription `past_due`. The subscriber **keeps
  access** while Stripe retries the card on the retry schedule set in the Stripe
  Dashboard, sees the existing "update your card" banner, and is emailed.
- The payment-failed email names the next retry. After Stripe's **last** retry
  there is none, so no payment-failed email goes (owner decision Q5,
  2026-10-30): Stripe ends the subscription and the cancellation email
  follows. Course subscriptions alike, and not for an ended or duplicate one.
- When the retries are exhausted, Stripe cancels the subscription and access
  ends. An `unpaid` status is treated the same way.
- This relies on the Stripe Dashboard: "If all retries for a payment fail"
  must be set to **cancel the subscription** (or mark it unpaid). If Stripe
  leaves it past-due, access never ends — see
  [operations.md](operations.md#stripe-dashboard-settings).

## Refunds

Owner decision P-4, "Cancel + end access".

- A **full** refund of the payment for the **current billing period** cancels
  the subscription immediately and ends access.
- A **partial** refund leaves the subscription running.
- A full refund of an **earlier** period's payment, or of a payment that
  bought no period (an upgrade's proration invoice), leaves it running too
  (owner decision 2026-10-20, "Current period's payment").
- Either way, the creator and organisation slices are reversed in proportion,
  exactly as for one-off purchases ([purchases.md](purchases.md#refunds)). A
  shortfall on the payee's balance goes to `refund_reviews`, which holds
  subscription debts as well as purchase ones (one row per reversal).
- The order of Stripe's events does not change that. A refund handled before
  its invoice's payout reverses nothing then, and is clawed back as soon as
  the invoice's slices are recorded, so the payees net the same either way
  (`Codex-2hxff.67`).

The current period's payment is the newest **paid** invoice Stripe raised to
buy a period (`billing_reason` `subscription_create` or `subscription_cycle`),
compared with the invoice the refunded charge paid. Stripe's `latest_invoice`
is not used: after an upgrade it is the proration invoice, and while a renewal
is retried it is the unpaid one. The cancel is applied here at once, as for
`customer.subscription.deleted` (which re-applies it when it lands). Tier and
course subscriptions are handled alike, except for the streaming block: a
tier subscription's is written, while a course plan's grant is revoked
instead, as on deletion — the org-wide block would also stop the subscriber's
purchases and tier content (owner decision 2026-10-20).

If the cancel fails, the webhook raises an alert with an `errorId` (check the
subscription at Stripe and the subscriber's access by hand) and Stripe
redelivers the event when the failure is transient.

Known limit: a full refund that later **fails** has still cancelled the
subscription; the customer subscribes again, and support settles the failed
refund as for a purchase (the failed-refund alert says so).

## Disputes

A disputed subscription invoice follows the dispute rules for purchases
([purchases.md](purchases.md#disputes)), and the money is handled the same way
(the clawback acts on both sources). The subscription itself
([subscription-disputes.md](subscription-disputes.md), owner decisions Q-A and
Q-B):

- **Chargeback opened:** access is paused (`disputed_at`, which every granting
  query reads; for a course subscription, its stored grant) and so is billing
  (`pause_collection` set to `void`), so no renewal is charged while access is
  paused.
- **Won:** access and billing are restored, unless another chargeback on the
  same subscription is still open.
- **Lost:** the subscription is cancelled at Stripe at once, with no proration;
  `customer.subscription.deleted` then ends it here and sends the usual
  cancellation email.
- **Inquiry:** nothing changes for the subscriber.

The subscriber is told why access is paused (`Codex-2hxff.60`): the content
page says "Access paused" with no Buy button, and the account page shows a
"Paused: payment dispute" badge and hides Change Plan. A course lesson paused
by a dispute shows the same notice (owner decision 2026-10-24, "Notice for
courses too"). The detail is in [subscription disputes](subscription-disputes.md).

## Billing portal

The Stripe Billing Portal (`POST /checkout/portal-session`) is for updating
payment methods and viewing invoices only. Every portal session passes an
explicit configuration with cancelling, plan switching and pausing turned off,
so our database and Stripe can never disagree about a subscription. The id comes
from `STRIPE_PORTAL_CONFIGURATION_ID`; without it the portal **refuses to open**
(`STRIPE_NOT_CONFIGURED`) rather than fall back to the account's default
configuration, which allows cancelling.

---

## Emails

Course subscriptions get the same templates (`Codex-2hxff.52`), naming the
course as the plan.

| Template | When |
|---|---|
| `subscription-created` | The subscription is recorded |
| `subscription-renewed` | A cycle renewal is paid |
| `payment-failed` | A renewal fails (with the next retry date); not after Stripe's last retry (Q5) |
| `subscription-tier-price-change` | A price changes — sent at least 30 days before the new price applies, and before the move is scheduled: no accepted notice, no move (`Codex-2hxff.43`). Says the subscription "renews at the new price from {{effectiveDate}}"; migration `0098` rewrote the old "on the next billing cycle" sentence on existing rows (`Codex-2hxff.35`) |
| `subscription-cancelled` | The subscription ends (the first end only). Not for a course subscription whose course is off sale: `course-no-longer-offered` already went |
| `course-no-longer-offered` | A course subscription is cancelled because the course was taken off sale; gives the date access ends |
| `trial-ending-soon` | A trial is about to end (no trials are configured today) |
