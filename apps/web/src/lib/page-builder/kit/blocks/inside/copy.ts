/**
 * Visitor-facing words the "What's inside" block renders itself. They belong
 * in `kit/model/copy.ts` (contract A1) and live here only until that shared
 * file takes them — it is outside this block's folder.
 */
import { CURRICULUM_COPY } from '../curriculum/copy';

export const INSIDE_COPY = {
  /** The row's name when the section has no heading of its own. */
  label: "What's inside",
  previous: 'Previous practice',
  next: 'Next practice',
  /** The practices in view, counted from 1: "4–6 of 18", or "18 of 18". */
  position: (first: number, last: number, count: number) =>
    first === last ? `${first} of ${count}` : `${first}–${last} of ${count}`,
  /** The stage a practice sits in: "Stage 2 · Breath", or "Stage 2" unnamed. */
  stage: (number: number, name: string) => {
    const named = name.trim();
    return named
      ? `${CURRICULUM_COPY.stage} ${number} · ${named}`
      : `${CURRICULUM_COPY.stage} ${number}`;
  },
} as const;
