import { describe, expect, test } from 'vitest';
import { clock, loadedTo } from './timeline';

/** A `TimeRanges` from `[start, end]` pairs. */
function ranges(...spans: [number, number][]): TimeRanges {
  return {
    length: spans.length,
    start: (i: number) => spans[i][0],
    end: (i: number) => spans[i][1],
  };
}

describe('clock', () => {
  test.each([
    [0, '0:00'],
    [4.9, '0:04'],
    [12, '0:12'],
    [124, '2:04'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3725, '1:02:05'],
  ])('%s s reads %s', (seconds, shown) => {
    expect(clock(seconds)).toBe(shown);
  });

  test('a figure the stream has not given yet reads 0:00', () => {
    expect(clock(Number.NaN)).toBe('0:00');
    expect(clock(Number.POSITIVE_INFINITY)).toBe('0:00');
    expect(clock(-3)).toBe('0:00');
  });
});

describe('loadedTo', () => {
  test('nothing loaded', () => {
    expect(loadedTo(ranges(), 0)).toBe(0);
  });

  test('the end of the range the playhead is in', () => {
    expect(loadedTo(ranges([0, 38]), 12)).toBe(38);
  });

  test('a range starting just after the playhead still counts', () => {
    expect(loadedTo(ranges([12.1, 40]), 12)).toBe(40);
  });

  test('a range further on is not loaded yet as far as the playhead goes', () => {
    expect(loadedTo(ranges([0, 10], [60, 90]), 20)).toBe(10);
  });
});
