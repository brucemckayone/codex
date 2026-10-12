/**
 * Visitor-facing words the curriculum block renders itself. They belong in
 * `kit/model/copy.ts` (contract A1) and live here only until that shared file
 * takes them — it is outside this block's folder.
 */
import type { JourneyPracticeView } from '$lib/page-builder';
import { COPY } from '../../model/copy';

type PracticeType = JourneyPracticeView['contentType'];

const KINDS: Record<PracticeType, string> = {
  video: 'Video',
  audio: 'Audio',
  written: 'Reading',
};

/**
 * A practice's length the way a visitor plans by it: whole minutes, then
 * hours. Rounded, not floored, so a 9:40 film reads "10 min"; under a minute
 * says so rather than "0 min". Nothing for a length nobody measured.
 */
function length(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0)
    return null;
  if (seconds < 60) return 'under 1 min';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} hr ${rest} min` : `${hours} hr`;
}

export const CURRICULUM_COPY = {
  /** Read before a stage's number: "Stage 3". */
  stage: 'Stage',
  practices: COPY.course.practices,
  /** What a practice is, beside its title: "Video", "Reading". */
  kind: (type: PracticeType) => KINDS[type] ?? KINDS.video,
  length,
} as const;
