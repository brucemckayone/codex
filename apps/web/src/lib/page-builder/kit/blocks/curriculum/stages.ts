import type { JourneyStageView } from '$lib/page-builder';

/**
 * The course's stages in their real order, each with its practices in order.
 * The public read already sorts them; the canvas builds them from the editor's
 * curriculum, so the block orders them itself rather than trust either.
 */
export function orderedStages(
  stages: readonly JourneyStageView[]
): JourneyStageView[] {
  return [...stages]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((stage) => ({
      ...stage,
      practices: [...stage.practices].sort((a, b) => a.sortOrder - b.sortOrder),
    }));
}
