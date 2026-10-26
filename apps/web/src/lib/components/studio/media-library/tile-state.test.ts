/**
 * Every tile of the approved mockup (docs/handover/live-media-status/
 * index.html), from the list row and the live state that produce it.
 */
import type { MediaItemState } from '@codex/validation';
import { describe, expect, it } from 'vitest';
import {
  describeTile,
  formatCountdown,
  type TileMedia,
  tilePill,
} from './tile-state';

const NOW = 1_800_000_000_000;
const MEDIA_ID = '4d000000-0000-4000-8000-000000000001';

function row(over: Partial<TileMedia> = {}): TileMedia {
  return {
    status: 'transcoding',
    transcodingErrorCode: null,
    transcodingAttempts: 1,
    ...over,
  };
}

function live(over: Partial<MediaItemState> = {}): MediaItemState {
  return {
    mediaId: MEDIA_ID,
    lifecycle: 'transcoding',
    errorCode: null,
    attemptsLeft: 2,
    step: null,
    progress: null,
    upload: null,
    retryAt: null,
    version: 1,
    ...over,
  };
}

describe('describeTile', () => {
  describe('uploading', () => {
    it("from this tab: the tab's own %", () => {
      const view = describeTile(
        row({ status: 'uploading' }),
        live({
          lifecycle: 'uploading',
          upload: { pct: 43, here: true, stopped: false },
        }),
        NOW
      );
      expect(view).toEqual({ kind: 'uploading', pct: 43, elsewhere: false });
      expect(tilePill(view)).toBe('uploading');
    });

    it("on another device: that device's % (2A)", () => {
      expect(
        describeTile(
          row({ status: 'uploading' }),
          live({
            lifecycle: 'uploading',
            upload: { pct: 61, here: false, stopped: false },
          }),
          NOW
        )
      ).toEqual({ kind: 'uploading', pct: 61, elsewhere: true });
    });

    it('with no report yet: indeterminate', () => {
      expect(
        describeTile(row({ status: 'uploading' }), undefined, NOW)
      ).toEqual({
        kind: 'uploading',
        pct: null,
        elsewhere: false,
      });
    });

    it('stopped: the uploading tab closed', () => {
      const view = describeTile(
        row({ status: 'uploading' }),
        live({
          lifecycle: 'uploading',
          upload: { pct: 30, here: false, stopped: true },
        }),
        NOW
      );
      expect(view).toEqual({ kind: 'stopped' });
      expect(tilePill(view)).toBe('stopped');
    });
  });

  describe('starting', () => {
    it('uploaded with no code: about to be claimed', () => {
      const view = describeTile(row({ status: 'uploaded' }), undefined, NOW);
      expect(view).toEqual({ kind: 'starting' });
      expect(tilePill(view)).toBe('processing');
    });

    it('claimed, before its first progress report', () => {
      expect(describeTile(row(), live(), NOW)).toEqual({ kind: 'starting' });
    });
  });

  describe('waiting', () => {
    it('the service is paused or busy: a countdown to the next retry', () => {
      const view = describeTile(
        row({ status: 'uploaded' }),
        live({
          lifecycle: 'uploaded',
          errorCode: 'TRANSCODER_PAUSED',
          retryAt: NOW + 161_000,
        }),
        NOW
      );
      expect(view).toEqual({
        kind: 'waiting',
        cause: 'service',
        retryInSeconds: 161,
      });
      expect(tilePill(view)).toBe('waiting');
    });

    it('a retry already due counts zero, never negative', () => {
      expect(
        describeTile(
          row({ status: 'uploaded' }),
          live({
            lifecycle: 'uploaded',
            errorCode: 'TRANSCODER_BUSY',
            retryAt: NOW - 5_000,
          }),
          NOW
        )
      ).toEqual({ kind: 'waiting', cause: 'service', retryInSeconds: 0 });
    });

    it('past the quick retries (the hourly cron): no countdown', () => {
      expect(
        describeTile(
          row({
            status: 'uploaded',
            transcodingErrorCode: 'TRANSCODER_UNAVAILABLE',
          }),
          undefined,
          NOW
        )
      ).toEqual({ kind: 'waiting', cause: 'service', retryInSeconds: null });
    });

    it('the service is set up wrong: waits for a fix', () => {
      expect(
        describeTile(
          row({
            status: 'uploaded',
            transcodingErrorCode: 'TRANSCODER_MISCONFIGURED',
          }),
          undefined,
          NOW
        )
      ).toEqual({ kind: 'waiting', cause: 'config' });
    });
  });

  it('processing: the live step and %', () => {
    const view = describeTile(
      row(),
      live({ step: 'encoding_variants', progress: 46 }),
      NOW
    );
    expect(view).toEqual({
      kind: 'processing',
      step: 'encoding_variants',
      pct: 46,
    });
    expect(tilePill(view)).toBe('processing');
  });

  it('processing with no socket: indeterminate, never "starting"', () => {
    expect(describeTile(row(), undefined, NOW)).toEqual({
      kind: 'processing',
      step: null,
      pct: null,
    });
  });

  it('ready', () => {
    expect(describeTile(row({ status: 'ready' }), undefined, NOW)).toEqual({
      kind: 'ready',
    });
  });

  describe('failed', () => {
    it('on our side: Try again, with the tries left', () => {
      const view = describeTile(
        row({
          status: 'failed',
          transcodingErrorCode: 'INFRA_ERROR',
          transcodingAttempts: 1,
        }),
        undefined,
        NOW
      );
      expect(view).toEqual({
        kind: 'failed',
        reason: 'internal',
        canRetry: true,
        attemptsLeft: 2,
      });
      expect(tilePill(view)).toBe('failed');
    });

    it('a row from before error codes reads as our side', () => {
      expect(
        describeTile(
          row({ status: 'failed', transcodingAttempts: 1 }),
          undefined,
          NOW
        )
      ).toMatchObject({ reason: 'internal', canRetry: true });
    });

    it('it ran too long: Try again', () => {
      expect(
        describeTile(
          row({ status: 'failed', transcodingErrorCode: 'TIMED_OUT' }),
          undefined,
          NOW
        )
      ).toMatchObject({ reason: 'timeout', canRetry: true });
    });

    it.each([
      'CORRUPT_INPUT',
      'UNSUPPORTED_CODEC',
      'INVALID_DURATION',
      'MISSING_STREAM',
    ])('the file itself (%s): no Try again, another try fails the same way', (code) => {
      expect(
        describeTile(
          row({ status: 'failed', transcodingErrorCode: code }),
          undefined,
          NOW
        )
      ).toMatchObject({ reason: 'file', canRetry: false });
    });

    it('the upload never finished: no Try again', () => {
      expect(
        describeTile(
          row({ status: 'failed', transcodingErrorCode: 'UPLOAD_INCOMPLETE' }),
          undefined,
          NOW
        )
      ).toMatchObject({ reason: 'upload', canRetry: false });
    });

    it('no tries left: no Try again', () => {
      expect(
        describeTile(
          row({
            status: 'failed',
            transcodingErrorCode: 'INFRA_ERROR',
            transcodingAttempts: 3,
          }),
          undefined,
          NOW
        )
      ).toEqual({
        kind: 'failed',
        reason: 'exhausted',
        canRetry: false,
        attemptsLeft: 0,
      });
    });

    it('a file problem says so even with no tries left', () => {
      expect(
        describeTile(
          row({
            status: 'failed',
            transcodingErrorCode: 'CORRUPT_INPUT',
            transcodingAttempts: 3,
          }),
          undefined,
          NOW
        )
      ).toMatchObject({ reason: 'file' });
    });
  });

  describe('the live state wins over the list', () => {
    it('after Try again, a failed row reads as starting', () => {
      expect(
        describeTile(
          row({ status: 'failed', transcodingErrorCode: 'INFRA_ERROR' }),
          live({ lifecycle: 'transcoding', attemptsLeft: 1 }),
          NOW
        )
      ).toEqual({ kind: 'starting' });
    });

    it("its attempts, not the list's", () => {
      expect(
        describeTile(
          row({ status: 'failed', transcodingAttempts: 0 }),
          live({
            lifecycle: 'failed',
            errorCode: 'INFRA_ERROR',
            attemptsLeft: 0,
          }),
          NOW
        )
      ).toMatchObject({ reason: 'exhausted', canRetry: false });
    });

    it("its code, even when it is null and the list's is not", () => {
      expect(
        describeTile(
          row({
            status: 'uploaded',
            transcodingErrorCode: 'TRANSCODER_PAUSED',
          }),
          live({ lifecycle: 'uploaded', errorCode: null }),
          NOW
        )
      ).toEqual({ kind: 'starting' });
    });
  });
});

describe('formatCountdown', () => {
  it.each([
    [161, '2:41'],
    [60, '1:00'],
    [9, '0:09'],
    [0, '0:00'],
    [-3, '0:00'],
  ])('%i s reads %s', (seconds, text) => {
    expect(formatCountdown(seconds)).toBe(text);
  });
});
