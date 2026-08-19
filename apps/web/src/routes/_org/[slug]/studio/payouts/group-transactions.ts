/**
 * Transaction grouping for `/studio/payouts` (Codex-6nt4l).
 *
 * Extracted from the page component so the money arithmetic is unit-testable:
 * this is the code that decides what an operator is told a "transaction"
 * totalled, and it silently produced fabricated totals for as long as it lived
 * inline.
 */
import type { PayoutWithCreator } from '@codex/subscription';

export type PayoutGroup = {
  key: string;
  source: PayoutWithCreator['sourceType'];
  subscriberName: string | null;
  subscriberEmail: string | null;
  /** Earliest ledger write of the charge — the transaction date shown. */
  createdAt: string;
  /**
   * Latest ledger write — sort key only. Mirrors the server's
   * `groupLatestExpr = MAX(payouts.createdAt)` (subscription-service.ts:3035)
   * so client group order cannot disagree with the order the page window was
   * cut in.
   */
  latestAt: string;
  rows: PayoutWithCreator[];
  totalCents: number;
};

/**
 * Render order within a group: the ledger flow follows the money outward from
 * the platform → org → creator. `creator_payout_to_owner` sits between because
 * it routes the org owner's share of a multi-creator pool.
 */
export const PAYOUT_TYPE_ORDER: Record<
  PayoutWithCreator['payoutType'],
  number
> = {
  platform_fee: 0,
  organization_fee: 1,
  creator_payout_to_owner: 2,
  creator_payout: 3,
};

/**
 * Group key for "one transaction".
 *
 * MUST NOT be `transferGroup ?? <some id>`. `transferGroup` is NAMESPACED by
 * its writers — `purchase_${purchase.id}` (purchase-service.ts:1225) and
 * `course_sub_${sub.id}` (course-subscription-service.ts:1038) — so mixing it
 * into a `??` chain with a raw `purchaseId` puts the two in DIFFERENT buckets
 * (`purchase_a1d5…` !== `a1d5…`) and splits siblings instead of joining them.
 *
 * `purchaseId` comes first because it is the only field ALL siblings of a
 * purchase-sourced charge actually carry: every non-`paid` insert in
 * subscription-service.ts and purchase-service.ts omits BOTH `stripeChargeId`
 * and `transferGroup` (they are set on the paid / platform_fee branches only).
 * That is why the documented `transferGroup ?? row.id` fallback fired on every
 * failed row. Over-merge is bounded by `check_payouts_source_ref_one`
 * (schema/payouts.ts:170): a row attributes to at most one source, and one
 * purchase is one charge.
 *
 * `subscriptionId` is deliberately NOT in the chain: a subscription spans many
 * invoices, so keying on it would merge months of ledger lines into one
 * fictional transaction — strictly worse than the bug being fixed. For
 * subscription-sourced rows the per-charge identity is `stripeChargeId`; where
 * the writer omitted it we cannot honestly attribute the row to a charge, so it
 * stands alone (and the page renders it without a total).
 */
export function groupKeyOf(row: PayoutWithCreator): string {
  if (row.purchaseId) return `purchase:${row.purchaseId}`;
  if (row.stripeChargeId) return `charge:${row.stripeChargeId}`;
  return row.transferGroup ?? row.id;
}

/**
 * Collapse a page of ledger rows into one group per charge, newest first.
 *
 * `totalCents` is only ever shown by the page when `rows.length > 1` — a
 * "transaction total" that sums a single line is a figure the operator cannot
 * check against anything.
 */
export function groupTransactions(
  items: readonly PayoutWithCreator[]
): PayoutGroup[] {
  const map = new Map<string, PayoutGroup>();

  for (const row of items) {
    const key = groupKeyOf(row);
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        source: row.sourceType,
        subscriberName: row.subscriberName,
        subscriberEmail: row.subscriberEmail,
        createdAt: row.createdAt,
        latestAt: row.createdAt,
        rows: [],
        totalCents: 0,
      };
      map.set(key, g);
    }
    g.rows.push(row);
    g.totalCents += row.amountCents;
    // The subscriber denorm comes from payouts → subscriptions → users, so a
    // purchase-sourced row can never resolve one and only some siblings carry
    // it. Take the first non-null across the group rather than whichever row
    // happened to open it.
    g.subscriberName ??= row.subscriberName;
    g.subscriberEmail ??= row.subscriberEmail;
    // Date.parse rather than string compare: the wire format of `createdAt` is
    // whatever JSON serialisation gives a `timestamptz`, not a guaranteed
    // lexicographically-sortable ISO shape.
    const t = new Date(row.createdAt).getTime();
    if (t < new Date(g.createdAt).getTime()) g.createdAt = row.createdAt;
    if (t > new Date(g.latestAt).getTime()) g.latestAt = row.createdAt;
  }

  for (const g of map.values()) {
    g.rows.sort(
      (a, b) =>
        (PAYOUT_TYPE_ORDER[a.payoutType] ?? 99) -
        (PAYOUT_TYPE_ORDER[b.payoutType] ?? 99)
    );
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime()
  );
}
