import { describe, expect, test } from 'vitest';
import type { EnrolledCourseSummary } from '$lib/journeys/types';
import { enrolledCourseRowEntry, resumeProgress } from './journey-entry-card';

/**
 * `resumeProgress` — the resume rail's progress projection (Codex-tnwnu review
 * follow-up).
 *
 * The load-bearing property is the NULL case. A determinate `role="progressbar"`
 * is a claim about how far through something you are, and the library's "Jump
 * back in" rail is filtered to items with `positionSeconds > 0` — so every card
 * in it has been started. Reporting a percent off an unknown denominator made a
 * started-but-never-probed media item announce "0%", which is both wrong for a
 * screen reader and inconsistent with the meta line beside it (which already
 * drops its " of X" clause when the duration is unknown).
 *
 * `null` is therefore not a neutral default here — it is the correct answer, and
 * `JourneyEntryCard` renders no bar at all for it (asserted in
 * `JourneyEntryCard.svelte.test.ts`).
 */
describe('resumeProgress', () => {
  test('reports a percentage when the duration is known', () => {
    expect(resumeProgress(30, 120)).toEqual({ percent: 25, label: null });
    expect(resumeProgress(90, 90)).toEqual({ percent: 100, label: null });
  });

  test('rounds to a whole percent', () => {
    // 1/3 → 33.33…
    expect(resumeProgress(1, 3)?.percent).toBe(33);
    // 2/3 → 66.66…
    expect(resumeProgress(2, 3)?.percent).toBe(67);
  });

  // Tuples typed explicitly: a bare array of mixed literals widens to a union
  // that includes `string`, which `resumeProgress`'s numeric params reject.
  const unknownDurations: [string, number, number | null | undefined][] = [
    ['null duration (never probed)', 90, null],
    ['undefined duration', 90, undefined],
    ['zero duration', 90, 0],
    ['negative duration', 90, -60],
    ['non-finite duration', 90, Number.NaN],
  ];

  test.each(
    unknownDurations
  )('returns null for %s — no bar rather than a false 0%%', (_case, pos, dur) => {
    expect(resumeProgress(pos, dur)).toBeNull();
  });

  test('a position past the duration is clamped, never over 100', () => {
    // Progress rows can outrun a stale duration (re-encoded media, bad probe).
    expect(resumeProgress(500, 100)?.percent).toBe(100);
  });

  test('a missing or non-finite position reads as the start, not as NaN', () => {
    expect(resumeProgress(null, 120)).toEqual({ percent: 0, label: null });
    expect(resumeProgress(undefined, 120)).toEqual({ percent: 0, label: null });
    expect(resumeProgress(Number.NaN, 120)).toEqual({
      percent: 0,
      label: null,
    });
    // A negative position clamps up rather than painting a negative-width fill.
    expect(resumeProgress(-30, 120)).toEqual({ percent: 0, label: null });
  });
});

/**
 * `enrolledCourseRowEntry` — the library "Jump back in" ROW projection.
 *
 * The library's resume rail is MIXED: journey rows and standalone-practice rows
 * sit in one flex track (`library/+page.svelte`), and the practice half labels
 * its type through `kicker` (`'Video'` / `'Audio'` / `'Article'`) with no badge.
 * This projection used to send `badge: 'Portal'` instead, so one rail expressed
 * the same fact — "what kind of thing is this" — in two places with two visual
 * treatments, which is precisely the inconsistency a shared card exists to
 * remove.
 *
 * These lock the resulting contract, because it is a contract BETWEEN two call
 * sites rather than a property of either one: nothing in the component or in the
 * library page fails if this projection drifts back to a badge, and the rail just
 * quietly looks like two systems again.
 */
describe('enrolledCourseRowEntry', () => {
  function summary(
    overrides: {
      kicker?: string | null;
      nextPracticeTitle?: string | null;
    } = {}
  ): EnrolledCourseSummary {
    return {
      course: {
        id: 'c-1',
        slug: 'rootwork',
        title: 'Rootwork',
        organizationSlug: 'of-blood-and-bones',
        kicker: overrides.kicker ?? null,
        lede: 'Bone, breath and smoke.',
        guideName: 'Luzura',
        coverImageUrl: 'http://localhost:4100/courses/c-1/cover/md.webp',
      },
      enrollment: {
        courseId: 'c-1',
        enrolledAt: '2026-07-01T00:00:00.000Z',
        lastActivityAt: null,
        completedAt: null,
      },
      enrollmentSource: 'course_purchase',
      progress: {
        done: 1,
        total: 12,
        percent: 8,
        status: 'in-progress',
        lastCompletedAt: null,
        nextPracticeSlug: 'tooth-talismans',
        nextPracticeTitle:
          overrides.nextPracticeTitle === undefined
            ? 'Tooth Talismans'
            : overrides.nextPracticeTitle,
      },
    };
  }

  test('labels the type through the KICKER, and sends no badge', () => {
    const entry = enrolledCourseRowEntry(summary(), '/journeys/rootwork');
    expect(entry.kicker).toBe('Portal');
    // Not merely "falsy" — the prop must be ABSENT, because the component renders
    // the badge on any truthy value and `undefined` is what "this layout does not
    // use a badge" looks like.
    expect(entry.badge).toBeUndefined();
    expect(entry.layout).toBe('row');
  });

  /*
    The load-bearing case. A course WITH an editorial kicker is the one that broke
    the layout: at `--text-xs` uppercase with `0.2em` tracking, "A twelve-practice
    descent" wrapped to three lines above the title in the row's text column,
    which is what pushed the title clear of the cover and made the two columns
    read as unrelated. So the row must ignore the course's own kicker, not merely
    default to 'Portal' when it happens to be null.
  */
  test('ignores the course editorial kicker rather than forwarding it', () => {
    const entry = enrolledCourseRowEntry(
      summary({ kicker: 'A twelve-practice descent' }),
      '/journeys/rootwork'
    );
    expect(entry.kicker).toBe('Portal');
    expect(entry.kicker).not.toBe('A twelve-practice descent');
  });

  test('the meta line names the next practice, and degrades without one', () => {
    expect(enrolledCourseRowEntry(summary(), '/j').meta).toBe(
      'Next · Tooth Talismans'
    );
    expect(
      enrolledCourseRowEntry(summary({ nextPracticeTitle: null }), '/j').meta
    ).toBe('Next · Continue');
  });
});
