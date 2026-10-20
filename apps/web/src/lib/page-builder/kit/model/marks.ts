/**
 * The marks a creator may give an item (Codex-61zsk.58): twelve icons from the
 * platform's own set, drawn in the mark ink. A closed list, so a stored mark
 * is always one the kit can draw; anything else reads as none (`readOneOf`).
 * `Mark.svelte` draws each, and the editor's picker offers them in this order.
 */
export const MARKS = [
  'check',
  'sparkle',
  'heart',
  'clock',
  'calendar',
  'compass',
  'users',
  'page',
  'film',
  'music',
  'sun',
  'moon',
] as const;

export type MarkId = (typeof MARKS)[number];

/** What each mark is called to someone who cannot see it (the picker's buttons). */
export const MARK_LABELS: Readonly<Record<MarkId, string>> = {
  check: 'Tick',
  sparkle: 'Sparkle',
  heart: 'Heart',
  clock: 'Clock',
  calendar: 'Calendar',
  compass: 'Compass',
  users: 'People',
  page: 'Page',
  film: 'Film',
  music: 'Music',
  sun: 'Sun',
  moon: 'Moon',
};

/** The options a `mark` field offers, in the picker's order. */
export const MARK_OPTIONS: readonly { value: MarkId; label: string }[] =
  MARKS.map((value) => ({ value, label: MARK_LABELS[value] }));
