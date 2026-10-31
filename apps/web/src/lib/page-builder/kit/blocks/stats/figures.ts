/**
 * The figures a numbers section shows: the course's own counts first (when
 * `live` is on), then the creator's. Merged, not either/or — "Show my course
 * numbers" and "Your own numbers" are two fields, and a layout never hides a
 * filled one.
 *
 * Live counts come from the curriculum the page renders (`context.stages`),
 * counted by `courseFacts` as the hero and pricing count it, so they can
 * never disagree with the curriculum section or each other. A count of zero
 * is left out: "0 practices" sells nothing.
 */
import type { JourneyStageView } from '$lib/page-builder';
import { courseFacts } from '../../model/facts';
import { STATS_COPY } from './copy';
import type { StatItem } from './definition';

export interface StatFigure extends StatItem {
  key: string;
}

/** The most characters a figure has and still sits in a true circle. */
const ROUND_FIGURE_MAX = 4;

/**
 * A figure too long for a circle round it ("4,000+", "6 weeks"): ringed, it
 * would stretch the circle into a flat ellipse, so a Style that rings its
 * figures draws a pill round this one instead (Studio).
 */
export function isLongFigure(value: string): boolean {
  return value.length > ROUND_FIGURE_MAX;
}

function count(value: number): string {
  return value.toLocaleString('en-GB');
}

export function liveFigures(stages: readonly JourneyStageView[]): StatFigure[] {
  const facts = courseFacts(stages);
  const practices = facts.practices;
  const figures: StatFigure[] = [];
  if (facts.stages > 0) {
    figures.push({
      key: 'live-stages',
      value: count(facts.stages),
      label: STATS_COPY.stages(facts.stages),
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
