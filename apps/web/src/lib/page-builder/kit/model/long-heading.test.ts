import { describe, expect, it } from 'vitest';
import { runWeight } from './faces';
import { headingLength, headingRuns, widestRun } from './long-heading';

describe('headingLength', () => {
  it('marks a heading short to 24 characters, medium to 64, long past it', () => {
    expect(headingLength('x'.repeat(24))).toBe('short');
    expect(headingLength('x'.repeat(25))).toBe('medium');
    expect(headingLength('x'.repeat(64))).toBe('medium');
    expect(headingLength('x'.repeat(65))).toBe('long');
    expect(headingLength(undefined)).toBe('short');
  });
});

describe('headingRuns — the runs a line can never break (Codex-61zsk.33)', () => {
  const size = (run: string) => ({
    caps: Math.round(runWeight(run.toUpperCase()) * 1000) / 1000,
    text: Math.round(runWeight(run) * 1000) / 1000,
    chars: Array.from(run).length,
  });

  it('weighs the first run apart, and the widest of the rest with the punctuation drawn on it', () => {
    expect(headingRuns('Your mornings, calmer')).toEqual({
      first: size('Your'),
      widest: size('mornings,'),
    });
  });

  it('weighs by letters, not by count: a word of wide letters outweighs a longer one of narrow', () => {
    const { widest } = headingRuns('A mommy lilliput');
    expect(widest.text).toBe(size('mommy').text);
    expect(widest.chars).toBe('mommy'.length);
    expect(size('mommy').text).toBeGreaterThan(size('lilliput').text);
  });

  it('breaks after a hyphen, a dash or a slash, keeping the mark with the run before it', () => {
    expect(headingRuns('Rest self-compassion').widest).toEqual(
      size('compassion')
    );
    expect(headingRuns('Go mind–body').widest).toEqual(size('mind–'));
    expect(headingRuns('Rest—then begin').first).toEqual(size('Rest—'));
    expect(headingRuns('Try yoga/breathwork').widest).toEqual(
      size('breathwork')
    );
  });

  it('counts characters as drawn, and weighs an accented letter as its base and an unknown one as the widest', () => {
    // `ā` is not in the table; it is weighed as the `a` it is drawn on.
    expect(headingRuns('Go mānuka').widest).toEqual(size('manuka'));
    const emoji = headingRuns('Go 😀').widest;
    expect(emoji.chars).toBe(1);
    expect(emoji.text).toBe(runWeight('W'));
  });

  it('has no widest run for one word, and nothing at all for no words', () => {
    expect(headingRuns('Breathwork').widest).toEqual({
      caps: 0,
      text: 0,
      chars: 0,
    });
    expect(headingRuns('   ')).toEqual({
      first: { caps: 0, text: 0, chars: 0 },
      widest: { caps: 0, text: 0, chars: 0 },
    });
    expect(headingRuns(undefined).first.chars).toBe(0);
  });
});

describe('widestRun — what louder may grow a heading to fit (03 X62)', () => {
  const size = (run: string) => ({
    caps: Math.round(runWeight(run.toUpperCase()) * 1000) / 1000,
    text: Math.round(runWeight(run) * 1000) / 1000,
    chars: Array.from(run).length,
  });

  it('counts the first run, which a section heading does not set apart', () => {
    expect(widestRun('Transformation: a new way')).toEqual(
      size('Transformation:')
    );
    expect(widestRun('Breathwork')).toEqual(size('Breathwork'));
  });

  it('takes the widest after the first when that is wider', () => {
    expect(widestRun('Find your mindfulness')).toEqual(size('mindfulness'));
  });

  it('is nothing for no words', () => {
    expect(widestRun('  ')).toEqual({ caps: 0, text: 0, chars: 0 });
    expect(widestRun(undefined)).toEqual({ caps: 0, text: 0, chars: 0 });
  });
});
