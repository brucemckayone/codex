import { describe, expect, it } from 'vitest';
// Through the package index, as the publish gate imports it.
import {
  isMediaOnItsWay,
  MEDIA_STATUS,
  MEDIA_UPLOAD_STALLED_AFTER_MS,
} from '../index';

const NOW = new Date('2026-11-07T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe('isMediaOnItsWay (Publish when ready, Codex-a6ofh.2.7)', () => {
  it.each([
    MEDIA_STATUS.UPLOADED,
    MEDIA_STATUS.TRANSCODING,
  ])('%s is on its way, however old', (status) => {
    expect(
      isMediaOnItsWay({ status, createdAt: ago(30 * 24 * 3600 * 1000) }, NOW)
    ).toBe(true);
  });

  it('an upload is on its way up to its stall line, and not past it', () => {
    const upload = (createdAt: Date) =>
      isMediaOnItsWay({ status: MEDIA_STATUS.UPLOADING, createdAt }, NOW);
    expect(upload(ago(1000))).toBe(true);
    // Stalled exactly as the media library's `attention` filter counts it:
    // created before now - MEDIA_UPLOAD_STALLED_AFTER_MS.
    expect(upload(ago(MEDIA_UPLOAD_STALLED_AFTER_MS))).toBe(true);
    expect(upload(ago(MEDIA_UPLOAD_STALLED_AFTER_MS + 1))).toBe(false);
  });

  it('reads a wire date as the database row does', () => {
    expect(
      isMediaOnItsWay(
        { status: MEDIA_STATUS.UPLOADING, createdAt: ago(1000).toISOString() },
        NOW
      )
    ).toBe(true);
  });

  it.each([
    MEDIA_STATUS.READY,
    MEDIA_STATUS.FAILED,
  ])('%s is not on its way: nothing is left to wait for', (status) => {
    expect(isMediaOnItsWay({ status, createdAt: ago(1000) }, NOW)).toBe(false);
  });
});
