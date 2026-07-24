import { describe, expect, it } from 'vitest';
import {
  computeCourseRollup,
  selectContinuePractice,
  toPlaylist,
} from './rollup';
import type { JourneyPractice, JourneyStage } from './types';

function practice(
  contentId: string,
  sortOrder: number,
  overrides: Partial<JourneyPractice> = {}
): JourneyPractice {
  return {
    contentId,
    slug: contentId,
    title: contentId,
    contentType: 'written',
    durationSeconds: null,
    thumbnailUrl: null,
    sortOrder,
    ...overrides,
  };
}

// Two stages, out of sort order to prove the helpers sort deterministically.
const stages: JourneyStage[] = [
  {
    id: 's2',
    name: 'Second',
    gloss: null,
    sortOrder: 1,
    practices: [practice('c3', 1), practice('c2', 0)],
  },
  {
    id: 's1',
    name: 'First',
    gloss: null,
    sortOrder: 0,
    practices: [practice('c1', 0)],
  },
];

describe('computeCourseRollup', () => {
  it('rolls up overall + per-stage counts and percentages', () => {
    const rollup = computeCourseRollup(stages, new Set(['c1', 'c2']));
    expect(rollup.overall).toEqual({ done: 2, total: 3, percent: 67 });
    expect(rollup.byStage.get('s1')).toEqual({
      done: 1,
      total: 1,
      percent: 100,
    });
    expect(rollup.byStage.get('s2')).toEqual({
      done: 1,
      total: 2,
      percent: 50,
    });
    expect(rollup.isComplete).toBe(false);
  });

  it('reports completion only when every practice is done', () => {
    const rollup = computeCourseRollup(stages, new Set(['c1', 'c2', 'c3']));
    expect(rollup.overall.percent).toBe(100);
    expect(rollup.isComplete).toBe(true);
  });

  it('never divides by zero for an empty curriculum', () => {
    const rollup = computeCourseRollup([], new Set());
    expect(rollup.overall).toEqual({ done: 0, total: 0, percent: 0 });
    expect(rollup.isComplete).toBe(false);
  });

  it('ignores completed ids that are not part of the course', () => {
    const rollup = computeCourseRollup(stages, new Set(['not-in-course']));
    expect(rollup.overall.done).toBe(0);
  });
});

describe('toPlaylist', () => {
  it('flattens by stage order then practice order', () => {
    expect(toPlaylist(stages).map((e) => e.contentId)).toEqual([
      'c1',
      'c2',
      'c3',
    ]);
  });
});

describe('selectContinuePractice', () => {
  it('returns the first incomplete practice in course order', () => {
    const next = selectContinuePractice(stages, new Set(['c1']));
    expect(next?.contentId).toBe('c2');
  });

  it('prefers an in-progress practice over the first incomplete', () => {
    const next = selectContinuePractice(
      stages,
      new Set(['c1']),
      new Set(['c3'])
    );
    expect(next?.contentId).toBe('c3');
  });

  it('returns null when every practice is complete', () => {
    expect(
      selectContinuePractice(stages, new Set(['c1', 'c2', 'c3']))
    ).toBeNull();
  });

  it('returns null for an empty curriculum', () => {
    expect(selectContinuePractice([], new Set())).toBeNull();
  });
});
