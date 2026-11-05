/**
 * Queue › Price moves' words (Codex-2hxff.85, .86; batch C1 Part B page 6).
 * Each drawn state is checked against the mockup's own sentence.
 */

import { describe, expect, test } from 'vitest';
import { PRICE_EMAILS_PER_RUN } from '$lib/components/studio/price-note-view';
import {
  heldMove,
  JORDAN,
  stoppedChange,
} from '../__fixtures__/support-fixtures';
import { failure } from '../__fixtures__/support-remote.mock.svelte';
import {
  closeComesFirst,
  closedNotice,
  closeWords,
  disputeWaitLine,
  moveAddress,
  moveAmounts,
  movePlace,
  moveRefusalNotice,
  queuedLine,
  restartedNotice,
  restartRefusalNotice,
  retriedNotice,
  stoppedBadge,
  stoppedFacts,
  stoppedSub,
  stoppedTitle,
  whyHeld,
} from '../price-moves-view';

/** The run's size, as the Studio note says it: "1,125". */
const PER_RUN = PRICE_EMAILS_PER_RUN.toLocaleString('en-GB');

const OWEN = heldMove({
  action: 'retry_move',
  subscriber: {
    userId: 'user-owen',
    name: 'Owen Clarke',
    deleted: false,
    email: 'owen.clarke@gmail.com',
  },
  organization: {
    id: 'org-north',
    name: 'Northlight Collective',
    deleted: false,
  },
  plan: {
    kind: 'tier',
    id: 'tier-members',
    name: 'Members',
    interval: 'month',
  },
  fromAmountCents: 800,
  newAmountCents: 900,
  heldReason: 'move_refused',
  lastError: 'invalid_request_error',
  noticeAt: '2026-10-30T14:02:00.000Z',
  effectiveAt: '2026-12-14T00:00:00.000Z',
});

describe('a held row', () => {
  test('M1 refused: who, where, the price and why, plainly', () => {
    const leah = heldMove();
    expect(movePlace(leah)).toBe('Hollow Oak Films · Pro, monthly');
    expect(moveAmounts(leah.fromAmountCents, leah.newAmountCents)).toBe(
      '£12.00 → £14.00'
    );
    expect(whyHeld(leah)).toEqual({
      text: "The email was refused: the address doesn't accept mail.",
      sub: 'Tried 3 times, last on 30 Oct at 17:00',
    });
  });

  test('M1 the email went, then Stripe refused: the date they were told, and Stripe’s code', () => {
    expect(whyHeld(OWEN)).toEqual({
      text: 'Emailed on 30 Oct at 14:02, then Stripe refused the move.',
      sub: 'They were told 14 Dec 2026 · Stripe:',
      mono: 'invalid_request_error',
    });
  });

  test('M1 every other reason', () => {
    expect(whyHeld(heldMove({ heldReason: 'notice_unknown' }))).toEqual({
      text: "We couldn't tell whether the email went, and our email log has no record of it.",
      sub: 'Tried 3 times, checking the log first each time',
    });
    const nia = heldMove({
      heldReason: 'no_address',
      subscriber: { userId: 'u', name: 'Nia Patel', deleted: false, email: '' },
    });
    expect(moveAddress(nia)).toBe('no address on file');
    expect(whyHeld(nia)).toEqual({
      text: "We couldn't find an email address for this account.",
      sub: 'Tried 3 times · add an address to the account, then retry',
    });
    expect(whyHeld(heldMove({ heldReason: 'notice_skipped' }))).toEqual({
      text: 'The mail service skipped it: this address has bounced before.',
      sub: 'Tried 3 times',
    });
    expect(
      whyHeld({
        ...OWEN,
        heldReason: 'move_unknown',
        noticeAt: '2026-10-30T15:03:00.000Z',
        effectiveAt: '2026-11-30T00:00:00.000Z',
      })
    ).toEqual({
      text: "Emailed on 30 Oct at 15:03; we couldn't tell whether Stripe made the move, and Stripe still shows the old price.",
      sub: 'They were told 30 Nov 2026 · checked Stripe 3 times',
    });
  });

  test('M2 queued: the run it waits for, and who asked', () => {
    const queued = heldMove({
      status: 'queued',
      action: null,
      retry: { requestedAt: '2026-11-04T10:41:00.000Z', by: JORDAN },
      queuedFor: '2026-11-04T11:00:00.000Z',
    });
    expect(queuedLine(queued)).toBe('Queued for 11:00 · Jordan Reid');
    expect(queuedLine(heldMove())).toBeNull();
  });

  test('D1-a: a member with an open chargeback waits for it, so the row says why, not a time that keeps moving', () => {
    const queued = heldMove({
      status: 'queued',
      action: null,
      retry: { requestedAt: '2026-11-04T10:41:00.000Z', by: JORDAN },
      queuedFor: '2026-11-05T11:00:00.000Z',
    });
    expect(queuedLine({ ...queued, waitsForDispute: true })).toBe(
      'Waits while a chargeback is open · Jordan Reid'
    );
    expect(queuedLine({ ...queued, retry: null, waitsForDispute: true })).toBe(
      'Waits while a chargeback is open'
    );
    // A held row keeps its buttons; the line sits beside them.
    expect(disputeWaitLine(heldMove({ waitsForDispute: true }))).toBe(
      'Waits while a chargeback is open'
    );
    expect(disputeWaitLine({ ...queued, waitsForDispute: true })).toBeNull();
  });

  test('D1-a: the line comes from waitsForDispute, never from the status alone', () => {
    const queued = heldMove({
      status: 'queued',
      action: null,
      retry: { requestedAt: '2026-11-04T10:41:00.000Z', by: JORDAN },
      queuedFor: '2026-11-04T11:00:00.000Z',
    });
    expect(queuedLine(queued)).toBe('Queued for 11:00 · Jordan Reid');
    expect(disputeWaitLine(heldMove())).toBeNull();
  });

  test('M4 refused again after a retry: Close… comes first', () => {
    const again = heldMove({
      retry: { requestedAt: '2026-11-04T10:41:00.000Z', by: JORDAN },
      lastTriedAt: '2026-11-04T13:00:03.000Z',
    });
    expect(closeComesFirst(again)).toBe(true);
    expect(closeComesFirst(heldMove())).toBe(false);
    expect(whyHeld(again)).toEqual({
      text: "The email was refused again: the address doesn't accept mail.",
      sub: "Retried by Jordan Reid on 4 Nov · tried 3 times, last on 4 Nov at 13:00 · retrying won't fix this address: reach them another way, then Close…",
    });
  });
});

