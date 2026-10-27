/**
 * The Analytics ranges are inclusive UTC calendar days (Codex-2hxff.75,
 * review I-1): "last 30 days" is exactly 30 days, the 30 that Billing and the
 * dashboard read, at every time of day. Pure.
 */

import { describe, expect, it } from 'vitest';
import {
  inclusiveDays,
  PRESET_DAYS,
  presetOf,
  previousRange,
  trailingRange,
} from './analytics-range';

const at = (iso: string) => new Date(iso);

describe('trailingRange', () => {
  it('30 days on 26 Oct is 27 Sep to 26 Oct: 30 days, not 31', () => {
    const range = trailingRange(30, at('2026-10-26T15:00:00.000Z'));

    expect(range).toEqual({ startDate: '2026-09-27', endDate: '2026-10-26' });
    expect(inclusiveDays(range.startDate, range.endDate)).toBe(30);
  });

  it('starts where Billing and the dashboard start (trailingDaysStart(30))', () => {
    // @codex/admin: start of today's UTC day less 29 days.
    const now = at('2026-10-26T15:00:00.000Z');
    const billingStart = new Date(
      Date.UTC(2026, 9, 26) - 29 * 86_400_000
    ).toISOString();

    expect(`${trailingRange(30, now).startDate}T00:00:00.000Z`).toBe(
      billingStart
    );
  });

  it('every preset is exactly its days, at any time of day and across the clock change', () => {
    for (const iso of [
      '2026-10-26T00:00:00.000Z',
      '2026-10-26T00:30:00.000Z',
      '2026-10-26T23:59:59.999Z',
      '2026-10-25T00:30:00.000Z', // the UK clocks went back this morning
      '2026-03-29T00:30:00.000Z', // and forward this one
    ]) {
      for (const days of Object.values(PRESET_DAYS)) {
        const range = trailingRange(days, at(iso));
        expect(inclusiveDays(range.startDate, range.endDate)).toBe(days);
        expect(range.endDate).toBe(iso.slice(0, 10));
      }
    }
  });
});

describe('previousRange', () => {
  it('is the same length, ending the day before', () => {
    expect(previousRange('2026-09-27', '2026-10-26')).toEqual({
      compareFrom: '2026-08-28',
      compareTo: '2026-09-26',
    });
    expect(inclusiveDays('2026-08-28', '2026-09-26')).toBe(30);
  });

  it('handles a one-day range', () => {
    expect(previousRange('2026-10-26', '2026-10-26')).toEqual({
      compareFrom: '2026-10-25',
      compareTo: '2026-10-25',
    });
  });
});

describe('presetOf', () => {
  const now = at('2026-10-26T15:00:00.000Z');

  it('each preset button’s range is that preset', () => {
    for (const [preset, days] of Object.entries(PRESET_DAYS)) {
      const range = trailingRange(days, now);
      expect(presetOf(range.startDate, range.endDate, now)).toBe(preset);
    }
  });

  it('an old 31-day link is not "Last 30 days": it is labelled by its dates', () => {
    expect(presetOf('2026-09-26', '2026-10-26', now)).toBeNull();
  });

  it('a range that does not end today is not a preset', () => {
    expect(presetOf('2026-09-26', '2026-10-25', now)).toBeNull();
  });
});
