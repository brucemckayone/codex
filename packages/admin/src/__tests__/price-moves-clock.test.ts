/**
 * When support's Retry and Restart say the next run is (Codex-2hxff.85,
 * .86; batch C1 Part B data design §2.4): ecom-api's hourly run, at the top
 * of every hour, except the 08:00 London run, which belongs to the bank
 * payout. 08:00 London is 08:00 UTC in winter and 07:00 UTC in summer, so
 * the hour that is skipped moves with the clocks.
 */

import { describe, expect, it } from 'vitest';
import { nextPriceMovesRunAfter } from '../services/support-service';

const next = (iso: string) =>
  nextPriceMovesRunAfter(new Date(iso)).toISOString();

describe('nextPriceMovesRunAfter', () => {
  it('is the next top of the hour, strictly after', () => {
    expect(next('2026-11-04T10:41:00Z')).toBe('2026-11-04T11:00:00.000Z');
    expect(next('2026-11-04T11:00:00.000Z')).toBe('2026-11-04T12:00:00.000Z');
    expect(next('2026-11-04T23:30:00Z')).toBe('2026-11-05T00:00:00.000Z');
  });

  it('in winter (GMT), skips 08:00 UTC, the bank payout’s run', () => {
    expect(next('2026-11-04T07:30:00Z')).toBe('2026-11-04T09:00:00.000Z');
    expect(next('2026-11-04T07:59:59Z')).toBe('2026-11-04T09:00:00.000Z');
    // 07:00 UTC is 07:00 London: an ordinary run.
    expect(next('2026-11-04T06:30:00Z')).toBe('2026-11-04T07:00:00.000Z');
  });

  it('in summer (BST), skips 07:00 UTC, which is 08:00 London, and keeps 08:00 UTC', () => {
    expect(next('2026-10-24T06:30:00Z')).toBe('2026-10-24T08:00:00.000Z');
    expect(next('2026-10-24T07:30:00Z')).toBe('2026-10-24T08:00:00.000Z');
  });

  it('on the day the clocks go back (25 Oct 2026, 01:00 UTC), the skip moves to 08:00 UTC', () => {
    // Before the change: 00:30 UTC is 01:30 BST; the 01:00 UTC run is 01:00 GMT.
    expect(next('2026-10-25T00:30:00Z')).toBe('2026-10-25T01:00:00.000Z');
    expect(next('2026-10-25T06:30:00Z')).toBe('2026-10-25T07:00:00.000Z');
    expect(next('2026-10-25T07:30:00Z')).toBe('2026-10-25T09:00:00.000Z');
  });

  it('on the day the clocks go forward (29 Mar 2026, 01:00 UTC), the skip moves to 07:00 UTC', () => {
    expect(next('2026-03-28T07:30:00Z')).toBe('2026-03-28T09:00:00.000Z');
    expect(next('2026-03-29T06:30:00Z')).toBe('2026-03-29T08:00:00.000Z');
    expect(next('2026-03-29T07:30:00Z')).toBe('2026-03-29T08:00:00.000Z');
  });
});
