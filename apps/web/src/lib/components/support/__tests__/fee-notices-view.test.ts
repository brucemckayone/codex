/**
 * Queue › Fee notices' words (Codex-2hxff.33; batch C1 Part B page 5).
 * Each drawn state is checked against the mockup's own sentence.
 */

import { describe, expect, test } from 'vitest';
import {
  FEE_NOW,
  feeChangeCard,
  feeNotice,
  JORDAN,
} from '../__fixtures__/support-fixtures';
import { failure } from '../__fixtures__/support-remote.mock.svelte';
import {
  changeBadge,
  changeFacts,
  changeSub,
  changeTitle,
  DATE_MARK,
  markedNotice,
  markRefusalNotice,
  markWords,
  noticeNext,
  noticeRise,
  noticeRoles,
  noticeWhat,
} from '../fee-notices-view';

const JONAH = feeNotice().person;

const DATED = feeChangeCard({
  told: { byEmail: 411, anotherWay: 1 },
  waitingFor: 0,
  joiners: { total: 1, told: 1, waiting: 0 },
  toldAnotherWay: [
    {
      person: JONAH,
      by: JORDAN,
      at: '2026-11-04T10:42:00.000Z',
      note: 'Phoned.',
    },
  ],
  lastToldAt: '2026-11-04T10:42:00.000Z',
  effectiveFrom: '2026-12-05T00:00:00.000Z',
  earliestFrom: '2026-12-05T00:00:00.000Z',
});

describe('a fee change card', () => {
  test('F1 the first morning: what changes, for whom, who saved it, how many are told', () => {
    const card = feeChangeCard();
    expect(changeTitle(card)).toBe("Codex's fee: 10% → 12% of each sale");
    expect(changeSub(card)).toBe(
      'Everyone without their own fee setting · saved 2 Nov 2026, 14:20 by Jordan Reid'
    );
    expect(changeBadge(card)).toEqual({
      variant: 'warning',
      label: 'Waiting for 2',
    });
    expect(changeFacts(card)).toEqual([
      { term: 'Told', text: '410 of 412', small: '410 by email' },
      { term: 'Joined since', text: 'Nobody yet' },
      {
        term: 'Starts',
        text: 'Once everyone is told. If the last person is told today:',
        strong: '4 December 2026',
      },
    ]);
  });

  test('F2 joiners are counted separately: told, not holding the date', () => {
    const [, joined] = changeFacts(
      feeChangeCard({ joiners: { total: 1, told: 1, waiting: 0 } })
    );
    expect(joined.text).toBe('1, told by email');
  });

  test('F4 dated: the date, how everyone was told, and when the 30 days end', () => {
    expect(changeBadge(DATED)).toEqual({
      variant: 'info',
      label: 'Starts 5 Dec 2026',
    });
    expect(changeFacts(DATED)).toEqual([
      {
        term: 'Told',
        text: '412 of 412',
        small:
          '411 by email; Jonah Reyes told another way by Jordan Reid, 4 Nov 10:42',
      },
      { term: 'Joined since', text: '1, told by email' },
      {
        term: 'Starts',
        text: '',
        strong: '5 December 2026',
        after: ', 00:00 UK',
        small:
          'Everyone was told by 4 Nov, 10:42; the 30 days end on 4 Dec, 10:42',
      },
    ]);
  });

  test('F7 dated with a joiner waiting: a joiner cannot move the date', () => {
    const facts = changeFacts({
      ...DATED,
      joiners: { total: 4, told: 3, waiting: 1 },
    });
    expect(facts[0].small).toBe('everyone on the first list');
    expect(facts[1].text).toBe('4: 3 told by email, 1 waiting');
    expect(facts[2]).toMatchObject({
      strong: '5 December 2026',
      small: "Set on 4 Nov; a joiner can't move it",
    });
  });
});

