/**
 * Progress rollup + resume selection — PURE helpers (Codex-2pryk · WP-4).
 *
 * The rollup is `practice_completions ⋈ stage_practices` scoped to the
 * enrollment (SPEC §11). Here the curriculum (`stages`) comes from the server
 * load and the completed set comes from the progress store (the
 * `practice_completions` rows are the source of truth — D-E). Keeping the math
 * pure makes the dashboard's overall/per-stage bars and the
 * continue-where-left-off pointer unit-testable in isolation.
 */

import type { JourneyStage, PlaylistEntry } from './types';

export interface RollupCounts {
  done: number;
  total: number;
  /** Integer 0–100. `0` when the stage/course has no practices. */
  percent: number;
}

export interface CourseRollup {
  overall: RollupCounts;
  /** stageId → counts, in stage order. */
  byStage: Map<string, RollupCounts>;
  /** Whether every practice in the course is complete (course completion). */
  isComplete: boolean;
}

function percentOf(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

/**
 * Roll completions up over the curriculum. `completedIds` is the set of content
 * ids with a completion row (source of truth), typically derived from the
 * progress store's `practiceCompletedAt`.
 */
export function computeCourseRollup(
  stages: readonly JourneyStage[],
  completedIds: ReadonlySet<string>
): CourseRollup {
  const byStage = new Map<string, RollupCounts>();
  let overallDone = 0;
  let overallTotal = 0;

  for (const stage of stages) {
    let done = 0;
    for (const practice of stage.practices) {
      if (completedIds.has(practice.contentId)) done += 1;
    }
    const total = stage.practices.length;
    byStage.set(stage.id, { done, total, percent: percentOf(done, total) });
    overallDone += done;
    overallTotal += total;
  }

  return {
    overall: {
      done: overallDone,
      total: overallTotal,
      percent: percentOf(overallDone, overallTotal),
    },
    byStage,
    isComplete: overallTotal > 0 && overallDone === overallTotal,
  };
}

/**
 * Flatten the curriculum into the ordered player sequence: stages by
 * `sortOrder`, practices by `sortOrder` within a stage.
 */
export function toPlaylist(stages: readonly JourneyStage[]): PlaylistEntry[] {
  const entries: PlaylistEntry[] = [];
  const orderedStages = [...stages].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const stage of orderedStages) {
    const orderedPractices = [...stage.practices].sort(
      (a, b) => a.sortOrder - b.sortOrder
    );
    for (const practice of orderedPractices) {
      entries.push({
        contentId: practice.contentId,
        slug: practice.slug,
        title: practice.title,
        contentType: practice.contentType,
        stageId: stage.id,
        stageName: stage.name,
        sortOrder: practice.sortOrder,
      });
    }
  }
  return entries;
}

/**
 * Pick where to resume (continue-where-left-off). Prefer an in-progress
 * practice (started but not complete); otherwise the first incomplete practice
 * in course order; `null` when everything is complete or the course is empty.
 */
export function selectContinuePractice(
  stages: readonly JourneyStage[],
  completedIds: ReadonlySet<string>,
  inProgressIds: ReadonlySet<string> = new Set()
): PlaylistEntry | null {
  const playlist = toPlaylist(stages);
  const incomplete = playlist.filter((e) => !completedIds.has(e.contentId));
  if (incomplete.length === 0) return null;
  return (
    incomplete.find((e) => inProgressIds.has(e.contentId)) ?? incomplete[0]
  );
}
