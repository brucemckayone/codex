/**
 * The words for Creator debts per person and Owed to creators
 * (Codex-2hxff.30, .71, .73): the edges the component tests don't reach.
 */

import { describe, expect, test } from 'vitest';
import * as m from '$paraglide/messages';
import { debtPerson, owedItem } from '../__fixtures__/support-fixtures';
import { failure } from '../__fixtures__/support-remote.mock.svelte';
import { balanceCell, clockLines, owesSub } from '../creator-debts-view';
import { checkNotice, refusalNotice, targetFromItem } from '../owed-view';
import { systemSettledSentence } from '../support-format';

describe('Creator debts: the clock and the balance', () => {
  test('once the day has come, the clock says so, with no "in 0 days"', () => {
    const writesOff = clockLines(
      debtPerson({
        clock: {
          kind: 'stripe_writes_off',
          on: '2027-04-24T07:00:00.000Z',
          daysLeft: 0,
        },
      })
    );
    expect(writesOff[0]).toBe(
      m.support_debts_clock_writes_off_due({ date: '24 Apr 2027' })
    );
    const invoice = clockLines(
      debtPerson({
        state: 'to_invoice',
        clock: { kind: 'invoice', on: '2027-01-24T07:00:00.000Z', daysLeft: 0 },
      })
    );
    expect(invoice[0]).toBe(
      m.support_debts_clock_invoice_due({ date: '24 Jan 2027' })
    );
  });

  test('a morning snapshot that is not live is never shown as the balance', () => {
    const person = debtPerson({
      stripe: {
        availableCents: -840,
        pendingCents: 0,
        checkedAt: '2026-10-24T07:00:00.000Z',
        live: false,
      },
    });
    expect(balanceCell(person)).toEqual({
      amount: null,
      negative: false,
      sub: m.support_debts_balance_unread(),
    });
    expect(owesSub(person)).toBe(m.support_debts_as_recorded());
  });

  test('a closed chargeback adds no "closes by itself" line', () => {
    const person = debtPerson();
    const lost = {
      ...person,
      stripeHeld: person.stripeHeld.map((held) => ({
        ...held,
        cause: { ...held.cause, disputeStatus: 'lost' },
      })),
    };
    expect(clockLines(lost)).not.toContain(m.support_debt_closes_if_won());
  });
});

describe('Owed to creators: what a check or a refusal says', () => {
  const target = targetFromItem(
    owedItem({
      payee: {
        userId: 'u',
        name: 'Priya Shah',
        deleted: false,
        role: 'creator',
      },
    })
  );

  test('Stripe shows nothing was taken: closed as not owed, and it says so', () => {
    const notice = checkNotice(target, {
      outcome: 'done',
      result: {
        creditId: target.creditId,
        outcome: 'not_owed',
        state: 'not_owed',
        amountCents: null,
        stripeReversalId: null,
        note: 'Stripe shows nothing was taken.',
        checkedAt: '2026-10-28T09:00:00.000Z',
        action: null,
      },
    });
    expect(notice).toEqual({
      variant: 'success',
      text: m.support_credit_check_not_owed({ name: 'Priya Shah' }),
    });
  });

  test('confirmed, with its debt still open: it says it can be counted against it', () => {
    const notice = checkNotice(target, {
      outcome: 'done',
      result: {
        creditId: target.creditId,
        outcome: 'owed',
        state: 'owed',
        amountCents: 450,
        stripeReversalId: 'trr_1',
        note: null,
        checkedAt: '2026-10-28T09:00:00.000Z',
        action: 'count_against_debt',
      },
    });
    expect(notice.text).toBe(
      m.support_credit_check_owed_count({ name: 'Priya Shah', amount: '£4.50' })
    );
  });

  test('the ledger cannot attribute it: Stripe was not asked, and a person decides', () => {
    const notice = checkNotice(target, {
      outcome: 'done',
      result: {
        creditId: target.creditId,
        outcome: 'needs_person',
        state: 'needs_person',
        amountCents: null,
        stripeReversalId: null,
        note: null,
        checkedAt: '2026-10-28T09:00:00.000Z',
        action: 'decide',
      },
    });
    expect(notice).toEqual({
      variant: 'info',
      text: m.support_credit_check_needs_person(),
    });
  });

  test('a check refused because the session ended says to sign in again', () => {
    const notice = checkNotice(
      target,
      failure({ status: 401, code: 'UNAUTHORIZED' })
    );
    expect(notice.lead).toBe(m.support_outcome_signed_out_lead());
    expect(notice.text).toBe(m.support_settle_session_ended());
  });

  test('a row gone from the queue: the list is up to date now', () => {
    expect(refusalNotice(failure({ status: 404, code: 'NOT_FOUND' }))).toEqual({
      variant: 'info',
      text: m.support_settle_gone(),
    });
    // A failure the dialog stays open for is not a notice.
    expect(refusalNotice(failure({ status: 500, code: null }))).toBeNull();
  });
});

describe('the system settled a stranded take-back (F2)', () => {
  const took = (payeeName: string | null) => ({
    payeeName,
    decision: 'took_share' as const,
  });
  const kept = (payeeName: string | null) => ({
    payeeName,
    decision: 'payee_kept' as const,
  });

  test.each([
    [[], null],
    [
      [took('Jonah Reyes')],
      m.support_settled_system_one({ name: 'Jonah Reyes' }),
    ],
    [[took(null)], m.support_settled_system_plain()],
    [
      [took('Jonah Reyes'), took('Hannah Price')],
      m.support_settled_system_many({ names: 'Jonah Reyes and Hannah Price' }),
    ],
    [[took('Jonah Reyes'), took(null)], m.support_settled_system_some()],
    // A payee who kept a transfer is paid nothing back: said apart (LOW-8).
    [
      [kept('Jonah Reyes')],
      m.support_settled_kept_one({ name: 'Jonah Reyes' }),
    ],
    [[kept(null)], m.support_settled_kept_plain()],
    [
      [took('Hannah Price'), kept('Jonah Reyes')],
      m.support_sentences_two({
        first: m.support_settled_system_one({ name: 'Hannah Price' }),
        second: m.support_settled_kept_one({ name: 'Jonah Reyes' }),
      }),
    ],
  ])('%j', (settled, said) => {
    expect(systemSettledSentence(settled)).toBe(said);
  });
});
