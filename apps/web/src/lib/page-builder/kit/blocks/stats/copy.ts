/**
 * Visitor-facing words the numbers block renders itself. They belong in
 * `kit/model/copy.ts` (contract A1) and live here only until that shared file
 * takes them — it is outside this block's folder.
 */
export const STATS_COPY = {
  stages: (count: number) => (count === 1 ? 'stage' : 'stages'),
  practices: (count: number) => (count === 1 ? 'practice' : 'practices'),
} as const;
