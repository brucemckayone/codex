import { describe, expect, it } from 'vitest';
import {
  countWord,
  practiceKindLabel,
  practiceMinutes,
  stageNumeral,
} from './practice-display';

describe('practiceKindLabel', () => {
  it('maps each medium to its dashboard label', () => {
    expect(practiceKindLabel('video')).toBe('Video');
    expect(practiceKindLabel('audio')).toBe('Audio');
    expect(practiceKindLabel('written')).toBe('Reflection');
  });
});

describe('practiceMinutes', () => {
  it('rounds seconds to whole minutes', () => {
    expect(practiceMinutes(2400)).toBe(40);
    expect(practiceMinutes(2700)).toBe(45);
    expect(practiceMinutes(90)).toBe(2); // 1.5 → 2
  });

  it('floors to at least one minute for any positive duration', () => {
    expect(practiceMinutes(20)).toBe(1);
    expect(practiceMinutes(1)).toBe(1);
  });

  it('is null for unknown / non-positive durations (label omits the fragment)', () => {
    expect(practiceMinutes(null)).toBeNull();
    expect(practiceMinutes(0)).toBeNull();
    expect(practiceMinutes(-30)).toBeNull();
  });
});

describe('stageNumeral', () => {
  it('renders lowercase roman numerals for in-range indices', () => {
    expect(stageNumeral(0)).toBe('i');
    expect(stageNumeral(1)).toBe('ii');
    expect(stageNumeral(4)).toBe('v');
  });

  it('falls back to a 1-based digit beyond the table', () => {
    expect(stageNumeral(12)).toBe('13');
  });
});

describe('countWord', () => {
  it('spells small counts and falls back to digits', () => {
    expect(countWord(0)).toBe('zero');
    expect(countWord(2)).toBe('two');
    expect(countWord(5)).toBe('five');
    expect(countWord(13)).toBe('13');
  });
});