describe('a person not told yet', () => {
  test('F1 refused: plainly, and what the run does next', () => {
    const item = feeNotice();
    expect(noticeRoles(item)).toBe(
      'Creator · Hollow Oak Films, Northlight Collective'
    );
    expect(noticeRise(item, feeChangeCard())).toEqual({
      text: "Codex's fee 10% → 12%",
      sub: 'saved 2 Nov',
    });
    expect(noticeWhat(item)).toBe(
      "The mail service refused the email: the address doesn't accept mail."
    );
    expect(noticeNext(item, 'table', FEE_NOW)).toBe(
      'jonah@reyesfilms.co.uk · tried 3 Nov · tries again tomorrow at 08:00'
    );
  });

  test('F2 tried twice', () => {
    const item = feeNotice({
      attempts: 2,
      lastTriedAt: '2026-11-04T08:00:05.000Z',
      nextTryAt: '2026-11-05T08:00:00.000Z',
    });
    expect(
      noticeNext(item, 'table', new Date('2026-11-04T10:40:00.000Z'))
    ).toBe(
      'jonah@reyesfilms.co.uk · tried 3 and 4 Nov · tries again tomorrow at 08:00'
    );
  });

  test('F1 no answer: the log is checked before anything is resent', () => {
    const item = feeNotice({
      person: {
        ...JONAH,
        name: 'Ruth Calder',
        email: 'ruth.calder@northlight.studio',
      },
      state: 'unknown',
      reason: 'unknown',
    });
    expect(noticeWhat(item)).toBe(
      'No answer from the mail service, so it may have gone.'
    );
    expect(noticeNext(item, 'table', FEE_NOW)).toBe(
      "ruth.calder@northlight.studio · tomorrow's run checks our email log first and sends again only if it finds nothing"
    );
    expect(noticeNext(item, 'phone', FEE_NOW)).toBe(
      "Tomorrow's run checks our email log first and sends again only if it finds nothing"
    );
  });

  test('F7 a joiner does not hold the date', () => {
    const item = feeNotice({
      person: { ...JONAH, name: 'Sol Ibarra', email: 'sol@ibarra.film' },
      onList: false,
      waitingSince: '2026-11-13T08:00:00.000Z',
      lastTriedAt: '2026-11-13T08:00:05.000Z',
      nextTryAt: '2026-11-14T08:00:00.000Z',
      changeEffectiveFrom: '2026-12-05T00:00:00.000Z',
    });
    const now = new Date('2026-11-13T10:00:00.000Z');
    expect(noticeRise(item, DATED).sub).toBe('starts 5 Dec');
    expect(noticeNext(item, 'table', now)).toBe(
      "sol@ibarra.film · joined after the first emails, so this doesn't hold the date · tries again tomorrow at 08:00"
    );
  });
});

describe('marking someone told another way', () => {
  const NOW = new Date('2026-11-04T10:42:00.000Z');
  const LAST = feeChangeCard({
    told: { byEmail: 411, anotherWay: 0 },
    waitingFor: 1,
    earliestFrom: '2026-12-05T00:00:00.000Z',
  });

  test('F3 the dialog: what the mark counts as, and what follows', () => {
    const words = markWords(feeNotice(), LAST, NOW);
    expect(words.title).toBe('Mark Jonah Reyes as told?');
    expect(words.description).toBe(
      "Codex's fee: 10% → 12% of each sale · saved 2 Nov"
    );
    expect(words.counts).toBe(
      "Use this when you've told Jonah about the rise another way, for example on the phone. It counts as their notice from now, 4 Nov at 10:42."
    );
    expect(words.follows?.split(DATE_MARK)).toEqual([
      'Jonah is the last person this rise is waiting for, so it will start on ',
      '.',
    ]);
    expect(words.date).toBe('5 December 2026');
    expect(words.submit).toBe('Mark Jonah Reyes as told');
    expect(words.placeholder).toBe(
      'For example: phoned on 4 Nov and read out the change'
    );
  });

  test('F4 marked, and the date is set', () => {
    expect(
      markedNotice(feeNotice(), {
        effectiveFrom: '2026-12-05T00:00:00.000Z',
        waitingFor: 0,
      })
    ).toEqual({
      variant: 'success',
      lead: 'Jonah Reyes is marked as told.',
      text: 'Everyone this rise affects has now been told, so it starts on 5 December 2026.',
    });
  });

  test('F6 nothing to mark: the rise was cancelled meanwhile', () => {
    const answer = failure({
      status: 409,
      code: 'CONFLICT',
      detailsCode: 'FEE_CHANGE_NOT_WAITING',
      message:
        'Nothing to mark: this fee rise has started, or was cancelled or replaced.',
      voidReason: 'cancelled',
      voidedAt: '2026-11-04T10:40:00.000Z',
    });
    expect(markRefusalNotice(feeNotice(), answer, NOW)).toEqual({
      variant: 'warning',
      lead: 'Nothing to mark: this rise was cancelled at 10:40,',
      text: "so nobody needs telling. Everyone who was told about it is emailed that it's off at 08:00 tomorrow.",
    });
  });

  test('F6 already told: a second mark reads as done', () => {
    const answer = failure({
      status: 409,
      detailsCode: 'FEE_NOTICE_ALREADY_TOLD',
      state: 'told_another_way',
      toldAt: '2026-11-04T10:41:00.000Z',
    });
    expect(markRefusalNotice(feeNotice(), answer, NOW)).toEqual({
      variant: 'info',
      text: 'Jonah was already marked as told at 10:41.',
    });
  });

  test('a save that failed keeps the dialog open', () => {
    expect(
      markRefusalNotice(feeNotice(), failure({ status: 500 }), NOW)
    ).toBeNull();
  });
});
