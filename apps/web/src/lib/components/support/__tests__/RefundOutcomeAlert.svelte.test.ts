/**
 * What the charge page says after Refund (Codex-2hxff.28, mockup B3): one
 * state per answer, each with its own words and treatment. Mounts the real
 * component with the real Alert.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import {
  chargeDetail,
  preview,
  refundRow,
} from '../__fixtures__/support-fixtures';
import RefundOutcomeAlert from '../RefundOutcomeAlert.svelte';
import type { RefundOutcome } from '../refund-outcome';

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

const REFUND = {
  id: 're_3QiD7cLk2v',
  amountCents: 750,
  status: 'succeeded',
  createdAt: '2026-10-24T09:41:00.000Z',
};

function render(
  outcome: RefundOutcome,
  detail = chargeDetail(),
  extra: { reloading?: boolean; onReload?: () => void } = {}
) {
  component = mount(RefundOutcomeAlert, {
    target: document.body,
    props: { outcome, detail, ...extra },
  });
  flushSync();
  const alert = document.querySelector<HTMLElement>(
    '[data-testid="refund-outcome"]'
  );
  if (!alert) throw new Error('no alert');
  return alert;
}

const text = (el: HTMLElement) =>
  el.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('a refund Stripe made', () => {
  test('pending: requested, still processing, and its id', () => {
    const alert = render({
      kind: 'made',
      refund: { ...REFUND, status: 'pending' },
      preview: preview(),
    });
    expect(alert.getAttribute('data-variant')).toBe('info');
    expect(text(alert)).toContain(
      m.support_outcome_pending_lead({ amount: '£7.50' })
    );
    expect(text(alert)).toContain('re_3QiD7cLk2v');
  });

  test('succeeded: refunded to the buyer, names whose shares are taken, and what access does', () => {
    const alert = render({ kind: 'made', refund: REFUND, preview: preview() });
    expect(alert.getAttribute('data-variant')).toBe('success');
    expect(text(alert)).toContain(
      m.support_outcome_succeeded_lead({
        amount: '£7.50',
        buyer: 'Ellie Marsh',
      })
    );
    expect(text(alert)).toContain(
      m.support_outcome_succeeded_named({
        names: "Rowan Ellis's and Studio Alpha's",
      })
    );
    expect(text(alert)).toContain(
      m.support_outcome_access_keeps({ buyer: 'Ellie Marsh' })
    );
  });
});

describe('the other answers', () => {
  test('replayed: already made, by whom, nothing new', () => {
    const detail = chargeDetail({
      refunds: [refundRow({ id: REFUND.id, amountCents: 750 }), refundRow()],
    });
    const alert = render({ kind: 'replayed', refund: REFUND }, detail);
    expect(alert.getAttribute('data-variant')).toBe('info');
    expect(text(alert)).toContain(m.support_outcome_replayed_lead());
    expect(text(alert)).toContain('Jordan Reid');
  });

  test('changed: who refunded what meanwhile, what is left, and Reload', () => {
    const onReload = vi.fn();
    const detail = chargeDetail({
      refundable: { maxCents: 1500, blocked: null },
      refunds: [
        refundRow({
          id: 're_alex',
          amountCents: 500,
          createdAt: '2026-10-24T09:40:00.000Z',
          requestedBy: {
            userId: 'user-alex',
            name: 'Alex Morgan',
            deleted: false,
          },
        }),
        refundRow(),
      ],
    });
    const alert = render(
      { kind: 'changed', seenRefundIds: ['re_3QfA2bLk2v'] },
      detail,
      {
        onReload,
      }
    );
    expect(alert.getAttribute('data-variant')).toBe('warning');
    expect(text(alert)).toContain(m.support_outcome_changed_lead());
    expect(text(alert)).toContain(
      m.support_outcome_changed_who({
        who: 'Alex Morgan',
        amount: '£5.00',
        time: '10:40',
      })
    );
    expect(text(alert)).toContain(
      m.support_outcome_changed_left({ left: '£15.00' })
    );
    alert.querySelector('button')?.click();
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  test('refused with charge_disputed: the buyer disputed it, and Stripe’s code', () => {
    const alert = render({ kind: 'refused', stripeCode: 'charge_disputed' });
    expect(alert.getAttribute('data-variant')).toBe('error');
    expect(text(alert)).toContain(m.support_outcome_refused_lead());
    expect(text(alert)).toContain(
      m.support_outcome_refused_disputed({ buyer: 'Ellie Marsh' })
    );
    expect(alert.querySelector('.mono')?.textContent).toBe('charge_disputed');
  });

  test('refused with another code: a plain sentence, and the code under it', () => {
    const alert = render({ kind: 'refused', stripeCode: 'amount_too_large' });
    expect(text(alert)).toContain(m.support_outcome_refused_other());
    expect(alert.querySelector('.mono')?.textContent).toBe('amount_too_large');
  });

  test.each([
    [{ kind: 'key_spent' }, 'warning', m.support_outcome_key_spent_lead()],
    [
      { kind: 'window_closed', closesAt: '2026-10-17T07:15:00.000Z' },
      'warning',
      m.support_blocked_window({ date: '17 Oct 2026', time: '08:15' }),
    ],
    [
      { kind: 'chargeback', disputeStatus: 'needs_response' },
      'error',
      m.support_outcome_chargeback_lead(),
    ],
    [{ kind: 'nothing_left' }, 'info', m.support_blocked_nothing()],
    [
      { kind: 'too_large', maxCents: 1500 },
      'warning',
      m.support_outcome_too_large_body({ max: '£15.00' }),
    ],
    [{ kind: 'failed' }, 'error', m.support_outcome_failed_lead()],
  ] as const)('%o', (outcome, variant, expected) => {
    const alert = render(outcome as RefundOutcome);
    expect(alert.getAttribute('data-variant')).toBe(variant);
    expect(text(alert)).toContain(expected);
  });

  test.each([
    [
      'signed_out',
      m.support_outcome_signed_out_lead(),
      m.support_outcome_signed_out_body(),
    ],
    [
      'rate_limited',
      m.support_outcome_rate_limited_lead(),
      m.support_outcome_rate_limited_body(),
    ],
  ] as const)('%s: says so, says nothing was refunded, and offers no reload', (kind, lead, body) => {
    const alert = render({ kind }, chargeDetail(), { onReload: () => {} });
    expect(text(alert)).toContain(lead);
    expect(text(alert)).toContain(body);
    expect(text(alert)).not.toContain(m.support_outcome_failed_lead());
    expect(alert.querySelector('button')).toBeNull();
  });
});

describe('the same refund refused earlier', () => {
  test('key_spent: nothing was made, change the amount or use the Dashboard, and no reload', () => {
    const alert = render({ kind: 'key_spent' }, chargeDetail(), {
      onReload: () => {},
    });
    expect(alert.getAttribute('data-variant')).toBe('warning');
    expect(text(alert)).toContain(m.support_outcome_key_spent_lead());
    expect(text(alert)).toContain(m.support_outcome_key_spent_body());
    expect(alert.querySelector('button')).toBeNull();
  });
});

describe('focus', () => {
  test('the alert can take focus, for the page to move it there', () => {
    const alert = render({ kind: 'nothing_left' });
    expect(alert.getAttribute('tabindex')).toBe('-1');
    expect(alert.hasAttribute('data-refund-outcome')).toBe(true);
  });
});
