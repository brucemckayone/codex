import * as m from '$paraglide/messages';

/** What a settle dialog tells the queue page once it closes (Codex-2hxff.28). */
export interface SettleNotice {
  /**
   * `info` when it was already settled or gone: the list is refreshed.
   * `warning` when nothing changed and it can be tried again ("Check Stripe
   * again" that Stripe still couldn't answer, Codex-2hxff.73).
   */
  variant: 'success' | 'info' | 'warning';
  /** Read first, in bold. */
  lead?: string;
  text: string;
  /**
   * Where to go next, when the answer names a page (a failed refund its
   * chargeback decides is settled on the charge page, owner D66). Rendered by
   * `SettleNoticeAlert`, the one place a notice is shown.
   */
  link?: { href: string; label: string };
}

/**
 * A failed refund its blocked payment's chargeback decides (422
 * `REFUND_DECIDED_BY_CHARGEBACK`, owner D66, D67; mockup
 * docs/handover/phase3-sources/pause-trials/support-short-loss.html, B1,
 * B2): nothing was settled. While the chargeback is open, the row waits
 * (`chargeback_open`); once it is lost, what is still owed is the charge
 * page's, and the refund has left the queue (`chargeback_lost`). Both link to
 * the charge. Read by any string, since the answer's `reason` is one: a
 * reason this page doesn't know is null.
 */
export function decidedByChargebackNotice(
  reason: string | null,
  chargeId: string
): SettleNotice | null {
  const link = {
    href: `/admin/refunds/${encodeURIComponent(chargeId)}`,
    label: m.support_settle_open_charge(),
  };
  if (reason === 'chargeback_open') {
    return {
      variant: 'info',
      lead: m.support_settle_waiting_lead(),
      text: m.support_settle_waiting(),
      link,
    };
  }
  if (reason === 'chargeback_lost') {
    return {
      variant: 'warning',
      lead: m.support_settle_on_charge_lead(),
      text: m.support_settle_on_charge(),
      link,
    };
  }
  return null;
}
