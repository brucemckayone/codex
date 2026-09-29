/**
 * Visitor-facing words the curriculum block renders itself. They belong in
 * `kit/model/copy.ts` (contract A1) and live here only until that shared file
 * takes them — it is outside this block's folder.
 */
import type { JourneyPracticeView } from '$lib/page-builder';

const TYPE_NAMES: Record<JourneyPracticeView['contentType'], string> = {
  video: 'video',
  audio: 'audio',
  written: 'reading',
};

export const CURRICULUM_COPY = {
  /** Read before a stage's number: "Stage 3". */
  stage: 'Stage',
  practices: (count: number) =>
    `${count} ${count === 1 ? 'practice' : 'practices'}`,
  /** Spoken after a practice's title; sighted visitors read the icon. */
  type: (type: JourneyPracticeView['contentType']) =>
    TYPE_NAMES[type] ?? TYPE_NAMES.video,
} as const;
