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

/** Read before a stage's number: "Stage 3". */
const STAGE = 'Stage';

/** A stage named in full: "Stage 2 · Breath", or "Stage 2" unnamed. */
function stageLine(number: number, name: string): string {
  const named = name.trim();
  return named ? `${STAGE} ${number} · ${named}` : `${STAGE} ${number}`;
}

export const CURRICULUM_COPY = {
  stage: STAGE,
  stageLine,
  practices: COPY.course.practices,
  /** A stage's row of practices, its buttons (the layered layout). */
  previousIn: (number: number) => `Previous practice in ${STAGE} ${number}`,
  nextIn: (number: number) => `Next practice in ${STAGE} ${number}`,
  /** What a practice is, beside its title: "Video", "Reading". */
  kind: (type: PracticeType) => KINDS[type] ?? KINDS.video,
  /**
   * A practice's length (`COPY.course.duration`): the course's facts lines
   * add theirs up in the same words.
   */
  length: COPY.course.duration,
} as const;
