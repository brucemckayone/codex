/**
 * Shared progress-calculation helpers.
 *
 * Used by ContentCard, LibraryCard, and ContinueWatchingCard to derive a
 * 0-100 integer percentage from the various progress shapes the API returns.
 */

interface ProgressInput {
  completed?: boolean;
  percentComplete?: number | null;
  positionSeconds?: number;
  durationSeconds?: number;
}

/**
 * Derive a 0-100 integer progress percentage.
 *
 * Resolution order:
 * 1. `completed` flag  -> 100
 * 2. `percentComplete`  -> rounded value
 * 3. `positionSeconds / durationSeconds` -> rounded ratio * 100
 * 4. fallback -> 0
 */
export function calculateProgressPercent(
  progress: ProgressInput | null | undefined
): number {
  if (!progress) return 0;
  if (progress.completed) return 100;
  if (progress.percentComplete != null)
    return Math.round(progress.percentComplete);
  if (
    progress.positionSeconds != null &&
    progress.durationSeconds &&
    progress.durationSeconds > 0
  ) {
    return Math.round(
      (progress.positionSeconds / progress.durationSeconds) * 100
    );
  }
  return 0;
}
