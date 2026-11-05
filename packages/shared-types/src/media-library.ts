/**
 * The studio media library's whole-library numbers (Codex-a6ofh.1.6).
 *
 * `GET /api/media/summary` → `{ data: MediaLibrarySummary }`. The paged list
 * only knows the total of its own filter, so the header ("12 items · 6.4 GB",
 * "5 of 12") and the needs-attention line read this beside it.
 */
export interface MediaLibrarySummary {
  /** Every live item in the creator's library, whatever its status. */
  total: number;
  /** The sum of their original file sizes; 0 for an empty library. */
  totalBytes: number;
  /** Items whose transcode failed. */
  failed: number;
  /**
   * Uploads that stopped before they finished: still `uploading` past
   * `MEDIA_UPLOAD_STALLED_AFTER_MS`. With `failed`, the `attention` group.
   */
  stopped: number;
}
