import { formatPrice } from '$lib/utils/format';
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

/** The charge page, where a refused settle's notice sends support. */
function chargeLink(chargeId: string): SettleNotice['link'] {
  return {
    href: `/admin/refunds/${encodeURIComponent(chargeId)}`,
    label: m.support_settle_open_charge(),
  };
}

/**
 * A refunded-elsewhere settle that would pay back more than was paid (412
 * `SETTLE_EXCEEDS_PAID`, review r8): nothing was settled, and the notice
 * names what can still be paid back and links to the charge, where a refund
 * of that much covers this one (owner D73; copy D78). With nothing left
 * (the server never sends below 0), one sentence and no refund to make: the
 * charge page can't refund £0 (D80). Null without the amount.
 */
export function exceedsPaidNotice(
  maxCents: number | null,
  chargeId: string
): SettleNotice | null {
  if (maxCents === null) return null;
  if (maxCents === 0) {
    return {
      variant: 'warning',
      text: m.support_settle_exceeds_paid_none(),
      link: chargeLink(chargeId),
    };
  }
  const amount = formatPrice(maxCents);
  return {
    variant: 'warning',
    lead: m.support_settle_exceeds_paid_lead({ amount }),
    text: m.support_settle_exceeds_paid({ amount }),
    link: chargeLink(chargeId),
  };
}

/**
 * A settle refused while the payment's own refund of everything owed is
 * still being made (422 `REFUND_AWAITS_PAYMENT_REFUND`, review r8): the late
 * win's (`late_win`) or the blocked payment's (`blocked_refund`). Nothing was
 * settled; that refund includes this one. One sentence each, with no lead
 * (owner D79). A reason this page doesn't know is null.
 */
export function awaitsPaymentRefundNotice(
  reason: string | null,
  chargeId: string
): SettleNotice | null {
  if (reason === 'late_win') {
    return {
      variant: 'info',
      text: m.support_settle_awaits_late_win(),
      link: chargeLink(chargeId),
    };
  }
  if (reason === 'blocked_refund') {
    return {
      variant: 'info',
      text: m.support_settle_awaits_payment_refund(),
      link: chargeLink(chargeId),
    };
  }
  return null;
}
