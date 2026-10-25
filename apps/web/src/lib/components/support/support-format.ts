/**
 * Words, dates and Badge treatments for the support pages (Codex-2hxff.28).
 *
 * Display only. Every money rule (what is refundable, what a refund takes
 * back, whether the window is open) is the server's answer; these helpers
 * only put it into words. Dates are shown in London time, as the platform's
 * other sentence dates are (`formatSentenceDate`), so support and the buyer
 * read the same day.
 */

import type {
  ChargebackState,
  ChargeSummary,
  HistoryOutcome,
  RefundRequester,
  Slice,
  SupportChargeKind,
  SupportPerson,
  SupportRefundWindow,
} from '@codex/admin';
import {
  DISPUTE_CHARGEBACK_OPEN_STATUSES,
  DISPUTE_INQUIRY_STATUSES,
} from '@codex/constants';
import * as m from '$paraglide/messages';

export type BadgeVariant = 'neutral' | 'success' | 'warning' | 'error' | 'info';

export interface BadgeTreatment {
  label: string;
  variant: BadgeVariant;
}

const LOCALE = 'en-GB';
const TIME_ZONE = 'Europe/London';
const DAY_MS = 86_400_000;

const dayFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: TIME_ZONE,
});
const shortDayFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  timeZone: TIME_ZONE,
});
const timeFormatter = new Intl.DateTimeFormat(LOCALE, {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIME_ZONE,
});
const listFormatter = new Intl.ListFormat(LOCALE, {
  style: 'long',
  type: 'conjunction',
});

/** `18 Oct 2026` */
export function formatDay(iso: string): string {
  return dayFormatter.format(new Date(iso));
}

/** `18 Oct` */
export function formatShortDay(iso: string): string {
  return shortDayFormatter.format(new Date(iso));
}

