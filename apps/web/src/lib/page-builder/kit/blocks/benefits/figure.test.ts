// @vitest-environment node
/**
 * A benefit's figure (Codex-61zsk.73): which a stored value keeps, and how
 * wide the checklist reckons it, in its face's `0`s.
 */
import { describe, expect, it } from 'vitest';
import { runWeight } from '../../model/faces';
import { FIGURE_MAX, figureZeros, readFigure } from './figure';

describe('readFigure', () => {
  it.each([
    ['24', '24'],
    ['£12', '£12'],
    ['98%', '98%'],
    ['6', '6'],
    ['4.9+', '4.9+'],
    ['  24 ', '24'],
  ])('keeps %j as %j', (raw, kept) => {
    expect(readFigure(raw)).toBe(kept);
  });

  it('keeps as many characters as the inspector takes, and drops one more rather than cutting it', () => {
    expect(FIGURE_MAX).toBe(4);
    expect(readFigure('1000')).toBe('1000');
    // Cut to four, it would say another number.
    expect(readFigure('1,000')).toBeUndefined();
    expect(readFigure('£1200')).toBeUndefined();
  });

  it.each([
    'ten',
    '£',
    '%',
    '',
    '   ',
  ])('drops %j: with no digit it is a word, not a figure', (raw) => {
    expect(readFigure(raw)).toBeUndefined();
  });

  it.each([
    24,
    null,
    undefined,
    ['24'],
    { figure: '24' },
  ])('drops a stored %j that is not text', (raw) => {
    expect(readFigure(raw)).toBeUndefined();
  });
});

describe('figureZeros', () => {
  it('counts each digit as one `0`: the figures are tabular', () => {
    expect(figureZeros('6')).toBe(1);
    expect(figureZeros('24')).toBe(2);
    expect(figureZeros('1111')).toBe(4);
  });

  it('counts a currency sign or a plus as a digit', () => {
    expect(figureZeros('£12')).toBe(3);
    expect(figureZeros('$5')).toBe(2);
    expect(figureZeros('10+')).toBe(3);
  });

  it('reckons a per cent sign, which the glyph table does not know, wider than a digit', () => {
    expect(figureZeros('98%')).toBeGreaterThan(figureZeros('980'));
  });

  it('reckons a point narrower than a digit', () => {
    expect(figureZeros('4.9')).toBeLessThan(figureZeros('409'));
    expect(figureZeros('4.9')).toBeGreaterThan(figureZeros('49'));
  });

  it('rounds up to a hundredth, so the column is never reckoned narrow', () => {
    const exact = 2 + runWeight('%') / runWeight('0');
    const zeros = figureZeros('98%');
    expect(Number(zeros.toFixed(2))).toBe(zeros);
    expect(zeros).toBeGreaterThanOrEqual(exact);
    expect(zeros - exact).toBeLessThan(0.01);
  });
});