describe('the answers', () => {
  test('M2 Retry: queued for the run, and when to come back', () => {
    const leah = heldMove();
    expect(
      retriedNotice(leah, {
        move: { ...leah, status: 'queued', action: null },
        nextRunAt: '2026-11-04T11:00:00.000Z',
      })
    ).toEqual({
      variant: 'success',
      lead: 'Leah Ortiz is queued for the 11:00 run.',
      text: 'It emails them again and, once the email goes through, schedules their move for their first renewal at least 30 days after it. Come back after 11:05 to see how it went.',
    });
  });

  test('M3 Retry the move: no new email, the date they were told', () => {
    expect(
      retriedNotice(OWEN, {
        move: { ...OWEN, status: 'queued', action: null },
        nextRunAt: '2026-11-04T11:00:00.000Z',
      })
    ).toEqual({
      variant: 'success',
      lead: "Owen Clarke's move is queued for the 11:00 run.",
      text: 'No new email: Stripe is asked again to move them on 14 December 2026, the date they were told. If that renewal has passed by then, they move at the next one.',
    });
  });

  // W4: the words come from the 409's codes, never the worker's `message`,
  // so en.json stays their only source. Each answer carries a message the
  // page must not show.
  const SERVER = 'Server words, not en.json.';
  const notHeld = (over: Parameters<typeof failure>[0]) =>
    failure({
      status: 409,
      detailsCode: 'PRICE_MOVE_NOT_HELD',
      message: SERVER,
      ...over,
    });

  test('M6 nothing to retry: why, from its reason', () => {
    const answer = notHeld({
      reason: 'superseded',
      supersededAt: '2026-11-04T10:30:00.000Z',
    });
    expect(moveRefusalNotice(heldMove(), 'retry', answer)).toEqual({
      variant: 'warning',
      lead: 'Nothing to retry for Leah Ortiz.',
      text: 'A newer price for Pro replaced this one on 4 Nov at 10:30, so they are emailed about that instead.',
    });
  });

  test('a second Retry after a lost answer reads as done', () => {
    expect(
      moveRefusalNotice(heldMove(), 'retry', notHeld({ reason: 'queued' }))
    ).toEqual({
      variant: 'info',
      text: 'This one is already queued for the next run.',
    });
  });

  test.each([
    [
      'superseded, no date',
      { reason: 'superseded' },
      'retry',
      'A newer price for Pro replaced this one, so they are emailed about that instead.',
    ],
    [
      'moved, already on it',
      { reason: 'moved', state: 'unchanged' },
      'retry',
      'They are already on the new price.',
    ],
    [
      'moved, scheduled',
      { reason: 'moved', state: 'scheduled' },
      'retry',
      'Their move is already scheduled: the hourly run got there first.',
    ],
    [
      'skipped, moving away',
      { reason: 'skipped', skipReason: 'moving_away' },
      'retry',
      'They are moving to another plan, so this price no longer applies to them.',
    ],
    [
      'skipped, another interval',
      { reason: 'skipped', skipReason: 'other_interval' },
      'retry',
      'They now pay on another billing interval, so this price no longer applies to them.',
    ],
    [
      'skipped, nothing to move',
      { reason: 'skipped', skipReason: 'no_items' },
      'retry',
      'The run found nothing on their subscription to move.',
    ],
    [
      'skipped, ended first',
      { reason: 'skipped', skipReason: 'ended' },
      'retry',
      'Their subscription ended before the run reached them, so there is nothing to move.',
    ],
    [
      'skipped, unknown why',
      { reason: 'skipped' },
      'retry',
      'The hourly run set this one aside, so there is nothing to move.',
    ],
    [
      'subscription ended',
      { reason: 'subscription_ended' },
      'retry',
      'Their subscription has ended, so there is nothing to move. Close it as not needed.',
    ],
    [
      'closed by hand',
      { reason: 'resolved', resolution: 'moved_by_hand' },
      'close',
      'This one is already closed: moved by hand.',
    ],
    [
      'closed, not needed',
      { reason: 'resolved', resolution: 'not_needed' },
      'close',
      'This one is already closed: no move needed.',
    ],
    [
      'closed after a retry',
      { reason: 'resolved', resolution: 'retried_ok' },
      'close',
      'This one is already closed: moved after a retry.',
    ],
    [
      'closed, unknown how',
      { reason: 'resolved' },
      'close',
      'This one is already closed.',
    ],
    [
      'queued, then Close',
      { reason: 'queued' },
      'close',
      'This one is queued for the next run. If the run holds it again, close it then.',
    ],
    [
      'still running',
      { reason: 'in_progress' },
      'retry',
      "The hourly run is still working on this one: it isn't held.",
    ],
    [
      'a reason this page has no words for',
      { reason: 'new_reason' },
      'retry',
      'There is nothing to do for this one.',
    ],
  ] as const)('%s: worded from its codes (W4)', (_label, over, action, text) => {
    const notice = moveRefusalNotice(heldMove(), action, notHeld(over));
    expect(notice?.text).toBe(text);
    expect(JSON.stringify(notice)).not.toContain(SERVER);
  });

  test.each([
    [
      'running',
      'This price change is running: the hourly run is already emailing its subscribers.',
    ],
    ['done', 'This price change has finished: there is nothing to restart.'],
    [
      'superseded',
      'A newer price replaced this one, so there is nothing to restart.',
    ],
    [null, "This price change isn't stopped."],
  ])('Restart refused, %s: worded from its state (W4)', (state, text) => {
    expect(
      restartRefusalNotice(
        failure({
          status: 409,
          detailsCode: 'PRICE_CHANGE_NOT_STOPPED',
          message: SERVER,
          state,
        })
      )
    ).toEqual({ variant: 'info', text });
  });

  test('M5 Close: closing moves nobody', () => {
    expect(closeWords(heldMove())).toEqual({
      title: "Close Leah Ortiz's held move?",
      description: 'Hollow Oak Films · Pro, monthly · £12.00 → £14.00',
      body: "Closing takes Leah off this list. It doesn't move them: they stay on £12.00/mo unless you've changed it yourself.",
    });
    expect(closedNotice(heldMove(), 'not_needed')).toEqual({
      variant: 'success',
      lead: "Leah Ortiz's held move is closed",
      text: 'as no move needed. They stay on £12.00/mo.',
    });
  });
});

