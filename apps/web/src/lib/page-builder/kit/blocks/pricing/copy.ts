/**
 * Visitor-facing words the pricing block renders itself. They belong in
 * `kit/model/copy.ts` (contract A1) and live here only until that shared file
 * takes them — it is outside this block's folder.
 */
import type { JourneyContentType } from '$lib/page-builder';
import { TIMED } from '../../model/facts';
import { CURRICULUM_COPY } from '../curriculum/copy';

/** A count of one kind of practice: "18 videos", "6 audio", "1 reading". */
const KINDS: Record<JourneyContentType, (count: number) => string> = {
  video: (count) => `${count} ${count === 1 ? 'video' : 'videos'}`,
  audio: (count) => `${count} audio`,
  written: (count) => `${count} ${count === 1 ? 'reading' : 'readings'}`,
};

/** The kinds in the curriculum's own order, so a mix always reads the same way. */
const KIND_ORDER: readonly JourneyContentType[] = ['video', 'audio', 'written'];

export const PRICING_COPY = {
  /** Over the lines a single way in stands beside. */
  included: 'What’s included',
  /**
   * How long the timed practices run, as the curriculum writes one
   * practice's, naming what was timed so a course with readings never
   * claims their time too: "5 hr 40 min of video and audio".
   */
  length: (seconds: number, kinds: Record<JourneyContentType, number>) =>
    `${CURRICULUM_COPY.length(seconds)} of ${TIMED.filter((kind) => kinds[kind] > 0).join(' and ')}`,
  /** The kinds the course holds, those it has none of left out: "18 videos · 6 audio". */
  mix: (kinds: Record<JourneyContentType, number>) =>
    KIND_ORDER.filter((kind) => kinds[kind] > 0)
      .map((kind) => KINDS[kind](kinds[kind]))
      .join(' · '),
} as const;
