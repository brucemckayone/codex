/**
 * A piece leaving, as the studio reads it (Codex-a6ofh.6; owner 2026-11-20):
 * whose delete holds it, its date, a Keep's words and the refusals'.
 */
import { LEAVING_NOTICE_DAYS } from '@codex/constants';
import { describe, expect, it } from 'vitest';
import { formatLocalClockTime, formatSentenceDate } from '$lib/utils/format';
import * as m from '$paraglide/messages';
import {
  canKeep,
  keepRefusalWords,
  keptWords,
  leaveDayFrom,
  leaveOf,
  retryWords,
  tooSoonWords,
} from './leaving-words';

const LEAVES_AT = '2026-12-20T10:00:00.000Z';

describe('leaveOf', () => {
  it('is nothing for a piece not leaving', () => {
    expect(
      leaveOf({ leavesAt: null, leavingByCreator: false, leavingByOrg: false })
    ).toBeNull();
  });

  it('is the creator’s when their delete alone holds it', () => {
    expect(
      leaveOf({
        leavesAt: LEAVES_AT,
        leavingByCreator: true,
        leavingByOrg: false,
      })
    ).toEqual({ leavesAt: LEAVES_AT, heldBy: 'creator' });
  });

  it('is both sides’ when the creator and the org deleted it', () => {
    expect(
      leaveOf({
        leavesAt: LEAVES_AT,
        leavingByCreator: true,
        leavingByOrg: true,
      })
    ).toEqual({ leavesAt: LEAVES_AT, heldBy: 'both' });
  });

  it('is the creator’s when a row does not say whose it is', () => {
    expect(
      leaveOf({
        leavesAt: LEAVES_AT,
        leavingByCreator: undefined,
        leavingByOrg: undefined,
      } as never)
    ).toEqual({ leavesAt: LEAVES_AT, heldBy: 'creator' });
  });

  it('is the org’s only when the org’s delete alone holds it', () => {
    expect(
      leaveOf({
        leavesAt: LEAVES_AT,
        leavingByCreator: false,
        leavingByOrg: true,
      })
    ).toEqual({ leavesAt: LEAVES_AT, heldBy: 'org' });
  });
});

describe('canKeep', () => {
  it('is offered unless only the org’s delete holds it', () => {
    const at = LEAVES_AT;
    expect(canKeep({ leavesAt: at, heldBy: 'creator' })).toBe(true);
    expect(canKeep({ leavesAt: at, heldBy: 'both' })).toBe(true);
    expect(canKeep({ leavesAt: at, heldBy: 'org' })).toBe(false);
  });
});

describe('leaveDayFrom', () => {
  it('is LEAVING_NOTICE_DAYS on', () => {
    const now = new Date('2026-11-20T09:00:00.000Z');
    expect(leaveDayFrom(now).getTime() - now.getTime()).toBe(
      LEAVING_NOTICE_DAYS * 24 * 60 * 60 * 1000
    );
  });
});

describe('retryWords and tooSoonWords (409 CONTENT_LEAVING_TOO_SOON)', () => {
  const now = new Date(2026, 10, 20, 9, 0);

  it('says the time in the creator’s own zone, and tomorrow once the day turns', () => {
    const today = new Date(2026, 10, 20, 14, 5);
    const tomorrow = new Date(2026, 10, 21, 8, 30);
    expect(retryWords(today.toISOString(), now)).toBe(
      m.studio_leaving_too_soon({ time: formatLocalClockTime(today) })
    );
    expect(retryWords(tomorrow.toISOString(), now)).toBe(
      m.studio_leaving_too_soon_tomorrow({
        time: formatLocalClockTime(tomorrow),
      })
    );
  });

  it('gives a day after tomorrow its date, never “tomorrow”', () => {
    const later = new Date(2026, 10, 22, 8, 30);
    expect(retryWords(later.toISOString(), now)).toBe(
      m.studio_leaving_too_soon_on({
        time: formatLocalClockTime(later),
        date: formatSentenceDate(later),
      })
    );
  });

  it('is nothing for a time already past, or now: the server’s own words are said', () => {
    const past = new Date(2026, 10, 19, 23, 50);
    expect(retryWords(past.toISOString(), now)).toBeNull();
    expect(retryWords(now.toISOString(), now)).toBeNull();
  });

  it('is nothing for a time missing or unreadable', () => {
    expect(retryWords(undefined, now)).toBeNull();
    expect(retryWords('not a date', now)).toBeNull();
  });

  it('reads the forwarded refusal, and nothing else', () => {
    const at = new Date(2026, 10, 20, 14, 5);
    const refused = {
      status: 409,
      body: {
        code: 'CONTENT_LEAVING_TOO_SOON',
        message: 'Too soon.',
        retryAfter: at.toISOString(),
      },
    };
    expect(tooSoonWords(refused, now)).toBe(
      m.studio_leaving_too_soon({ time: formatLocalClockTime(at) })
    );
    expect(
      tooSoonWords(
        { status: 409, body: { code: 'CONFLICT', message: 'x' } },
        now
      )
    ).toBeNull();
    expect(tooSoonWords(new Error('down'), now)).toBeNull();
  });
});

describe('keptWords', () => {
  it('says it is kept, and stays off sale', () => {
    expect(
      keptWords(
        'A',
        { kept: true, staying: 3, stillLeavingBy: null },
        LEAVES_AT
      )
    ).toBe(m.studio_leaving_kept({ title: 'A' }));
  });

  it('says the org’s delete still stands when it does (owner 2026-11-20)', () => {
    expect(
      keptWords(
        'A',
        { kept: false, staying: 0, stillLeavingBy: 'org' },
        LEAVES_AT
      )
    ).toBe(
      m.studio_leaving_kept_org_stands({
        title: 'A',
        date: formatSentenceDate(LEAVES_AT),
      })
    );
  });
});

describe('keepRefusalWords (403 CONTENT_LEAVE_NOT_YOURS)', () => {
  it('names an org admin’s delete, and nothing else', () => {
    expect(
      keepRefusalWords(
        {
          status: 403,
          body: { code: 'CONTENT_LEAVE_NOT_YOURS', message: 'x' },
        },
        'A'
      )
    ).toBe(m.studio_leaving_keep_not_yours({ title: 'A' }));
    expect(
      keepRefusalWords(
        { status: 403, body: { code: 'FORBIDDEN', message: 'x' } },
        'A'
      )
    ).toBeNull();
  });
});
