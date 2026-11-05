import { FILE_SIZES, SUPPORTED_MEDIA_MIME_TYPES } from '@codex/constants';
import { describe, expect, it } from 'vitest';
import {
  checkMediaFile,
  MEDIA_FILE_ACCEPT,
  mediaFileAccept,
  resolveMediaMimeType,
} from './media-upload-file';

const file = (name: string, type: string, size = 10_000) => ({
  name,
  type,
  size,
});

describe('resolveMediaMimeType', () => {
  it.each([
    ...SUPPORTED_MEDIA_MIME_TYPES,
  ])('keeps a supported type: %s', (type) => {
    expect(resolveMediaMimeType(file('clip.bin', type))).toBe(type);
  });

  it.each([
    ['audio/x-m4a', 'audio/mp4'], // Windows
    ['audio/x-wav', 'audio/wav'],
    ['audio/wave', 'audio/wav'],
    ['audio/mp3', 'audio/mpeg'],
    ['video/x-m4v', 'video/mp4'],
    ['VIDEO/QUICKTIME', 'video/quicktime'],
  ])('accepts %s as %s', (reported, accepted) => {
    expect(resolveMediaMimeType(file('clip', reported))).toBe(accepted);
  });

  it.each([
    ['IMG_0412.MOV', 'video/quicktime'],
    ['talk.m4a', 'audio/mp4'],
    ['class.mp4', 'video/mp4'],
    ['interview.wav', 'audio/wav'],
    ['trailer.m4v', 'video/mp4'],
  ])('falls back to the extension when the OS reports no type: %s', (name, accepted) => {
    expect(resolveMediaMimeType(file(name, ''))).toBe(accepted);
    expect(resolveMediaMimeType(file(name, 'application/octet-stream'))).toBe(
      accepted
    );
  });

  it.each([
    file('notes.pdf', 'application/pdf'),
    file('photo.jpg', 'image/jpeg'),
    file('movie.mkv', 'video/x-matroska'),
    file('mp4', ''),
    file('README', ''),
  ])('refuses %o', (f) => {
    expect(resolveMediaMimeType(f)).toBeNull();
  });
});

describe('checkMediaFile', () => {
  it('says what to upload it as', () => {
    expect(checkMediaFile(file('IMG_0412.MOV', ''))).toEqual({
      ok: true,
      mimeType: 'video/quicktime',
      mediaType: 'video',
    });
    expect(checkMediaFile(file('talk.m4a', 'audio/x-m4a'))).toEqual({
      ok: true,
      mimeType: 'audio/mp4',
      mediaType: 'audio',
    });
  });

  it('refuses an empty file', () => {
    expect(checkMediaFile(file('clip.mp4', 'video/mp4', 0))).toEqual({
      ok: false,
      reason: 'empty',
    });
  });

  it("refuses a file over the server's 5 GB, and takes one at it", () => {
    const max = FILE_SIZES.MEDIA_MAX_BYTES;
    expect(checkMediaFile(file('clip.mp4', 'video/mp4', max + 1))).toEqual({
      ok: false,
      reason: 'too_large',
    });
    expect(checkMediaFile(file('clip.mp4', 'video/mp4', max)).ok).toBe(true);
  });

  it('names the type before the size', () => {
    expect(checkMediaFile(file('notes.pdf', 'application/pdf', 0))).toEqual({
      ok: false,
      reason: 'type',
    });
  });
});

describe('mediaFileAccept (Codex-a6ofh.1.8)', () => {
  it('offers only the kinds a field holds, types and extensions both', () => {
    const video = mediaFileAccept(['video']).split(',');
    expect(video).toContain('video/mp4');
    expect(video).toContain('.mov');
    expect(video.some((entry) => entry.startsWith('audio/'))).toBe(false);
    expect(video).not.toContain('.mp3');

    const audio = mediaFileAccept(['audio']).split(',');
    expect(audio).toContain('audio/mpeg');
    expect(audio).toContain('.mp3');
    expect(audio.some((entry) => entry.startsWith('video/'))).toBe(false);
  });

  it('offers everything the library takes when a field holds both', () => {
    expect(new Set(mediaFileAccept(['video', 'audio']).split(','))).toEqual(
      new Set(MEDIA_FILE_ACCEPT.split(','))
    );
  });
});
