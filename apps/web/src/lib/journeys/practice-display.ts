/**
 * Presentational helpers for journey practices (Codex-2pryk.3.4).
 *
 * Pure, framework-free projections of a practice's medium into the labels,
 * durations and stage numerals the member dashboard renders — kept out of the
 * components so they stay unit-testable and shared between the continue card and
 * the curriculum map (which must agree on every label).
 */
import type { PracticeContentType } from './types';

/** The human label for a practice's medium (dashboard meta rows). */
export function practiceKindLabel(type: PracticeContentType): string {
  switch (type) {
    case 'audio':
      return 'Audio';
    case 'written':
      return 'Reflection';
    default:
      return 'Video';
  }
}

/**
 * Whole-minute duration for a media practice, or `null` when unknown (written
 * practices, or media whose media-item duration hasn't been resolved). Callers
 * omit the "· N min" fragment when this is null.
 */
export function practiceMinutes(durationSeconds: number | null): number | null {
  if (!durationSeconds || durationSeconds <= 0) return null;
  return Math.max(1, Math.round(durationSeconds / 60));
}

const ROMAN = [
  'i',
  'ii',
  'iii',
  'iv',
  'v',
  'vi',
  'vii',
  'viii',
  'ix',
  'x',
  'xi',
  'xii',
];

/** Lowercase roman numeral for a zero-based stage index (falls back to 1-based digits). */
export function stageNumeral(index: number): string {
  return ROMAN[index] ?? String(index + 1);
}

/** English count word for small stage totals ("five stages"), else the digit. */
const COUNT_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
];

export function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}
