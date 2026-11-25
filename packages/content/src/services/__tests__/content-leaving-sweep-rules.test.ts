/**
 * The leaving sweep's pure rules (Codex-a6ofh.6.4): what each answer from
 * notifications-api makes of a notice (WP-1 review r3, r4), the date an
 * owner reads, and the button the email offers (owner, D8). No database:
 * the DB suite (content-leaving-sweep.test.ts) proves the CHECKs take them.
 */

import { LEAVING_NOTICE_MAX_TRIES } from '@codex/constants';
import { describe, expect, it } from 'vitest';
import {
  actionLabelOf,
  leaveDateOf,
  leavingNoticeOutcome,
} from '../content-leaving-sweep';

describe('leavingNoticeOutcome', () => {
  const early = 1;
  const last = LEAVING_NOTICE_MAX_TRIES;

  it.each([
    [{ accepted: true } as const, { state: 'sent' }],
    [
      { accepted: false, status: 404 } as const,
      { state: 'failed', reason: 'refused' },
    ],
    [
      { accepted: false, status: 422 } as const,
      { state: 'failed', reason: 'refused' },
    ],
    [
      { accepted: false, skipped: 'opted_out' } as const,
      { state: 'failed', reason: 'skipped' },
    ],
    [
      { accepted: false, status: 500 } as const,
      { state: 'unknown', reason: 'unknown' },
    ],
    [
      { accepted: false, status: 503 } as const,
      { state: 'unknown', reason: 'unknown' },
    ],
    [
      { accepted: false, error: 'The operation timed out' } as const,
      { state: 'unknown', reason: 'unknown' },
    ],
  ])('%o, with tries left, is %o', (delivery, outcome) => {
    expect(leavingNoticeOutcome(delivery, early)).toEqual(outcome);
  });

  it('no address is abandoned at once, whatever the tries', () => {
    expect(leavingNoticeOutcome('no_address', early)).toEqual({
      state: 'abandoned',
      reason: 'no_address',
    });
  });

  it('the last try ends the notice with its own answer', () => {
    expect(
      leavingNoticeOutcome({ accepted: false, status: 422 }, last)
    ).toEqual({ state: 'abandoned', reason: 'refused' });
    expect(
      leavingNoticeOutcome({ accepted: false, skipped: 'opted_out' }, last)
    ).toEqual({ state: 'abandoned', reason: 'skipped' });
    expect(
      leavingNoticeOutcome({ accepted: false, error: 'reset' }, last)
    ).toEqual({ state: 'abandoned', reason: 'unknown' });
    expect(leavingNoticeOutcome({ accepted: true }, last)).toEqual({
      state: 'sent',
    });
  });

  it('a try before the last is never abandoned for its answer', () => {
    expect(
      leavingNoticeOutcome({ accepted: false, status: 422 }, last - 1)
    ).toEqual({ state: 'failed', reason: 'refused' });
  });
});

describe('leaveDateOf', () => {
  it('reads as "19 December 2026"', () => {
    expect(leaveDateOf(new Date('2026-12-19T10:00:00Z'))).toBe(
      '19 December 2026'
    );
  });

  it('is the London day, not the UTC one', () => {
    // 23:30 UTC on 30 June is 00:30 BST on 1 July.
    expect(leaveDateOf(new Date('2026-06-30T23:30:00Z'))).toBe('1 July 2026');
  });
});

describe('actionLabelOf', () => {
  it.each([
    ['video', true, 'Download it'],
    ['audio', true, 'Download it'],
    ['written', true, 'Save it as a PDF'],
    ['video', false, 'Watch it'],
    ['audio', false, 'Listen to it'],
    ['written', false, 'Read it'],
  ])('a %s piece, download %s: %s', (contentType, ownersCanDownload, label) => {
    expect(actionLabelOf({ contentType, ownersCanDownload })).toBe(label);
  });
});
