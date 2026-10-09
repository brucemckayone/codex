/**
 * The figures a numbers section shows: the course's own counts first (when
 * `live` is on), then the creator's. Merged, not either/or — "Show my course
 * numbers" and "Your own numbers" are two fields, and a layout never hides a
 * filled one.
 *
 * Live counts come from the curriculum the page renders (`context.stages`),
 * so they can never disagree with the curriculum section. A count of zero is
 * left out: "0 practices" sells nothing.
 */
import type { JourneyStageView } from '$lib/page-builder';
import { STATS_COPY } from './copy';
import type { StatItem } from './definition';

export interface StatFigure extends StatItem {
  key: string;
}

function count(value: number): string {
  return value.toLocaleString('en-GB');
}

export function liveFigures(stages: readonly JourneyStageView[]): StatFigure[] {
  const practices = stages.reduce(
    (sum, stage) => sum + stage.practices.length,
    0
  );
  const figures: StatFigure[] = [];
  if (stages.length > 0) {
    figures.push({
      key: 'live-stages',
      value: count(stages.length),
      label: STATS_COPY.stages(stages.length),
    });
  }
  if (practices > 0) {
    figures.push({
      key: 'live-practices',
      value: count(practices),
      label: STATS_COPY.practices(practices),
    });
  }
  return figures;
}

export function statFigures(
  content: { live?: boolean; items?: readonly StatItem[] },
  stages: readonly JourneyStageView[]
): StatFigure[] {
  const live = content.live ? liveFigures(stages) : [];
  const own = (content.items ?? []).map((item, index) => ({
    ...item,
    key: `item-${index}`,
  }));
  return [...live, ...own];
}