describe('a stopped change', () => {
  test('M7 one card: the cause, the error id, who waits, and what next', () => {
    const change = stoppedChange();
    expect(stoppedTitle(change)).toBe(
      'Stopped: Northlight Collective · Members, monthly · £8.00 → £9.00'
    );
    expect(stoppedSub(change)).toBe('Saved 30 Oct 2026, 13:20 by Tom Ellison');
    expect(stoppedBadge(change)).toEqual({
      variant: 'warning',
      label: 'Stopped',
    });
    expect(stoppedFacts(change)).toEqual([
      {
        term: 'What happened',
        text: "Every email in the first batch was refused (the email template wasn't found), so the run stopped this change. Nobody was emailed and nobody was moved.",
        small: '14:00 run, 30 Oct · error',
        smallMono: 'e7f1c2a4',
      },
      { term: 'Waiting', text: '6,240 subscribers, all on £8.00/mo' },
      {
        term: 'Next',
        text: 'Fix the cause, then restart. The run carries on from where it stopped.',
      },
    ]);
  });

  test('M8 restart queued: the card stays, and says when', () => {
    const change = stoppedChange({
      restart: {
        requestedAt: '2026-11-05T13:12:00.000Z',
        by: JORDAN,
        at: '2026-11-05T14:00:00.000Z',
      },
    });
    expect(stoppedBadge(change)).toEqual({
      variant: 'info',
      label: 'Restarts at 14:00',
    });
    expect(stoppedFacts(change)[2].text).toBe(
      `Restarted by Jordan Reid at 13:12. The 14:00 run carries on, about ${PER_RUN} an hour.`
    );
    expect(restartedNotice(change, '2026-11-05T14:00:00.000Z')).toEqual({
      variant: 'success',
      lead: 'Restarted.',
      text: `The 14:00 run starts emailing Northlight Collective's 6,240 Members subscribers again, about ${PER_RUN} an hour, and Tom's Studio note shows the progress.`,
    });
  });
});
