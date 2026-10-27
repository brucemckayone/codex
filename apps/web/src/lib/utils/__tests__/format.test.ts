import { afterEach, describe, expect, it } from 'vitest';
import {
  formatLocalClockTime,
  formatSentenceDate,
  getInitials,
} from '../format';

describe('formatSentenceDate', () => {
  const now = new Date('2026-10-24T12:00:00.000Z');

  it('drops the year when it is this year', () => {
    expect(formatSentenceDate('2026-11-12T09:00:00.000Z', now)).toBe(
      '12 November'
    );
  });

  it('keeps the year when it is not', () => {
    expect(formatSentenceDate('2027-01-03T09:00:00.000Z', now)).toBe(
      '3 January 2027'
    );
  });

  it('reads the day in London, not UTC: 23:30 UTC in summer is tomorrow', () => {
    expect(formatSentenceDate('2026-07-11T23:30:00.000Z', now)).toBe('12 July');
  });
});

describe('getInitials', () => {
  describe('name-only', () => {
    it('takes first chars of first two whitespace-separated tokens', () => {
      expect(getInitials('Alex Creator')).toBe('AC');
    });

    it('caps at 2 chars when more than two tokens', () => {
      expect(getInitials('Alice Bob Charlie')).toBe('AB');
    });

    it('uppercases lowercase single-word names', () => {
      expect(getInitials('lowercase')).toBe('L');
    });

    it('handles single-word name', () => {
      expect(getInitials('Single')).toBe('S');
    });

    it('collapses surrounding and interior whitespace', () => {
      expect(getInitials('  Alex  Bob ')).toBe('AB');
    });
  });

  describe('email fallback', () => {
    it('takes first 2 letters of local part when name is null', () => {
      expect(getInitials(null, 'alice@example.com')).toBe('AL');
    });

    it('takes first 2 letters of local part when name is empty', () => {
      expect(getInitials('', 'bob@example.com')).toBe('BO');
    });

    it('takes single letter when local part is one char', () => {
      expect(getInitials(null, 'a@example.com')).toBe('A');
    });

    it('prefers name over email when both supplied', () => {
      expect(getInitials('Alex Creator', 'a@b.com')).toBe('AC');
    });
  });

  describe('plain-string fallback', () => {
    it('takes first 2 letters of fallback when no @', () => {
      expect(getInitials(null, 'Studio Beta')).toBe('ST');
    });

    it('uppercases plain string fallback', () => {
      expect(getInitials(undefined, 'xy')).toBe('XY');
    });
  });

  describe('both empty', () => {
    it('returns ?? when both null', () => {
      expect(getInitials(null, null)).toBe('??');
    });

    it('returns ?? when both undefined', () => {
      expect(getInitials()).toBe('??');
    });

    it('returns ?? when both empty strings', () => {
      expect(getInitials('', '')).toBe('??');
    });

    it('returns ?? when name is whitespace-only and no fallback', () => {
      expect(getInitials('   ')).toBe('??');
    });

    it('returns ?? when name is whitespace-only and fallback is whitespace-only', () => {
      expect(getInitials('   ', '  ')).toBe('??');
    });
  });

  describe('null/undefined safety', () => {
    it('accepts null name', () => {
      expect(getInitials(null, 'Alex')).toBe('AL');
    });

    it('accepts undefined name', () => {
      expect(getInitials(undefined, 'Alex')).toBe('AL');
    });

    it('accepts null fallback', () => {
      expect(getInitials('Alex Bob', null)).toBe('AB');
    });

    it('accepts undefined fallback', () => {
      expect(getInitials('Alex Bob', undefined)).toBe('AB');
    });
  });
});

describe('formatLocalClockTime', () => {
  const realTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = realTz;
  });

  it("reads in the runtime's zone, as a 24-hour HH:MM", () => {
    process.env.TZ = 'Asia/Kolkata';
    expect(formatLocalClockTime(new Date('2026-10-26T15:00:00.000Z'))).toBe(
      '20:30'
    );
  });

  it('reads the zone at call time, not at import', () => {
    process.env.TZ = 'UTC';
    expect(formatLocalClockTime(new Date('2026-10-26T15:00:00.000Z'))).toBe(
      '15:00'
    );
    process.env.TZ = 'America/New_York';
    expect(formatLocalClockTime(new Date('2026-10-26T15:00:00.000Z'))).toBe(
      '11:00'
    );
  });
});
