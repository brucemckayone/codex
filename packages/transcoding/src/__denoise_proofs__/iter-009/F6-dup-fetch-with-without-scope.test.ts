/**
 * Denoise iter-009 F6 — proof test for
 * `simplification:dup-fetch-with-without-scope`.
 *
 * Finding: `TranscodingService` has two private fetcher methods that are
 * 95 % identical:
 *
 *   - `getMediaForTranscoding(mediaId, creatorId)` (lines 671-728)
 *     — used by user-facing operations; scopes by `creatorId`.
 *
 *   - `getMediaForTranscodingInternal(mediaId)` (lines 737-770)
 *     — used by HMAC worker-to-worker calls; no scope filter.
 *
 * Both:
 *   - Query `mediaItems` with the EXACT same 22-column projection.
 *   - Throw `TranscodingMediaNotFoundError` when the row is absent.
 *   - Return `media as TranscodingMediaItem`.
 *
 * The only material differences:
 *   - `getMediaForTranscoding()` adds `scopedNotDeleted(mediaItems,
 *     creatorId)` to the WHERE; `getMediaForTranscodingInternal()` uses
 *     `isNull(mediaItems.deletedAt)` directly.
 *   - `getMediaForTranscoding()` runs an `MediaOwnershipError` second-
 *     query check.
 *
 * Fix: extract a `private async fetchMediaForTranscoding(predicate:
 * SQL): Promise<TranscodingMediaItem | undefined>` helper that owns the
 * 22-column SELECT. The two callers wrap it with their respective scope
 * predicate and downstream error handling.
 *
 * Today the column projection is duplicated; if a new column is added
 * (`audioCodec`, etc.) one site can drift from the other and the internal
 * worker-to-worker path silently returns stale data.
 *
 * ## Catalogue walk (SKILL.md §6)
 *
 * - **Parity test (row 1)**: APPLICABLE — both methods should return
 *   identical row shapes for matching DB state. Could mock the db client
 *   and assert the SELECT column list is the same set.
 *
 * - **Clone-count assertion (row 12)**: CHOSEN — proof asserts the
 *   22-column projection literal `transcodingAttempts: true` is declared
 *   exactly ONCE in `transcoding-service.ts`. Pre-fix: 2 occurrences (one
 *   per method). Post-fix: 1 (the helper).
 *
 * - **Lonely abstraction (row 2)**: NOT APPLICABLE — both methods have
 *   real callers; the question is shape duplication, not consumer count.
 *
 * - **Dead pattern (row 5)**: NOT APPLICABLE.
 *
 * ## How this test fails on main and passes after the fix
 *
 * Today (un-skipped): count `transcodingAttempts: true,` (a column from
 * the 22-column block, distinctive enough to identify the projection)
 * occurrences in `transcoding-service.ts`. Currently 2 → fails. After fix
 * (helper extracted): 1 → passes.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../../../..');
const SERVICE_PATH = resolve(
  REPO_ROOT,
  'packages/transcoding/src/services/transcoding-service.ts'
);

describe('denoise proof: F6 simplification:dup-fetch-with-without-scope', () => {
  it.skip('22-column transcoding-media projection appears exactly once', () => {
    const src = readFileSync(SERVICE_PATH, 'utf8');
    // `transcodingAttempts: true,` is unique to this projection; count
    // occurrences as a proxy for the projection block as a whole.
    const occurrences = src.split('transcodingAttempts: true,').length - 1;
    // Pre-fix: 2 (one per fetcher). Post-fix: 1 (in the shared helper).
    expect(occurrences).toBe(1);
  });
});
