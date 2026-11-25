/**
 * The leaving download's file name (Codex-a6ofh.6.5): the piece's slug plus
 * the original's extension, from its R2 key, else its MIME type, in ASCII
 * only, so the `Content-Disposition` it rides in needs no quoting rules.
 */

import { describe, expect, it } from 'vitest';
import { downloadFilename } from '../content-access/leaving-download';

describe('downloadFilename', () => {
  it('takes the extension from the original’s key, in lower case', () => {
    expect(
      downloadFilename('breathing', {
        r2Key: 'creator/originals/media_1/Session.MOV',
        mimeType: 'video/mp4',
      })
    ).toBe('breathing.mov');
  });

  it('falls back to the MIME type when the key has none', () => {
    expect(
      downloadFilename('breathing', {
        r2Key: 'creator/originals/media_1/source',
        mimeType: 'audio/mpeg',
      })
    ).toBe('breathing.mp3');
  });

  it('reads only the key’s last segment', () => {
    expect(
      downloadFilename('breathing', {
        r2Key: 'creator/originals.v2/media_1/source',
        mimeType: null,
      })
    ).toBe('breathing');
  });

  it('keeps the name ASCII and never hidden', () => {
    expect(
      downloadFilename('..café "night" talk', {
        r2Key: 'k/video.mp4',
        mimeType: null,
      })
    ).toBe('caf-night-talk.mp4');
    expect(downloadFilename('', { r2Key: 'k/a.mp4', mimeType: null })).toBe(
      'download.mp4'
    );
  });
});
