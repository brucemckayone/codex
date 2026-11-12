import { MEDIA_UPLOAD_STALLED_AFTER_MS } from '@codex/constants';
import { describe, expect, it } from 'vitest';
import { chosenView, type Following, followUpload } from './picker-state';

const BEFORE = 'm-before';
const FIRST = 'm-first';
const RETRY = 'm-retry';
const start: Following = {
  key: 'row-1',
  id: null,
  before: BEFORE,
  done: false,
};

describe('followUpload', () => {
  it('attaches the id the moment createMedia gives it one', () => {
    expect(followUpload(start, { id: null, status: 'queued' }, BEFORE)).toEqual(
      { following: start }
    );
    expect(
      followUpload(start, { id: FIRST, status: 'uploading' }, BEFORE)
    ).toEqual({
      following: { ...start, id: FIRST },
      report: FIRST,
    });
  });

  it('a cancel puts back what the field held before, and a finished upload leaving changes nothing', () => {
    const attached = { ...start, id: FIRST };
    expect(followUpload(attached, null, FIRST)).toEqual({
      following: null,
      report: BEFORE,
    });
    expect(followUpload({ ...attached, done: true }, null, FIRST)).toEqual({
      following: null,
    });
  });

  it('a failure detaches the failed attempt; its retry is a new item, attached again', () => {
    const attached = { ...start, id: FIRST };
    const failed = followUpload(
      attached,
      { id: FIRST, status: 'error' },
      FIRST
    );
    expect(failed).toEqual({
      following: { ...start, id: null },
      report: BEFORE,
    });
    // Still failed: nothing more to say.
    expect(
      followUpload(
        failed.following as Following,
        { id: FIRST, status: 'error' },
        BEFORE
      )
    ).toEqual({
      following: failed.following,
    });
    // Retried: queued again, then a new id.
    const retried = followUpload(
      failed.following as Following,
      { id: RETRY, status: 'uploading' },
      BEFORE
    );
    expect(retried.report).toBe(RETRY);
  });

  it('a new id never replaces a value chosen meanwhile: the upload goes on to the library', () => {
    // Before createMedia returned, the creator attached another item.
    expect(
      followUpload(start, { id: FIRST, status: 'uploading' }, 'm-picked-later')
    ).toEqual({
      following: null,
    });
    // After a failure restored BEFORE, they picked another; then the tray's Try again.
    const failed = { ...start, id: null };
    expect(
      followUpload(failed, { id: RETRY, status: 'uploading' }, 'm-picked-later')
    ).toEqual({
      following: null,
    });
  });

  it('never changes a value the creator has since replaced', () => {
    const attached = { ...start, id: FIRST };
    expect(followUpload(attached, null, 'm-picked-later')).toEqual({
      following: null,
    });
    expect(
      followUpload(attached, { id: FIRST, status: 'error' }, 'm-picked-later')
    ).toEqual({
      following: { ...start, id: null },
    });
  });

  it('marks it done, so its leaving the tray later undoes nothing', () => {
    const attached = { ...start, id: FIRST };
    expect(
      followUpload(attached, { id: FIRST, status: 'done' }, FIRST)
    ).toEqual({
      following: { ...attached, done: true },
    });
  });
});

describe('chosenView', () => {
  const NOW = Date.parse('2026-11-03T12:00:00Z');

  it('reads a failed item as failed and a ready one as ready, never as processing', () => {
    expect(chosenView({ status: 'failed' }, undefined, NOW, null).kind).toBe(
      'failed'
    );
    expect(chosenView({ status: 'ready' }, undefined, NOW, null).kind).toBe(
      'ready'
    );
    expect(
      chosenView({ status: 'transcoding' }, undefined, NOW, null).kind
    ).toBe('processing');
  });

  it('reads an upload left past the stall threshold as stopped, a recent one as uploading', () => {
    const old = new Date(
      NOW - MEDIA_UPLOAD_STALLED_AFTER_MS - 60_000
    ).toISOString();
    const recent = new Date(NOW - 60_000).toISOString();
    expect(
      chosenView({ status: 'uploading', createdAt: old }, undefined, NOW, null)
        .kind
    ).toBe('stopped');
    expect(
      chosenView(
        { status: 'uploading', createdAt: recent },
        undefined,
        NOW,
        null
      ).kind
    ).toBe('uploading');
  });

  // Owner, 2026-11-12 (one reader): while it uploads, this tab's own word
  // on it comes first, as on the Publish screen, which sends the creator to
  // this field to fix a stopped upload.
  it('reads an upload this tab gave up on or let go of as stopped, though the socket still says it is uploading here', () => {
    const recent = new Date(NOW - 60_000).toISOString();
    const echo = {
      mediaId: 'm1',
      lifecycle: 'uploading',
      upload: { pct: 60, here: true, stopped: false },
    } as never;
    expect(
      chosenView({ status: 'uploading', createdAt: recent }, echo, NOW, null)
        .kind
    ).toBe('uploading');
    expect(
      chosenView(
        { status: 'uploading', createdAt: recent },
        echo,
        NOW,
        'stopped'
      ).kind
    ).toBe('stopped');
  });

  it('reads an upload this tab is sending or sent as uploading, whatever the clock or the socket says', () => {
    const old = new Date(
      NOW - MEDIA_UPLOAD_STALLED_AFTER_MS - 60_000
    ).toISOString();
    const closed = {
      mediaId: 'm1',
      lifecycle: 'uploading',
      upload: { pct: 100, here: false, stopped: true },
    } as never;
    for (const word of ['sending', 'done'] as const) {
      expect(
        chosenView(
          { status: 'uploading', createdAt: old },
          undefined,
          NOW,
          word
        )
      ).toEqual({ kind: 'uploading', pct: null, elsewhere: false });
      expect(
        chosenView({ status: 'uploading', createdAt: old }, closed, NOW, word)
      ).toEqual({ kind: 'uploading', pct: 100, elsewhere: false });
    }
  });

  it('leaves an item past uploading to the tile rule, whatever this tab says', () => {
    expect(
      chosenView({ status: 'ready' }, undefined, NOW, 'stopped').kind
    ).toBe('ready');
    expect(chosenView({ status: 'failed' }, undefined, NOW, 'done').kind).toBe(
      'failed'
    );
  });
});