/** `14:32` */
export function formatTime(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

/** `18 Oct 2026, 14:32` */
export function formatDayTime(iso: string): string {
  return `${formatDay(iso)}, ${formatTime(iso)}`;
}

/** `Rowan Ellis and Studio Alpha` */
export function formatList(items: readonly string[]): string {
  return listFormatter.format(items);
}

/**
 * How long a window has left, in whole days to the nearest day. Display only:
 * the route checks the window on its own clock.
 */
export function daysLeftText(closesAt: string, now: Date = new Date()): string {
  const ms = new Date(closesAt).getTime() - now.getTime();
  if (ms < DAY_MS) return m.support_days_left_less();
  const days = Math.round(ms / DAY_MS);
  return days === 1
    ? m.support_days_left_one()
    : m.support_days_left({ count: String(days) });
}

/** The window's cell in the search results: a Badge and one line under it. */
export function windowCell(
  window: SupportRefundWindow,
  now: Date = new Date()
): { badge: BadgeTreatment; detail: string } {
  if (window.isOpen) {
    return {
      badge: { label: m.support_window_open(), variant: 'success' },
      detail: m.support_window_closes({
        date: formatShortDay(window.closesAt),
        left: daysLeftText(window.closesAt, now),
      }),
    };
  }
  return {
    badge: { label: m.support_window_closed(), variant: 'neutral' },
    detail: m.support_window_closed_on({
      date: formatShortDay(window.closesAt),
    }),
  };
}

export function chargeKindLabel(kind: SupportChargeKind): string {
  if (kind === 'subscription_invoice') {
    return m.support_kind_subscription_invoice();
  }
  if (kind === 'course_plan_invoice') {
    return m.support_kind_course_plan_invoice();
  }
  return m.support_kind_purchase();
}

/** `Inner Circle · monthly`, `Yoga Foundations · monthly plan`, or the title. */
export function chargeTitle(
  summary: Pick<ChargeSummary, 'kind' | 'title' | 'interval'>
): string {
  if (!summary.interval || summary.kind === 'purchase') return summary.title;
  const interval =
    summary.kind === 'course_plan_invoice'
      ? summary.interval === 'year'
        ? m.support_plan_interval_year()
        : m.support_plan_interval_month()
      : summary.interval === 'year'
        ? m.support_interval_year()
        : m.support_interval_month();
  return `${summary.title} · ${interval}`;
}

/** The flag under a charge's status in the search results; null for none. */
export function chargebackFlag(state: ChargebackState | null): string | null {
  if (state === 'inquiry') return m.support_chargeback_inquiry();
  if (state === 'open') return m.support_chargeback_open();
  if (state === 'won') return m.support_chargeback_won();
  if (state === 'lost') return m.support_chargeback_lost();
  return null;
}

/** A chargeback's state inside a sentence: "chargeback, open". */
export function chargebackWord(status: string): string {
  const state = (DISPUTE_INQUIRY_STATUSES as readonly string[]).includes(status)
    ? 'inquiry'
    : (DISPUTE_CHARGEBACK_OPEN_STATUSES as readonly string[]).includes(status)
      ? 'open'
      : status;
  if (state === 'inquiry') return m.support_chargeback_word_inquiry();
  if (state === 'open') return m.support_chargeback_word_open();
  if (state === 'won') return m.support_chargeback_word_won();
  if (state === 'lost') return m.support_chargeback_word_lost();
  return humanise(status).toLowerCase();
}

/** Stripe's refund status, as the refunds card shows it. */
export function refundStatus(status: string): BadgeTreatment {
  switch (status) {
    case 'pending':
      return { label: m.support_refund_pending(), variant: 'warning' };
    case 'requires_action':
      return { label: m.support_refund_requires_action(), variant: 'warning' };
    case 'succeeded':
      return { label: m.support_refund_succeeded(), variant: 'success' };
    case 'failed':
      return { label: m.support_refund_failed(), variant: 'error' };
    case 'canceled':
      return { label: m.support_refund_canceled(), variant: 'neutral' };
    default:
      return { label: humanise(status), variant: 'neutral' };
  }
}

/** Stripe's refund reason. */
export function refundReasonLabel(reason: string | null): string {
  if (reason === 'requested_by_customer') {
    return m.support_reason_requested_by_customer();
  }
  if (reason === 'duplicate') return m.support_reason_duplicate();
  if (reason === 'fraudulent') return m.support_reason_fraudulent();
  return reason ? humanise(reason) : m.support_reason_none();
}

/** Who made a refund: support, the Stripe Dashboard, or the platform itself. */
export function requesterLabel(requestedBy: RefundRequester): string {
  if (requestedBy === 'dashboard') return m.support_by_dashboard();
  if (requestedBy === null) return m.support_by_platform();
  return requestedBy.name;
}

/** A dispute's Stripe status, as the chargebacks card shows it. */
export function disputeStatus(status: string): BadgeTreatment {
  switch (status) {
    case 'needs_response':
      return { label: m.support_dispute_needs_response(), variant: 'error' };
    case 'under_review':
      return { label: m.support_dispute_under_review(), variant: 'warning' };
    case 'warning_needs_response':
      return {
        label: m.support_dispute_warning_needs_response(),
        variant: 'warning',
      };
    case 'warning_under_review':
      return {
        label: m.support_dispute_warning_under_review(),
        variant: 'info',
      };
    case 'warning_closed':
      return { label: m.support_dispute_warning_closed(), variant: 'neutral' };
    case 'won':
      return { label: m.support_dispute_won(), variant: 'success' };
    case 'lost':
      return { label: m.support_dispute_lost(), variant: 'error' };
    default:
      return {
        label: m.support_dispute_other({ status: humanise(status) }),
        variant: 'neutral',
      };
  }
}

/** The payee cell: who the slice pays, and what kind of share it is. */
export function payeeCell(slice: Slice): { title: string; detail: string } {
  if (slice.payoutType === 'platform_fee') {
    return { title: m.support_payee_platform_fee(), detail: '' };
  }
  if (slice.payoutType === 'organization_fee') {
    return {
      title: slice.organizationName ?? m.support_payee_unknown(),
      detail: slice.payee
        ? m.support_payee_org_fee({ name: slice.payee.name })
        : m.support_payee_org_fee_no_owner(),
    };
  }
  if (slice.payoutType === 'creator_payout_to_owner') {
    return {
      title: slice.organizationName ?? m.support_payee_unknown(),
      detail: slice.payee
        ? m.support_payee_creator_to_owner({ name: slice.payee.name })
        : m.support_payee_org_fee_no_owner(),
    };
  }
  return {
    title: slice.payee?.name ?? m.support_payee_unknown(),
    detail: m.support_payee_creator(),
  };
}

/** The name a preview or a dialog uses for a slice's payee. */
export function payeeName(slice: Slice | undefined): string {
  if (!slice) return m.support_payee_unknown();
  return payeeCell(slice).title;
}

/** The slice's payout, as the split's Payout column shows it. */
export function payoutStatus(slice: Slice): BadgeTreatment {
  if (slice.payoutType === 'platform_fee') {
    return { label: m.support_payout_kept(), variant: 'neutral' };
  }
  switch (slice.status) {
    case 'paid':
      return { label: m.support_payout_paid(), variant: 'success' };
    case 'pending':
      return { label: m.support_payout_pending(), variant: 'warning' };
    case 'failed':
      return { label: m.support_payout_failed(), variant: 'error' };
    case 'reversed':
      return { label: m.support_payout_reversed(), variant: 'neutral' };
    case 'cancelled_by_refund':
      return {
        label: m.support_payout_cancelled_by_refund(),
        variant: 'neutral',
      };
    case 'cancelled_by_dispute':
      return {
        label: m.support_payout_cancelled_by_dispute(),
        variant: 'neutral',
      };
    default:
      return { label: humanise(slice.status), variant: 'neutral' };
  }
}

/** Why an unpaid slice waits, in words; null when it has no reason. */
export function payoutReasonLabel(reason: string | null): string | null {
  switch (reason) {
    case null:
      return null;
    case 'connect_not_ready':
      return m.support_payout_reason_connect_not_ready();
    case 'connect_restricted':
      return m.support_payout_reason_connect_restricted();
    case 'transfer_failed':
      return m.support_payout_reason_transfer_failed();
    case 'min_transfer_floor':
      return m.support_payout_reason_min_transfer_floor();
    case 'no_owner':
      return m.support_payout_reason_no_owner();
    default:
      return humanise(reason);
  }
}

/**
 * How the slice's share was taken back, under "Taken back so far". The amount
 * is the server's `takenCents`; this only says which way it went.
 */
export function takenHow(slice: Slice): string {
  if (slice.payoutType === 'platform_fee') return m.support_taken_platform();
  if (slice.status === 'pending') return m.support_taken_reduced();
  if (slice.status === 'cancelled_by_refund')
    return m.support_taken_cancelled();
  return m.support_taken_reversed();
}

/** A history line's outcome, as its Badge shows it. */
export function historyOutcome(
  outcome: HistoryOutcome,
  isThisDebt = false
): BadgeTreatment {
  switch (outcome) {
    case 'taken':
      return { label: m.support_history_taken(), variant: 'success' };
    case 'taken_from_repay':
      return {
        label: m.support_history_taken_from_repay(),
        variant: 'success',
      };
    case 'owed':
      return {
        label: isThisDebt
          ? m.support_history_this_debt()
          : m.support_history_owed(),
        variant: 'warning',
      };
    case 'paid_back':
      return { label: m.support_history_paid_back(), variant: 'neutral' };
    case 'not_taken':
      return { label: m.support_history_not_taken(), variant: 'neutral' };
    case 'in_progress':
      return { label: m.support_history_in_progress(), variant: 'info' };
    case 'retrying':
      return { label: m.support_history_retrying(), variant: 'warning' };
    case 'refused':
      return { label: m.support_history_refused(), variant: 'error' };
  }
}

/** How a debt was settled, inside a sentence. */
export function resolutionLabel(resolution: string): string {
  switch (resolution) {
    case 'creator_absorbed':
      return m.support_resolution_creator_absorbed();
    case 'platform_absorbed':
      return m.support_resolution_platform_absorbed();
    case 'manually_reversed':
      return m.support_resolution_manually_reversed();
    case 'dispute_won':
      return m.support_resolution_dispute_won();
    case 'refund_failed':
      return m.support_resolution_refund_failed();
    default:
      return m.support_resolution_other({ resolution: humanise(resolution) });
  }
}

/** A subscription's status, as the charge card shows it. */
export function subscriptionStatus(status: string): BadgeTreatment {
  switch (status) {
    case 'active':
    case 'trialing':
      return { label: m.support_subscription_active(), variant: 'success' };
    case 'cancelled':
    case 'canceled':
      return { label: m.support_subscription_cancelled(), variant: 'neutral' };
    case 'past_due':
      return { label: m.support_subscription_past_due(), variant: 'warning' };
    case 'paused':
      return { label: m.support_subscription_paused(), variant: 'warning' };
    default:
      return {
        label: m.support_subscription_other({ status: humanise(status) }),
        variant: 'neutral',
      };
  }
}

/** A person's name; the caller labels `deleted` beside it. */
export function personName(person: SupportPerson | null): string {
  return person?.name ?? m.support_payee_unknown();
}

/**
 * The fallback for a Stripe code with no label here: `product_not_received`
 * reads "Product not received". The code itself stays visible next to it
 * wherever support needs it.
 */
export function humanise(code: string): string {
  const words = code.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What kind of key the search box holds, for "matched by …". */
export function matchedBy(q: string): string | null {
  const value = q.trim();
  if (value.includes('@')) return m.support_matched_email();
  if (/^sub_/.test(value)) return m.support_matched_subscription();
  if (/^pi_/.test(value)) return m.support_matched_payment();
  if (/^(ch|py)_/.test(value)) return m.support_matched_charge();
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  ) {
    return m.support_matched_uuid();
  }
  return null;
}
